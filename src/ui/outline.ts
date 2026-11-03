import { store } from '../state/documents';
import { languageLabel } from '../editor/languages';
import { rangeOf, symbolsFor } from '../editor/hdl/monacoHdl';
import { symbolPathAt, type HdlKind, type HdlSymbol } from '../editor/hdl/symbols';
import { focusedDoc, focusedEditor, getEditors, onCompareChange, revealDoc } from './editorView';
import { isPanelVisible, registerSidebarPanel } from './sidebar';

// Outline panel: a tree of the HDL symbols in the active file (Notepad++'s Function List).

const ICON: Record<HdlKind, string> = {
  module: 'symbol-module',
  interface: 'symbol-interface',
  program: 'symbol-module',
  package: 'symbol-package',
  class: 'symbol-class',
  entity: 'symbol-module',
  architecture: 'symbol-namespace',
  component: 'symbol-interface',
  port: 'symbol-field',
  parameter: 'symbol-constant',
  signal: 'symbol-variable',
  constant: 'symbol-constant',
  type: 'symbol-struct',
  function: 'symbol-function',
  task: 'symbol-method',
  process: 'symbol-event',
  instance: 'symbol-object',
  generate: 'symbol-namespace',
  modport: 'symbol-interface',
};

export function initOutline(root: HTMLElement): void {
  const controls = document.createElement('div');
  controls.className = 'panel-controls';
  const row = document.createElement('div');
  row.className = 'input-row';
  const filter = document.createElement('input');
  filter.className = 'panel-input';
  filter.type = 'search';
  filter.placeholder = 'Filter symbols';
  filter.spellcheck = false;
  filter.setAttribute('aria-label', 'Filter symbols');
  const mkBtn = (icon: string, title: string, run: () => void) => {
    const b = document.createElement('button');
    b.className = `icon-btn codicon codicon-${icon}`;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.addEventListener('click', run);
    return b;
  };
  row.append(
    filter,
    mkBtn('collapse-all', 'Collapse all', () => setAll(true)),
    mkBtn('expand-all', 'Expand all', () => setAll(false)),
  );
  controls.append(row);
  const list = document.createElement('div');
  list.className = 'panel-list';
  list.setAttribute('role', 'tree');
  root.append(controls, list);

  /** Collapsed nodes, keyed by doc id + symbol path. */
  const collapsed = new Set<string>();
  let rows: { el: HTMLElement; sym: HdlSymbol }[] = [];
  let current: HTMLElement | null = null;
  let lastSyms: HdlSymbol[] | null = null;
  let lastDocId = '';

  const keyOf = (docId: string, path: HdlSymbol[]) => docId + '/' + path.map((s) => `${s.kind}:${s.name}`).join('/');

  const setAll = (collapse: boolean) => {
    const doc = focusedDoc();
    const syms = doc && symbolsFor(doc.model);
    if (!doc || !syms) return;
    const walk = (level: HdlSymbol[], path: HdlSymbol[]) => {
      for (const s of level) {
        if (!s.children.length) continue;
        const p = [...path, s];
        if (collapse) collapsed.add(keyOf(doc.id, p));
        else collapsed.delete(keyOf(doc.id, p));
        walk(s.children, p);
      }
    };
    walk(syms, []);
    render(true);
  };

  const render = (force = false) => {
    if (!isPanelVisible('outline')) return;
    const doc = focusedDoc();
    const syms = doc ? symbolsFor(doc.model) : null;
    if (!force && doc?.id === lastDocId && syms === lastSyms) {
      highlight();
      return;
    }
    lastSyms = syms;
    lastDocId = doc?.id ?? '';
    rows = [];
    current = null;
    if (!doc) {
      list.replaceChildren(empty('No file open.'));
      return;
    }
    if (!syms) {
      list.replaceChildren(
        empty(`No outline for ${languageLabel(doc.model.getLanguageId())}. The outline works with Verilog, SystemVerilog and VHDL files.`),
      );
      return;
    }
    if (syms.length === 0) {
      list.replaceChildren(empty('No modules, entities or packages found.'));
      return;
    }
    const q = filter.value.trim().toLowerCase();
    const matches = (s: HdlSymbol): boolean => !q || s.name.toLowerCase().includes(q) || s.children.some(matches);
    const frag = document.createDocumentFragment();
    const add = (level: HdlSymbol[], path: HdlSymbol[]) => {
      for (const s of level) {
        if (!matches(s)) continue;
        const p = [...path, s];
        const key = keyOf(doc.id, p);
        const hasKids = s.children.length > 0;
        const open = !collapsed.has(key) || !!q;
        const el = document.createElement('button');
        el.className = 'tree-row';
        el.setAttribute('role', 'treeitem');
        el.style.setProperty('--depth', String(path.length));
        if (hasKids) el.setAttribute('aria-expanded', String(open));
        const twisty = document.createElement('span');
        twisty.className = 'tree-twisty codicon' + (hasKids ? (open ? ' codicon-chevron-down' : ' codicon-chevron-right') : '');
        twisty.addEventListener('click', (e) => {
          if (!hasKids) return;
          e.stopPropagation();
          if (open) collapsed.add(key);
          else collapsed.delete(key);
          render(true);
        });
        const icon = document.createElement('span');
        icon.className = `tree-icon codicon codicon-${ICON[s.kind]} k-${s.kind}`;
        icon.title = s.kind;
        const name = document.createElement('span');
        name.className = 'tree-name';
        name.textContent = s.name;
        el.append(twisty, icon, name);
        if (s.detail) {
          const detail = document.createElement('span');
          detail.className = 'tree-detail';
          detail.textContent = s.detail;
          el.append(detail);
        }
        el.title = `${s.kind} ${s.name}${s.detail ? '  ' + s.detail : ''}`;
        el.addEventListener('click', () => revealDoc(doc, rangeOf(doc.model, s.nameStart, s.nameEnd)));
        el.addEventListener('keydown', (e) => {
          if (!hasKids) return;
          if ((e.key === 'ArrowRight' && !open) || (e.key === 'ArrowLeft' && open)) {
            e.preventDefault();
            twisty.click();
            (list.querySelector(`[data-key="${CSS.escape(key)}"]`) as HTMLElement | null)?.focus();
          }
        });
        el.dataset.key = key;
        frag.append(el);
        rows.push({ el, sym: s });
        if (hasKids && open) add(s.children, p);
      }
    };
    add(syms, []);
    list.replaceChildren(frag);
    if (!rows.length) list.append(empty('No symbols match the filter.'));
    highlight();
  };

  const empty = (text: string) => {
    const p = document.createElement('div');
    p.className = 'panel-empty';
    p.textContent = text;
    return p;
  };

  /** Mark the innermost visible symbol that contains the cursor. */
  const highlight = () => {
    const doc = focusedDoc();
    const pos = focusedEditor().getPosition();
    if (!doc || !pos || !lastSyms || focusedEditor().getModel() !== doc.model) return;
    const path = symbolPathAt(lastSyms, doc.model.getOffsetAt(pos));
    let hit: HTMLElement | null = null;
    for (let i = path.length - 1; i >= 0 && !hit; i--) hit = rows.find((r) => r.sym === path[i])?.el ?? null;
    if (hit === current) return;
    current?.classList.remove('current');
    hit?.classList.add('current');
    current = hit;
    if (hit && document.activeElement !== filter) hit.scrollIntoView({ block: 'nearest' });
  };

  let timer = 0;
  const schedule = (delay = 250) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => render(), delay);
  };
  filter.addEventListener('input', () => render(true));
  registerSidebarPanel('outline', () => render(true));
  store.subscribe(() => schedule(0));
  store.onContent(() => schedule());
  onCompareChange(() => schedule(0));
  let raf = 0;
  for (const ed of getEditors()) {
    ed.onDidChangeCursorPosition(() => {
      if (!isPanelVisible('outline')) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(highlight);
    });
    ed.onDidChangeModelLanguage(() => schedule(0));
  }
}

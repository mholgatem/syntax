import { monaco } from '../editor/monacoSetup';
import { store, type Doc } from '../state/documents';
import { focusedEditor, revealDoc } from './editorView';
import { toast } from './dialogs';
import { isPanelVisible, registerSidebarPanel, showSidebarTab } from './sidebar';

// Find / replace across every open tab (Notepad++ "Find in All Opened Documents").

const WORD_SEPARATORS = '`~!@#$%^&*()-=+[{]}\\|;:\'",.<>/?';
const MAX_PER_FILE = 1000;
const MAX_ROWS = 3000;

interface FileResult {
  doc: Doc;
  matches: monaco.editor.FindMatch[];
}

/** Expand `$1`, `$&`, `$$`, `\n`, `\t` in a regex replacement string. */
export function expandReplacement(template: string, groups: string[] | null): string {
  return template.replace(/\$(\$|&|\d{1,2})|\\([nt\\])/g, (_m, g: string | undefined, esc: string | undefined) => {
    if (esc) return esc === 'n' ? '\n' : esc === 't' ? '\t' : '\\';
    if (g === '$') return '$';
    if (g === '&') return groups?.[0] ?? '';
    return groups?.[Number(g)] ?? '';
  });
}

let openSearchImpl: (() => void) | null = null;

/** Show the search panel, prefilled with the editor selection, and focus the query box. */
export function openSearchPanel(): void {
  showSidebarTab('search');
  openSearchImpl?.();
}

export function initSearchPanel(root: HTMLElement): void {
  const state = { matchCase: false, wholeWord: false, regex: false };
  const controls = document.createElement('div');
  controls.className = 'panel-controls';

  const mkInput = (placeholder: string) => {
    const el = document.createElement('input');
    el.className = 'panel-input';
    el.type = 'text';
    el.placeholder = placeholder;
    el.spellcheck = false;
    el.setAttribute('aria-label', placeholder);
    return el;
  };
  const mkToggle = (icon: string, title: string, key: keyof typeof state) => {
    const b = document.createElement('button');
    b.className = `icon-btn codicon codicon-${icon}`;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => {
      state[key] = !state[key];
      b.classList.toggle('on', state[key]);
      b.setAttribute('aria-pressed', String(state[key]));
      run();
    });
    return b;
  };

  const find = mkInput('Find in all tabs');
  find.id = 'search-find';
  const findRow = document.createElement('div');
  findRow.className = 'input-row';
  findRow.append(
    find,
    mkToggle('case-sensitive', 'Match case', 'matchCase'),
    mkToggle('whole-word', 'Match whole word', 'wholeWord'),
    mkToggle('regex', 'Use regular expression', 'regex'),
  );

  const replace = mkInput('Replace with');
  replace.id = 'search-replace';
  const replaceAll = document.createElement('button');
  replaceAll.className = 'icon-btn codicon codicon-replace-all';
  replaceAll.title = 'Replace all in all tabs';
  replaceAll.setAttribute('aria-label', replaceAll.title);
  const replaceRow = document.createElement('div');
  replaceRow.className = 'input-row';
  replaceRow.append(replace, replaceAll);

  controls.append(findRow, replaceRow);
  const summary = document.createElement('div');
  summary.className = 'panel-summary';
  summary.setAttribute('aria-live', 'polite');
  const list = document.createElement('div');
  list.className = 'panel-list';
  root.append(controls, summary, list);

  const collapsed = new Set<string>();
  let results: FileResult[] = [];

  const validate = (): boolean => {
    if (!state.regex) return true;
    try {
      new RegExp(find.value);
      return true;
    } catch (err) {
      summary.textContent = `Invalid regular expression: ${(err as Error).message.replace(/^Invalid regular expression: /, '')}`;
      summary.classList.add('error');
      find.classList.add('invalid');
      return false;
    }
  };

  const search = (): FileResult[] => {
    const q = find.value;
    if (!q) return [];
    const out: FileResult[] = [];
    for (const doc of store.docs) {
      const matches = doc.model.findMatches(
        q,
        false,
        state.regex,
        state.matchCase,
        state.wholeWord ? WORD_SEPARATORS : null,
        state.regex,
        MAX_PER_FILE,
      );
      if (matches.length) out.push({ doc, matches });
    }
    return out;
  };

  function run(): void {
    window.clearTimeout(timer);
    summary.classList.remove('error');
    find.classList.remove('invalid');
    if (!find.value) {
      results = [];
      summary.textContent = '';
      list.replaceChildren();
      replaceAll.disabled = true;
      return;
    }
    if (!validate()) {
      results = [];
      list.replaceChildren();
      replaceAll.disabled = true;
      return;
    }
    results = search();
    const total = results.reduce((n, r) => n + r.matches.length, 0);
    replaceAll.disabled = total === 0;
    summary.textContent =
      total === 0
        ? 'No results in open tabs.'
        : `${total.toLocaleString()} result${total === 1 ? '' : 's'} in ${results.length} file${results.length === 1 ? '' : 's'}` +
          (results.some((r) => r.matches.length >= MAX_PER_FILE) ? ` (showing the first ${MAX_PER_FILE} per file)` : '');
    render();
  }

  const render = () => {
    const frag = document.createDocumentFragment();
    let rows = 0;
    for (const r of results) {
      const head = document.createElement('div');
      head.className = 'result-file';
      head.title = r.doc.name;
      const open = !collapsed.has(r.doc.id);
      const twisty = document.createElement('span');
      twisty.className = `tree-twisty codicon codicon-chevron-${open ? 'down' : 'right'}`;
      const name = document.createElement('span');
      name.className = 'tree-name';
      name.textContent = r.doc.name;
      const count = document.createElement('span');
      count.className = 'result-count';
      count.textContent = String(r.matches.length);
      const rep = document.createElement('button');
      rep.className = 'icon-btn codicon codicon-replace-all';
      rep.title = `Replace all in ${r.doc.name}`;
      rep.setAttribute('aria-label', rep.title);
      rep.addEventListener('click', (e) => {
        e.stopPropagation();
        const n = replaceIn(r);
        toast(`Replaced ${n} occurrence${n === 1 ? '' : 's'} in ${r.doc.name}`);
        run();
      });
      head.append(twisty, name, count, rep);
      head.addEventListener('click', () => {
        if (open) collapsed.add(r.doc.id);
        else collapsed.delete(r.doc.id);
        render();
      });
      frag.append(head);
      if (!open) continue;
      for (const m of r.matches) {
        if (rows++ >= MAX_ROWS) break;
        frag.append(resultLine(r.doc, m));
      }
    }
    if (rows > MAX_ROWS) {
      const more = document.createElement('div');
      more.className = 'panel-empty';
      more.textContent = `Showing the first ${MAX_ROWS.toLocaleString()} results. Refine the search to see more.`;
      frag.append(more);
    }
    list.replaceChildren(frag);
  };

  const resultLine = (doc: Doc, m: monaco.editor.FindMatch) => {
    const { startLineNumber: ln, startColumn, endLineNumber, endColumn } = m.range;
    const text = doc.model.getLineContent(ln);
    const s = startColumn - 1;
    const e = endLineNumber === ln ? endColumn - 1 : text.length;
    const from = Math.max(0, s - 40);
    const el = document.createElement('button');
    el.className = 'result-line';
    const num = document.createElement('span');
    num.className = 'result-ln';
    num.textContent = String(ln);
    const body = document.createElement('span');
    body.className = 'result-text';
    const mark = document.createElement('mark');
    mark.textContent = text.slice(s, e) || ' ';
    body.append((from > 0 ? '…' : '') + text.slice(from, s).trimStart(), mark, text.slice(e, e + 200));
    el.append(num, body);
    el.title = `${doc.name}:${ln}`;
    el.addEventListener('click', () => revealDoc(doc, m.range));
    return el;
  };

  const replaceIn = (r: FileResult): number => {
    const edits = r.matches.map((m) => ({
      range: m.range,
      text: state.regex ? expandReplacement(replace.value, m.matches) : replace.value,
      forceMoveMarkers: true,
    }));
    const model = r.doc.model;
    model.pushStackElement();
    model.pushEditOperations([], edits, () => null);
    model.pushStackElement();
    return edits.length;
  };

  replaceAll.addEventListener('click', () => {
    run();
    let n = 0;
    for (const r of results) n += replaceIn(r);
    toast(`Replaced ${n} occurrence${n === 1 ? '' : 's'} in ${results.length} file${results.length === 1 ? '' : 's'}`);
    run();
  });

  let timer = 0;
  const schedule = (delay: number) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      if (isPanelVisible('search')) run();
    }, delay);
  };
  find.addEventListener('input', () => schedule(200));
  find.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      run();
      (list.querySelector('.result-line') as HTMLElement | null)?.click();
    } else if (e.key === 'Escape') focusedEditor().focus();
  });
  replace.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') focusedEditor().focus();
  });
  store.onContent(() => {
    if (find.value) schedule(400);
  });
  store.subscribe(() => {
    if (find.value && results.some((r) => !store.get(r.doc.id))) schedule(0);
  });
  registerSidebarPanel('search', () => schedule(0));

  openSearchImpl = () => {
    const ed = focusedEditor();
    const sel = ed.getSelection();
    const model = ed.getModel();
    if (model && sel && !sel.isEmpty() && sel.startLineNumber === sel.endLineNumber) {
      find.value = model.getValueInRange(sel);
      run();
    }
    find.focus();
    find.select();
  };
  replaceAll.disabled = true;
}

import { monaco } from '../monacoSetup';
import { store, type Doc } from '../../state/documents';
import { settings } from '../../state/settings';
import { pickOne, toast } from '../../ui/dialogs';
import { hdlLang, type HdlLang } from './lex';
import { INSTANTIABLE, parseHdl, symbolPathAt, walkSymbols, type HdlKind, type HdlSymbol } from './symbols';
import { instanceTemplate } from './instance';
import { alignLines, blockAround } from './align';

// Wires the pure HDL parser / aligner into Monaco: Go to Symbol, the outline, Go to
// Definition across open tabs, "Copy as Instance", and Align Statements (+ auto-align).

type Model = monaco.editor.ITextModel;
type Editor = monaco.editor.ICodeEditor;

const HDL_LANGUAGES = ['verilog', 'systemverilog', 'vhdl'];
const HDL_WHEN = HDL_LANGUAGES.map((l) => `editorLangId == ${l}`).join(' || ');
const MAX_PARSE_CHARS = 8 * 1024 * 1024;

const cache = new WeakMap<Model, { version: number; lang: HdlLang; symbols: HdlSymbol[] }>();

/** Parsed outline for an HDL model (cached per version), or null for other languages. */
export function symbolsFor(model: Model): HdlSymbol[] | null {
  const lang = hdlLang(model.getLanguageId());
  if (!lang) return null;
  const version = model.getVersionId();
  const hit = cache.get(model);
  if (hit && hit.version === version && hit.lang === lang) return hit.symbols;
  const symbols = model.getValueLength() > MAX_PARSE_CHARS ? [] : parseHdl(model.getValue(), lang);
  cache.set(model, { version, lang, symbols });
  return symbols;
}

export function rangeOf(model: Model, start: number, end: number): monaco.Range {
  const a = model.getPositionAt(start);
  const b = model.getPositionAt(end);
  return new monaco.Range(a.lineNumber, a.column, b.lineNumber, b.column);
}

const SK = monaco.languages.SymbolKind;
export const SYMBOL_KIND: Record<HdlKind, monaco.languages.SymbolKind> = {
  module: SK.Module,
  interface: SK.Interface,
  program: SK.Module,
  package: SK.Package,
  class: SK.Class,
  entity: SK.Module,
  architecture: SK.Namespace,
  component: SK.Interface,
  port: SK.Field,
  parameter: SK.Constant,
  signal: SK.Variable,
  constant: SK.Constant,
  type: SK.Struct,
  function: SK.Function,
  task: SK.Method,
  process: SK.Event,
  instance: SK.Object,
  generate: SK.Namespace,
  modport: SK.Interface,
};

function toDocumentSymbol(model: Model, s: HdlSymbol): monaco.languages.DocumentSymbol {
  const range = rangeOf(model, s.start, s.end);
  const sel = rangeOf(model, s.nameStart, s.nameEnd);
  return {
    name: s.name,
    detail: s.detail,
    kind: SYMBOL_KIND[s.kind],
    tags: [],
    range,
    // Monaco requires the selection range to be inside the full range.
    selectionRange: range.containsRange(sel) ? sel : range,
    children: s.children.map((c) => toDocumentSymbol(model, c)),
  };
}

const sameName = (lang: HdlLang) =>
  lang === 'vhdl' ? (a: string, b: string) => a.toLowerCase() === b.toLowerCase() : (a: string, b: string) => a === b;

/** Docs in the same HDL family as `lang`. */
function hdlDocs(lang: HdlLang): Doc[] {
  return store.docs.filter((d) => hdlLang(d.model.getLanguageId()) === lang);
}

/** Design units (and package-level declarations) named `name` across all open docs. */
function findUnits(lang: HdlLang, name: string, kinds?: ReadonlySet<HdlKind>): { model: Model; sym: HdlSymbol }[] {
  const eq = sameName(lang);
  const out: { model: Model; sym: HdlSymbol }[] = [];
  for (const d of hdlDocs(lang)) {
    for (const top of symbolsFor(d.model) ?? []) {
      const consider = [top, ...(top.kind === 'package' ? top.children : [])];
      for (const s of consider) {
        if (eq(s.name, name) && (!kinds || kinds.has(s.kind)) && s.kind !== 'architecture') out.push({ model: d.model, sym: s });
      }
    }
  }
  // An entity is a better target than a component declaration of it.
  return out.sort((a, b) => Number(a.sym.kind === 'component') - Number(b.sym.kind === 'component'));
}

const location = (model: Model, s: HdlSymbol): monaco.languages.Location => ({
  uri: model.uri,
  range: rangeOf(model, s.nameStart, s.nameEnd),
});

function provideDefinition(model: Model, position: monaco.Position): monaco.languages.Location[] | null {
  const lang = hdlLang(model.getLanguageId());
  const word = model.getWordAtPosition(position);
  if (!lang || !word) return null;
  const eq = sameName(lang);
  const syms = symbolsFor(model) ?? [];
  const path = symbolPathAt(syms, model.getOffsetAt(position));

  // 1. Declarations in enclosing scopes, innermost first.
  for (let d = path.length - 1; d >= 0; d--) {
    const hits = path[d].children.filter((c) => c.kind !== 'process' && eq(c.name, word.word));
    if (hits.length) return hits.map((h) => location(model, h));
  }
  // 2. VHDL architecture: the ports and generics of its entity.
  const arch = path.find((s) => s.kind === 'architecture');
  if (lang === 'vhdl' && arch?.of) {
    for (const { model: m, sym } of findUnits(lang, arch.of, new Set(['entity']))) {
      const hit = sym.children.find((c) => eq(c.name, word.word));
      if (hit) return [location(m, hit)];
    }
  }
  // 3. Design units, packages, classes and package members in any open tab.
  const units = findUnits(lang, word.word);
  if (units.length) return units.map(({ model: m, sym }) => location(m, sym));
  // 4. Anything else in this file with that name.
  const any: monaco.languages.Location[] = [];
  walkSymbols(syms, (s) => {
    if (eq(s.name, word.word)) any.push(location(model, s));
  });
  return any.length ? any : null;
}

function indentUnit(model: Model): string {
  const o = model.getOptions();
  return o.insertSpaces ? ' '.repeat(o.indentSize ?? o.tabSize) : '\t';
}

/** The instantiable unit under the cursor, or the first one in the file. */
function unitAt(ed: Editor): { unit: HdlSymbol; lang: HdlLang } | null {
  const model = ed.getModel();
  const pos = ed.getPosition();
  const lang = model && hdlLang(model.getLanguageId());
  if (!model || !pos || !lang) return null;
  const syms = symbolsFor(model) ?? [];
  const path = symbolPathAt(syms, model.getOffsetAt(pos));
  // On an instance: the module it instantiates, if it is open.
  const inst = [...path].reverse().find((s) => s.kind === 'instance');
  if (inst?.of) {
    const target = findUnits(lang, inst.of, INSTANTIABLE)[0];
    if (target) return { unit: target.sym, lang };
  }
  let unit = [...path].reverse().find((s) => INSTANTIABLE.has(s.kind));
  if (!unit) {
    // In a VHDL architecture, use its entity.
    const arch = path.find((s) => s.kind === 'architecture');
    if (arch?.of) unit = findUnits(lang, arch.of, new Set(['entity']))[0]?.sym;
  }
  if (!unit) walkSymbols(syms, (s) => (unit ??= INSTANTIABLE.has(s.kind) ? s : undefined));
  return unit ? { unit, lang } : null;
}

export async function copyAsInstance(ed: Editor): Promise<void> {
  const found = unitAt(ed);
  const model = ed.getModel();
  if (!found || !model) {
    toast('No module or entity found in this file.', 'error');
    return;
  }
  const text = instanceTemplate(found.unit, found.lang, indentUnit(model));
  try {
    await navigator.clipboard.writeText(text);
    toast(`Copied an instance of ${found.unit.name}`);
  } catch {
    toast('Could not write to the clipboard.', 'error');
  }
}

/** Every instantiable unit in open tabs of the same HDL family. */
function allUnits(lang: HdlLang): { doc: Doc; sym: HdlSymbol }[] {
  const out: { doc: Doc; sym: HdlSymbol }[] = [];
  for (const doc of hdlDocs(lang)) {
    walkSymbols(symbolsFor(doc.model) ?? [], (s, parent) => {
      if (INSTANTIABLE.has(s.kind) && !(s.kind === 'component' && parent?.kind === 'architecture')) out.push({ doc, sym: s });
    });
  }
  return out;
}

export async function insertInstance(ed: Editor): Promise<void> {
  const model = ed.getModel();
  const lang = model && hdlLang(model.getLanguageId());
  if (!model || !lang) {
    toast('Insert Instance works in Verilog, SystemVerilog and VHDL files.', 'error');
    return;
  }
  const units = allUnits(lang);
  if (units.length === 0) {
    toast('No modules or entities found in the open tabs.', 'error');
    return;
  }
  const picked = await pickOne(
    'Insert instance of…',
    units.map((u, i) => ({ value: String(i), label: u.sym.name, hint: `${u.sym.kind} in ${u.doc.name}` })),
    'Insert',
  );
  if (picked === null) return;
  const { sym } = units[Number(picked)];
  const pos = ed.getPosition();
  if (!pos) return;
  const lineIndent = /^\s*/.exec(model.getLineContent(pos.lineNumber))![0];
  const text = instanceTemplate(sym, lang, indentUnit(model)).split('\n').join(model.getEOL() + lineIndent);
  ed.focus();
  ed.pushUndoStop();
  ed.executeEdits('insert-instance', [{ range: monaco.Range.fromPositions(pos), text, forceMoveMarkers: true }]);
  ed.pushUndoStop();
}

/** Replace lines [start, start + newLines.length) where they differ, as one undo step. */
function applyLines(ed: Editor, start: number, oldLines: string[], newLines: string[]): boolean {
  const model = ed.getModel()!;
  const edits: monaco.editor.IIdentifiedSingleEditOperation[] = [];
  newLines.forEach((text, i) => {
    if (text !== oldLines[i]) {
      const line = start + i;
      edits.push({ range: new monaco.Range(line, 1, line, model.getLineMaxColumn(line)), text });
    }
  });
  if (edits.length === 0) return false;
  ed.pushUndoStop();
  ed.executeEdits('align', edits);
  ed.pushUndoStop();
  return true;
}

/** Align the selected lines, or the block around the cursor. */
export function alignStatements(ed: Editor): void {
  const model = ed.getModel();
  const lang = model && hdlLang(model.getLanguageId());
  const sel = ed.getSelection();
  if (!model || !lang || !sel) return;
  if (!sel.isEmpty() && sel.startLineNumber !== sel.endLineNumber) {
    const start = sel.startLineNumber;
    const end = sel.endColumn === 1 ? sel.endLineNumber - 1 : sel.endLineNumber;
    const lines: string[] = [];
    for (let l = start; l <= end; l++) lines.push(model.getLineContent(l));
    applyLines(ed, start, lines, alignLines(lines, lang));
    return;
  }
  alignAround(ed, model, lang, sel.positionLineNumber);
}

function alignAround(ed: Editor, model: Model, lang: HdlLang, line: number): boolean {
  const from = Math.max(1, line - 300);
  const to = Math.min(model.getLineCount(), line + 300);
  const window: string[] = [];
  for (let l = from; l <= to; l++) window.push(model.getLineContent(l));
  const block = blockAround(window, line - from, lang);
  if (!block) return false;
  const lines = window.slice(block[0], block[1] + 1);
  return applyLines(ed, from + block[0], lines, alignLines(lines, lang));
}

/** With the Auto-Align setting on, realign the block above the cursor after Enter. */
export function attachAutoAlign(ed: Editor): void {
  let enter = false;
  ed.onKeyDown((e) => {
    enter = e.keyCode === monaco.KeyCode.Enter && !e.ctrlKey && !e.altKey && !e.metaKey;
    if (enter) window.setTimeout(() => (enter = false), 0);
  });
  ed.onDidChangeModelContent((e) => {
    if (!enter || e.isUndoing || e.isRedoing || !e.changes.some((c) => c.text.includes('\n'))) return;
    enter = false;
    if (!settings.get().autoAlign) return;
    const model = ed.getModel();
    const lang = model && hdlLang(model.getLanguageId());
    if (!model || !lang) return;
    window.setTimeout(() => {
      const pos = ed.getPosition();
      if (pos && pos.lineNumber > 1 && ed.getModel() === model) alignAround(ed, model, lang, pos.lineNumber - 1);
    }, 0);
  });
}

/** Register providers and editor actions. `reveal` opens a doc's tab and selects a range. */
export function initHdlFeatures(reveal: (doc: Doc, selection: monaco.IRange | monaco.IPosition | undefined) => void): void {
  for (const id of HDL_LANGUAGES) {
    monaco.languages.registerDocumentSymbolProvider(id, {
      displayName: 'Syntax HDL outline',
      provideDocumentSymbols: (model) => (symbolsFor(model) ?? []).map((s) => toDocumentSymbol(model, s)),
    });
    monaco.languages.registerDefinitionProvider(id, { provideDefinition: (model, position) => provideDefinition(model, position) });
  }

  // Go to Definition into another tab.
  monaco.editor.registerEditorOpener({
    openCodeEditor(_source, resource, selectionOrPosition) {
      const doc = store.docs.find((d) => d.model.uri.toString() === resource.toString());
      if (!doc) return false;
      reveal(doc, selectionOrPosition);
      return true;
    },
  });

  monaco.editor.addEditorAction({
    id: 'syntax.hdl.copyInstance',
    label: 'Copy as Instance',
    precondition: HDL_WHEN,
    contextMenuGroupId: '1_hdl',
    contextMenuOrder: 1,
    run: (ed) => copyAsInstance(ed),
  });
  monaco.editor.addEditorAction({
    id: 'syntax.hdl.insertInstance',
    label: 'Insert Instance of…',
    precondition: HDL_WHEN,
    contextMenuGroupId: '1_hdl',
    contextMenuOrder: 2,
    run: (ed) => insertInstance(ed),
  });
  monaco.editor.addEditorAction({
    id: 'syntax.hdl.align',
    label: 'Align Statements',
    precondition: HDL_WHEN,
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyA],
    contextMenuGroupId: '1_hdl',
    contextMenuOrder: 3,
    run: (ed) => alignStatements(ed),
  });
}

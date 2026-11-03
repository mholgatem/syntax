import { monaco } from '../editor/monacoSetup';
import { detectLanguage } from '../editor/languages';
import { detectEol, hashText, type Encoding, type Eol } from '../io/text';
import { settings } from './settings';

export interface Doc {
  id: string;
  name: string;
  model: monaco.editor.ITextModel;
  /** Alternative version id at last save; the doc is dirty when the model's differs. */
  savedVersionId: number;
  /** Hash of the text as last saved (used by session restore). */
  savedHash: string;
  /** True when something other than the text changed (e.g. encoding). */
  metaDirty: boolean;
  handle?: FileSystemFileHandle;
  encoding: Encoding;
  untitled: boolean;
  /** Language was chosen by the user, so renaming should not change it. */
  languageLocked: boolean;
  viewState: monaco.editor.ICodeEditorViewState | null;
}

export interface CreateDocOptions {
  name: string;
  text: string;
  languageId?: string;
  handle?: FileSystemFileHandle;
  encoding?: Encoding;
  untitled?: boolean;
  /** Hash of the content as last saved; if it differs from `text` the doc starts dirty. */
  savedHash?: string;
  viewState?: monaco.editor.ICodeEditorViewState | null;
  languageLocked?: boolean;
  id?: string;
  /** Saved indentation; detected from the content when absent. */
  indent?: { tabSize: number; insertSpaces: boolean };
  /** View to open in (defaults to the focused one). */
  pane?: PaneIndex;
}

export type PaneIndex = 0 | 1;

/** One of the two side-by-side views. Each has its own tab order and active tab. */
export interface Pane {
  ids: string[];
  activeId: string | null;
}

type Listener = () => void;

let seq = 0;
const newId = () => `${Date.now().toString(36)}-${(seq++).toString(36)}`;

class DocStore {
  /** Every open doc, in the order it was opened. */
  docs: Doc[] = [];
  /** The two views. A doc can be shown in one or both ("cloned"). */
  panes: [Pane, Pane] = [
    { ids: [], activeId: null },
    { ids: [], activeId: null },
  ];
  focusedPane: PaneIndex = 0;
  private listeners = new Set<Listener>();
  private contentListeners = new Set<(doc: Doc) => void>();

  /** Fires when the tab list, active tab, names, languages or dirty flags change. */
  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  /** Fires on every text change (high frequency). */
  onContent(l: (doc: Doc) => void): () => void {
    this.contentListeners.add(l);
    return () => this.contentListeners.delete(l);
  }

  /** Dirty state as of the last emit, so text edits only re-render when it actually flips. */
  private notifiedDirty = new WeakMap<Doc, boolean>();

  emit(): void {
    // Record what listeners are about to see. Every state change (save, encoding, EOL,
    // rename, ...) goes through here, so the per-edit check below can't go stale.
    for (const d of this.docs) this.notifiedDirty.set(d, this.isDirty(d));
    for (const l of this.listeners) l();
  }

  /** The active doc of the focused view. */
  get activeId(): string | null {
    return this.panes[this.focusedPane].activeId;
  }

  get active(): Doc | undefined {
    return this.docs.find((d) => d.id === this.activeId);
  }

  /** True when the second view has tabs. */
  get split(): boolean {
    return this.panes[1].ids.length > 0;
  }

  paneDocs(p: PaneIndex): Doc[] {
    return this.panes[p].ids.map((id) => this.get(id)).filter((d): d is Doc => !!d);
  }

  /** The views showing `id`. */
  panesOf(id: string): PaneIndex[] {
    return ([0, 1] as const).filter((p) => this.panes[p].ids.includes(id));
  }

  get(id: string): Doc | undefined {
    return this.docs.find((d) => d.id === id);
  }

  create(opts: CreateDocOptions): Doc {
    const id = opts.id ?? newId();
    const languageId = opts.languageId ?? detectLanguage(opts.name);
    const uri = monaco.Uri.from({ scheme: 'inmemory', authority: 'doc', path: `/${id}/${opts.name}` });
    const model = monaco.editor.createModel(opts.text, languageId, uri);
    model.setEOL(
      detectEol(opts.text) === 'CRLF' ? monaco.editor.EndOfLineSequence.CRLF : monaco.editor.EndOfLineSequence.LF,
    );
    if (opts.indent) model.updateOptions(opts.indent);
    else {
      const s = settings.get();
      model.detectIndentation(s.defaultInsertSpaces, s.defaultTabSize);
    }
    const currentHash = hashText(opts.text);
    const clean = opts.savedHash === undefined || opts.savedHash === currentHash;
    const doc: Doc = {
      id,
      name: opts.name,
      model,
      savedVersionId: clean ? model.getAlternativeVersionId() : -1,
      savedHash: opts.savedHash ?? currentHash,
      metaDirty: false,
      handle: opts.handle,
      encoding: opts.encoding ?? 'UTF-8',
      untitled: opts.untitled ?? false,
      languageLocked: opts.languageLocked ?? false,
      viewState: opts.viewState ?? null,
    };
    model.onDidChangeContent(() => {
      for (const l of this.contentListeners) l(doc);
      if (this.isDirty(doc) !== this.notifiedDirty.get(doc)) this.emit();
    });
    model.onDidChangeOptions(() => this.emit()); // indentation shown in the status bar
    this.docs.push(doc);
    this.panes[opts.pane ?? this.focusedPane].ids.push(id);
    this.emit();
    return doc;
  }

  /** Create an empty "new N" document, using the lowest free N. */
  createUntitled(): Doc {
    const used = new Set(this.docs.map((d) => d.name));
    let n = 1;
    while (used.has(`new ${n}`)) n++;
    return this.create({ name: `new ${n}`, text: '', untitled: true });
  }

  isDirty(doc: Doc): boolean {
    return doc.metaDirty || doc.model.getAlternativeVersionId() !== doc.savedVersionId;
  }

  anyDirty(): boolean {
    return this.docs.some((d) => this.isDirty(d));
  }

  markSaved(doc: Doc): void {
    // Close the current undo group so that undo can stop exactly at the saved state
    // (otherwise typing just before and after a save merges into one undo step).
    doc.model.pushStackElement();
    doc.savedVersionId = doc.model.getAlternativeVersionId();
    doc.savedHash = hashText(doc.model.getValue());
    doc.metaDirty = false;
    doc.untitled = false;
    this.emit();
  }

  /** Remove a doc from every view without prompting (callers handle unsaved changes). */
  remove(id: string): void {
    const idx = this.docs.findIndex((d) => d.id === id);
    if (idx < 0) return;
    const [doc] = this.docs.splice(idx, 1);
    for (const p of [0, 1] as const) this.dropFromPane(id, p);
    this.normalize();
    for (const l of this.removeListeners) l(doc);
    this.emit();
    doc.model.dispose();
  }

  private removeListeners = new Set<(doc: Doc) => void>();

  /** Fires just before a doc is closed (its model is still alive). */
  onRemove(l: (doc: Doc) => void): void {
    this.removeListeners.add(l);
  }

  /** Close a cloned doc in one view only (it stays open in the other). */
  removeFromPane(id: string, p: PaneIndex): void {
    this.dropFromPane(id, p);
    this.normalize();
    this.emit();
  }

  private dropFromPane(id: string, p: PaneIndex): void {
    const pane = this.panes[p];
    const i = pane.ids.indexOf(id);
    if (i < 0) return;
    pane.ids.splice(i, 1);
    if (pane.activeId === id) pane.activeId = pane.ids[i] ?? pane.ids[i - 1] ?? null;
  }

  /** Keep the layout sensible: the left view is used first, and focus is on a view with tabs. */
  private normalize(): void {
    const [a, b] = this.panes;
    if (a.ids.length === 0 && b.ids.length > 0) {
      this.panes = [b, a];
      this.focusedPane = 0;
    }
    if (this.panes[this.focusedPane].ids.length === 0) this.focusedPane = 0;
    for (const pane of this.panes) {
      if (pane.activeId !== null && !pane.ids.includes(pane.activeId)) pane.activeId = pane.ids[0] ?? null;
    }
  }

  /** Activate a doc: in the focused view if it is there, else in the view that has it. */
  setActive(id: string | null): void {
    if (id === null) {
      if (this.panes[this.focusedPane].activeId === null) return;
      this.panes[this.focusedPane].activeId = null;
      this.emit();
      return;
    }
    let p = this.focusedPane;
    if (!this.panes[p].ids.includes(id)) {
      const other: PaneIndex = p === 0 ? 1 : 0;
      if (this.panes[other].ids.includes(id)) p = other;
    }
    this.setActiveInPane(id, p);
  }

  setActiveInPane(id: string, p: PaneIndex): void {
    if (!this.panes[p].ids.includes(id)) this.panes[p].ids.push(id);
    if (this.focusedPane === p && this.panes[p].activeId === id) return;
    this.focusedPane = p;
    this.panes[p].activeId = id;
    this.emit();
  }

  focusPane(p: PaneIndex): void {
    if (this.focusedPane === p || this.panes[p].ids.length === 0) return;
    this.focusedPane = p;
    this.emit();
  }

  /** Reorder a tab within its view. */
  move(id: string, toIndex: number, p: PaneIndex = this.focusedPane): void {
    const ids = this.panes[p].ids;
    const from = ids.indexOf(id);
    if (from < 0 || from === toIndex) return;
    ids.splice(from, 1);
    ids.splice(Math.max(0, Math.min(toIndex, ids.length)), 0, id);
    this.emit();
  }

  /** Move a tab to the other view (Notepad++ "Move to Other View"). */
  moveToPane(id: string, from: PaneIndex, to: PaneIndex, index?: number): void {
    if (from === to) {
      if (index !== undefined) this.move(id, index, to);
      return;
    }
    this.dropFromPane(id, from);
    const ids = this.panes[to].ids;
    const existing = ids.indexOf(id);
    if (existing >= 0 && index !== undefined) ids.splice(existing, 1);
    if (!ids.includes(id)) ids.splice(Math.min(index ?? ids.length, ids.length), 0, id);
    this.panes[to].activeId = id;
    this.focusedPane = to;
    this.normalize();
    this.emit();
  }

  /** Show a doc in the other view too, sharing the same text and undo history. */
  cloneToPane(id: string, to: PaneIndex): void {
    const ids = this.panes[to].ids;
    if (!ids.includes(id)) ids.push(id);
    this.panes[to].activeId = id;
    this.focusedPane = to;
    this.emit();
  }

  /** Restore a saved layout. Unknown ids are dropped and unplaced docs go to the left view. */
  setLayout(panes: Pane[], focused: PaneIndex): void {
    const known = new Set(this.docs.map((d) => d.id));
    this.panes = ([0, 1] as const).map((p) => {
      const ids = [...new Set((panes[p]?.ids ?? []).filter((id) => known.has(id)))];
      const want = panes[p]?.activeId;
      return { ids, activeId: want && ids.includes(want) ? want : ids[0] ?? null };
    }) as [Pane, Pane];
    for (const d of this.docs) if (!this.panesOf(d.id).length) this.panes[0].ids.push(d.id);
    if (this.panes[0].activeId === null) this.panes[0].activeId = this.panes[0].ids[0] ?? null;
    this.focusedPane = focused;
    this.normalize();
    this.emit();
  }

  getIndent(doc: Doc): { tabSize: number; insertSpaces: boolean } {
    const o = doc.model.getOptions();
    return { tabSize: o.tabSize, insertSpaces: o.insertSpaces };
  }

  setIndent(doc: Doc, opts: { tabSize?: number; insertSpaces?: boolean }): void {
    doc.model.updateOptions(opts);
  }

  /** Re-detect indentation from the content. */
  detectIndent(doc: Doc): void {
    const s = settings.get();
    doc.model.detectIndentation(s.defaultInsertSpaces, s.defaultTabSize);
  }

  rename(doc: Doc, name: string): void {
    doc.name = name;
    if (!doc.languageLocked) monaco.editor.setModelLanguage(doc.model, detectLanguage(name));
    this.emit();
  }

  setLanguage(doc: Doc, languageId: string): void {
    monaco.editor.setModelLanguage(doc.model, languageId);
    doc.languageLocked = true;
    this.emit();
  }

  setEncoding(doc: Doc, encoding: Encoding): void {
    if (doc.encoding === encoding) return;
    doc.encoding = encoding;
    doc.metaDirty = true;
    this.emit();
  }

  getEol(doc: Doc): Eol {
    return doc.model.getEOL() === '\r\n' ? 'CRLF' : 'LF';
  }

  /** Undoable line-ending conversion. */
  setEol(doc: Doc, eol: Eol): void {
    if (this.getEol(doc) === eol) return;
    doc.model.pushEOL(eol === 'CRLF' ? monaco.editor.EndOfLineSequence.CRLF : monaco.editor.EndOfLineSequence.LF);
    this.emit();
  }
}

export const store = new DocStore();

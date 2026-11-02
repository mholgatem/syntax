import { monaco } from '../editor/monacoSetup';
import { detectLanguage } from '../editor/languages';
import { detectEol, hashText, type Encoding, type Eol } from '../io/text';

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
}

type Listener = () => void;

let seq = 0;
const newId = () => `${Date.now().toString(36)}-${(seq++).toString(36)}`;

class DocStore {
  docs: Doc[] = [];
  activeId: string | null = null;
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

  emit(): void {
    for (const l of this.listeners) l();
  }

  get active(): Doc | undefined {
    return this.docs.find((d) => d.id === this.activeId);
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
    let wasDirty = this.isDirty(doc);
    model.onDidChangeContent(() => {
      for (const l of this.contentListeners) l(doc);
      const dirty = this.isDirty(doc);
      if (dirty !== wasDirty) {
        wasDirty = dirty;
        this.emit();
      }
    });
    this.docs.push(doc);
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
    doc.savedVersionId = doc.model.getAlternativeVersionId();
    doc.savedHash = hashText(doc.model.getValue());
    doc.metaDirty = false;
    doc.untitled = false;
    this.emit();
  }

  /** Remove a doc without prompting (callers handle unsaved changes). */
  remove(id: string): void {
    const idx = this.docs.findIndex((d) => d.id === id);
    if (idx < 0) return;
    const [doc] = this.docs.splice(idx, 1);
    if (this.activeId === id) {
      const next = this.docs[idx] ?? this.docs[idx - 1];
      this.activeId = next?.id ?? null;
    }
    this.emit();
    doc.model.dispose();
  }

  setActive(id: string | null): void {
    if (this.activeId === id) return;
    this.activeId = id;
    this.emit();
  }

  move(id: string, toIndex: number): void {
    const from = this.docs.findIndex((d) => d.id === id);
    if (from < 0 || from === toIndex) return;
    const [doc] = this.docs.splice(from, 1);
    this.docs.splice(Math.max(0, Math.min(toIndex, this.docs.length)), 0, doc);
    this.emit();
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

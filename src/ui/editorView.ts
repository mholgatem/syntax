import { monaco } from '../editor/monacoSetup';
import { store, type Doc, type PaneIndex } from '../state/documents';
import { settings, type Settings } from '../state/settings';
import { installRichCopy } from '../editor/richCopy';
import { registerWordCompletion } from '../editor/wordCompletion';
import { attachBookmarkGutter } from '../editor/bookmarks';
import { attachAutoAlign, initHdlFeatures } from '../editor/hdl/monacoHdl';

// Two code editors (left and right view, Notepad++ style) shared by every tab: each tab
// owns a model, and so its own undo stack. A cloned tab shows the same model in both
// views. Plus one diff editor used for Compare.

type ViewState = monaco.editor.ICodeEditorViewState | null;

let editors: [monaco.editor.IStandaloneCodeEditor, monaco.editor.IStandaloneCodeEditor];
let diffEditor: monaco.editor.IStandaloneDiffEditor;
const shown: [string | null, string | null] = [null, null];
let shownFocus: PaneIndex = 0;
/** Scroll/cursor state per view and doc, keyed `${pane}:${docId}`. */
const viewStates = new Map<string, ViewState>();
let compare: { left: string; right: string } | null = null;
const compareListeners = new Set<() => void>();

function editorOptions(s: Settings): monaco.editor.IEditorOptions & monaco.editor.IGlobalEditorOptions {
  return {
    fontSize: s.fontSize,
    wordWrap: s.wordWrap ? 'on' : 'off',
    renderWhitespace: s.renderWhitespace ? 'all' : 'selection',
    minimap: { enabled: s.minimap },
    lineNumbers: s.lineNumbers ? 'on' : 'off',
    // Replaced by registerWordCompletion(), which skips words that only appear in comments.
    wordBasedSuggestions: 'off',
  };
}

function createCodeEditor(host: HTMLElement, s: Settings): monaco.editor.IStandaloneCodeEditor {
  // Monaco renders the right-click menu in a shadow root attached to the host element,
  // outside `.monaco-editor`, so it would miss the theme's --vscode-* color variables
  // (transparent menu). Monaco also defines those variables on `.monaco-component`.
  host.classList.add('monaco-component');
  const ed = monaco.editor.create(host, {
    ...editorOptions(s),
    model: null,
    automaticLayout: true,
    fontFamily: "'Cascadia Code', 'JetBrains Mono', Consolas, 'Courier New', monospace",
    fontLigatures: false,
    renderLineHighlight: 'all',
    smoothScrolling: true,
    scrollBeyondLastLine: true,
    multiCursorModifier: 'alt',
    columnSelection: false,
    folding: true,
    showFoldingControls: 'always',
    glyphMargin: true, // bookmarks
    bracketPairColorization: { enabled: true },
    guides: { indentation: true, bracketPairs: false },
    stickyScroll: { enabled: false },
    'semanticHighlighting.enabled': false,
    unicodeHighlight: { ambiguousCharacters: false },
    dropIntoEditor: { enabled: false }, // let our window-level drop handler open files
    fixedOverflowWidgets: true,
  });
  attachBookmarkGutter(ed);
  attachAutoAlign(ed);
  return ed;
}

export function initEditors(hosts: [HTMLElement, HTMLElement], diffHost: HTMLElement): void {
  const s = settings.get();
  editors = [createCodeEditor(hosts[0], s), createCodeEditor(hosts[1], s)];
  editors.forEach((ed, p) => ed.onDidFocusEditorText(() => store.focusPane(p as PaneIndex)));

  diffHost.classList.add('monaco-component');
  diffEditor = monaco.editor.createDiffEditor(diffHost, {
    ...editorOptions(s),
    automaticLayout: true,
    originalEditable: true,
    renderSideBySide: !s.diffInline,
    ignoreTrimWhitespace: s.diffIgnoreWhitespace,
    enableSplitViewResizing: true,
    renderOverviewRuler: true,
    useInlineViewWhenSpaceIsLimited: false,
    fixedOverflowWidgets: true,
    glyphMargin: true,
    dropIntoEditor: { enabled: false },
  });
  for (const side of [diffEditor.getOriginalEditor(), diffEditor.getModifiedEditor()]) {
    attachBookmarkGutter(side);
    attachAutoAlign(side);
  }

  settings.subscribe((next) => {
    for (const ed of editors) ed.updateOptions(editorOptions(next));
    diffEditor.updateOptions({
      ...editorOptions(next),
      renderSideBySide: !next.diffInline,
      ignoreTrimWhitespace: next.diffIgnoreWhitespace,
    });
  });

  installRichCopy(focusedEditor);
  registerWordCompletion();
  initHdlFeatures(revealDoc);

  store.onRemove((doc) => {
    viewStates.delete(`0:${doc.id}`);
    viewStates.delete(`1:${doc.id}`);
  });
  store.subscribe(sync);
  sync();
}

/** Show each view's active doc, remembering the outgoing doc's scroll/cursor state. */
function sync(): void {
  if (compare && (!store.get(compare.left) || !store.get(compare.right))) closeCompare();
  document.body.classList.toggle('split', store.split);
  document.body.dataset.focusedPane = String(store.focusedPane);
  let focusChanged = shownFocus !== store.focusedPane;
  shownFocus = store.focusedPane;
  for (const p of [0, 1] as const) {
    const id = store.panes[p].activeId;
    if (shown[p] === id) continue;
    const ed = editors[p];
    const prev = shown[p] ? store.get(shown[p]!) : undefined;
    if (prev && ed.getModel() === prev.model) {
      const vs = ed.saveViewState();
      viewStates.set(`${p}:${prev.id}`, vs);
      prev.viewState = vs;
    }
    shown[p] = id;
    const doc = id ? store.get(id) : undefined;
    ed.setModel(doc?.model ?? null);
    if (doc) {
      const vs = viewStates.get(`${p}:${doc.id}`) ?? doc.viewState;
      if (vs) ed.restoreViewState(vs);
    }
    if (p === store.focusedPane) focusChanged = true;
  }
  if (focusChanged && store.active && !compare) editors[store.focusedPane].focus();
}

export function getEditors(): readonly monaco.editor.IStandaloneCodeEditor[] {
  return editors;
}

/** The editor the user is working in: the focused side of the diff when comparing. */
export function focusedEditor(): monaco.editor.ICodeEditor {
  if (compare) {
    const original = diffEditor.getOriginalEditor();
    return original.hasTextFocus() || original.hasWidgetFocus() ? original : diffEditor.getModifiedEditor();
  }
  return editors[store.focusedPane];
}

/** The doc that commands like Save should act on. */
export function focusedDoc(): Doc | undefined {
  if (compare) {
    const model = focusedEditor().getModel();
    return store.docs.find((d) => d.model === model) ?? store.active;
  }
  return store.active;
}

export function viewStateFor(id: string): ViewState {
  const doc = store.get(id);
  if (!doc) return null;
  for (const p of [store.focusedPane, store.focusedPane === 0 ? 1 : 0] as const) {
    if (shown[p] === id && editors[p].getModel() === doc.model) return editors[p].saveViewState();
  }
  return doc.viewState;
}

/** Activate a doc's tab and move the cursor to `selection` (used by Go to Definition, search, outline). */
export function revealDoc(doc: Doc, selection?: monaco.IRange | monaco.IPosition | null): void {
  if (compare && compare.left !== doc.id && compare.right !== doc.id) closeCompare();
  let ed: monaco.editor.ICodeEditor;
  if (compare) {
    const left = diffEditor.getOriginalEditor();
    ed = left.getModel() === doc.model ? left : diffEditor.getModifiedEditor();
  } else {
    store.setActive(doc.id);
    ed = editors[store.focusedPane];
  }
  if (selection) {
    if ('startLineNumber' in selection) {
      ed.setSelection(selection);
      ed.revealRangeInCenterIfOutsideViewport(selection, monaco.editor.ScrollType.Smooth);
    } else {
      ed.setPosition(selection);
      ed.revealPositionInCenterIfOutsideViewport(selection, monaco.editor.ScrollType.Smooth);
    }
  }
  ed.focus();
}

export function getCompare(): { left: string; right: string } | null {
  return compare;
}

export function onCompareChange(cb: () => void): void {
  compareListeners.add(cb);
}

export function openCompare(leftId: string, rightId: string): void {
  const left = store.get(leftId);
  const right = store.get(rightId);
  if (!left || !right) return;
  compare = { left: leftId, right: rightId };
  diffEditor.setModel({ original: left.model, modified: right.model });
  document.body.classList.add('comparing');
  for (const l of compareListeners) l();
  window.setTimeout(() => diffEditor.getModifiedEditor().focus(), 0);
}

export function closeCompare(): void {
  if (!compare) return;
  compare = null;
  diffEditor.setModel(null);
  document.body.classList.remove('comparing');
  for (const l of compareListeners) l();
  editors[store.focusedPane].focus();
}

export function swapCompare(): void {
  if (compare) openCompare(compare.right, compare.left);
}

export function diffNavigate(direction: 'next' | 'previous'): void {
  diffEditor.goToDiff(direction);
}

export function diffChangeCount(): number {
  return diffEditor.getLineChanges()?.length ?? 0;
}

export function onDiffUpdated(cb: () => void): void {
  diffEditor.onDidUpdateDiff(cb);
}

/** Run a Monaco action or command on the focused editor. */
export function runEditorAction(id: string): void {
  const ed = focusedEditor();
  if (!ed.getModel()) return;
  ed.focus();
  const action = ed.getAction(id);
  if (action) void action.run();
  else ed.trigger('menu', id, null);
}

/** True when the focused editor has a model and `id` is an action it supports. */
export function editorActionSupported(id: string): boolean {
  const ed = focusedEditor();
  if (!ed.getModel()) return false;
  return ed.getAction(id)?.isSupported() ?? false;
}

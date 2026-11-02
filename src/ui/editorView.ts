import { monaco } from '../editor/monacoSetup';
import { store, type Doc } from '../state/documents';
import { settings, type Settings } from '../state/settings';

// One code editor instance shared by every tab (each tab owns a model, and so its own
// undo stack), plus one diff editor used for Compare.

let editor: monaco.editor.IStandaloneCodeEditor;
let diffEditor: monaco.editor.IStandaloneDiffEditor;
let shownDocId: string | null = null;
let compare: { left: string; right: string } | null = null;
const compareListeners = new Set<() => void>();

function editorOptions(s: Settings): monaco.editor.IEditorOptions & monaco.editor.IGlobalEditorOptions {
  return {
    fontSize: s.fontSize,
    wordWrap: s.wordWrap ? 'on' : 'off',
    renderWhitespace: s.renderWhitespace ? 'all' : 'selection',
    minimap: { enabled: s.minimap },
    lineNumbers: s.lineNumbers ? 'on' : 'off',
  };
}

export function initEditors(editorHost: HTMLElement, diffHost: HTMLElement): void {
  const s = settings.get();
  editor = monaco.editor.create(editorHost, {
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
    bracketPairColorization: { enabled: true },
    guides: { indentation: true, bracketPairs: false },
    stickyScroll: { enabled: false },
    'semanticHighlighting.enabled': false,
    unicodeHighlight: { ambiguousCharacters: false },
    dropIntoEditor: { enabled: false }, // let our window-level drop handler open files
    fixedOverflowWidgets: true,
  });

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
    dropIntoEditor: { enabled: false },
  });

  settings.subscribe((next) => {
    editor.updateOptions(editorOptions(next));
    diffEditor.updateOptions({
      ...editorOptions(next),
      renderSideBySide: !next.diffInline,
      ignoreTrimWhitespace: next.diffIgnoreWhitespace,
    });
  });

  store.subscribe(sync);
  sync();
}

/** Show the active doc's model, remembering the outgoing doc's scroll/cursor state. */
function sync(): void {
  if (compare && (!store.get(compare.left) || !store.get(compare.right))) closeCompare();
  const active = store.active ?? null;
  if (shownDocId === (active?.id ?? null)) return;
  const prev = shownDocId ? store.get(shownDocId) : undefined;
  if (prev && editor.getModel() === prev.model) prev.viewState = editor.saveViewState();
  shownDocId = active?.id ?? null;
  editor.setModel(active?.model ?? null);
  if (active?.viewState) editor.restoreViewState(active.viewState);
  if (active && !compare) editor.focus();
}

export function getEditor(): monaco.editor.IStandaloneCodeEditor {
  return editor;
}

/** The editor the user is working in: the focused side of the diff when comparing. */
export function focusedEditor(): monaco.editor.ICodeEditor {
  if (compare) {
    const original = diffEditor.getOriginalEditor();
    return original.hasTextFocus() || original.hasWidgetFocus() ? original : diffEditor.getModifiedEditor();
  }
  return editor;
}

/** The doc that commands like Save should act on. */
export function focusedDoc(): Doc | undefined {
  if (compare) {
    const model = focusedEditor().getModel();
    return store.docs.find((d) => d.model === model) ?? store.active;
  }
  return store.active;
}

export function viewStateFor(id: string): monaco.editor.ICodeEditorViewState | null {
  const doc = store.get(id);
  if (!doc) return null;
  if (id === shownDocId && editor.getModel() === doc.model) return editor.saveViewState();
  return doc.viewState;
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
  editor.focus();
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

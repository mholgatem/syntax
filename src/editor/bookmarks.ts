import { monaco } from './monacoSetup';

// Notepad++-style bookmarks: whole-line markers in the glyph margin that move with edits.
// They live on the model, so every view of a file (split view, compare) shows them.

type Editor = monaco.editor.ICodeEditor;
type Model = monaco.editor.ITextModel;

const ids = new WeakMap<Model, string[]>();
const listeners = new Set<() => void>();

const DECORATION: monaco.editor.IModelDecorationOptions = {
  isWholeLine: true,
  className: 'bookmark-line',
  glyphMarginClassName: 'bookmark-glyph codicon codicon-bookmark',
  glyphMarginHoverMessage: { value: 'Bookmark (Ctrl+F2 to toggle, F2 / Shift+F2 to jump)' },
  stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
  overviewRuler: { color: '#3794ffb0', position: monaco.editor.OverviewRulerLane.Left },
};

/** Fires when bookmarks are added or removed (not when edits move them). */
export function onBookmarksChange(l: () => void): void {
  listeners.add(l);
}

/** Bookmarked line numbers, sorted and de-duplicated. */
export function getBookmarks(model: Model): number[] {
  const lines = new Set<number>();
  for (const id of ids.get(model) ?? []) {
    const r = model.getDecorationRange(id);
    if (r) lines.add(r.startLineNumber);
  }
  return [...lines].sort((a, b) => a - b);
}

export function setBookmarks(model: Model, lines: number[]): void {
  const max = model.getLineCount();
  const valid = [...new Set(lines)].filter((l) => l >= 1 && l <= max);
  const next = model.deltaDecorations(
    ids.get(model) ?? [],
    valid.map((l) => ({ range: new monaco.Range(l, 1, l, 1), options: DECORATION })),
  );
  ids.set(model, next);
  for (const l of listeners) l();
}

export function toggleBookmark(model: Model, line: number): void {
  const lines = getBookmarks(model);
  setBookmarks(model, lines.includes(line) ? lines.filter((l) => l !== line) : [...lines, line]);
}

/** Toggle bookmarks on every line that has a cursor. */
export function toggleAtCursor(ed: Editor): void {
  const model = ed.getModel();
  if (!model) return;
  const cursorLines = [...new Set((ed.getSelections() ?? []).map((s) => s.positionLineNumber))];
  const current = new Set(getBookmarks(model));
  for (const l of cursorLines) {
    if (current.has(l)) current.delete(l);
    else current.add(l);
  }
  setBookmarks(model, [...current]);
}

/** Jump to the next (or previous) bookmark, wrapping around. */
export function gotoBookmark(ed: Editor, direction: 1 | -1): void {
  const model = ed.getModel();
  const pos = ed.getPosition();
  if (!model || !pos) return;
  const lines = getBookmarks(model);
  if (lines.length === 0) return;
  const target =
    direction === 1
      ? lines.find((l) => l > pos.lineNumber) ?? lines[0]
      : [...lines].reverse().find((l) => l < pos.lineNumber) ?? lines[lines.length - 1];
  ed.setPosition({ lineNumber: target, column: 1 });
  ed.revealLineInCenterIfOutsideViewport(target);
  ed.focus();
}

export function clearBookmarks(model: Model): void {
  setBookmarks(model, []);
}

function lineTexts(model: Model, lines: number[]): string {
  return lines.map((l) => model.getLineContent(l)).join(model.getEOL()) + (lines.length ? model.getEOL() : '');
}

/** Edits that delete the given whole lines (merging adjacent ones). */
function deleteLinesEdits(model: Model, lines: number[]): monaco.editor.IIdentifiedSingleEditOperation[] {
  const count = model.getLineCount();
  const runs: [number, number][] = [];
  for (const l of [...lines].sort((a, b) => a - b)) {
    const last = runs[runs.length - 1];
    if (last && l === last[1] + 1) last[1] = l;
    else runs.push([l, l]);
  }
  return runs.map(([a, b]) => {
    let range: monaco.Range;
    if (b < count) range = new monaco.Range(a, 1, b + 1, 1);
    else if (a > 1) range = new monaco.Range(a - 1, model.getLineMaxColumn(a - 1), b, model.getLineMaxColumn(b));
    else range = new monaco.Range(1, 1, b, model.getLineMaxColumn(b));
    return { range, text: '' };
  });
}

function applyDelete(ed: Editor, lines: number[]): void {
  const model = ed.getModel();
  if (!model || lines.length === 0) return;
  ed.pushUndoStop();
  ed.executeEdits('bookmarks', deleteLinesEdits(model, lines));
  ed.pushUndoStop();
  for (const l of listeners) l();
}

export async function copyBookmarkedLines(ed: Editor): Promise<void> {
  const model = ed.getModel();
  if (!model) return;
  await navigator.clipboard?.writeText(lineTexts(model, getBookmarks(model)));
}

export async function cutBookmarkedLines(ed: Editor): Promise<void> {
  const model = ed.getModel();
  if (!model) return;
  const lines = getBookmarks(model);
  await navigator.clipboard?.writeText(lineTexts(model, lines));
  applyDelete(ed, lines);
}

export function removeBookmarkedLines(ed: Editor): void {
  const model = ed.getModel();
  if (model) applyDelete(ed, getBookmarks(model));
}

export function removeUnbookmarkedLines(ed: Editor): void {
  const model = ed.getModel();
  if (!model) return;
  const keep = new Set(getBookmarks(model));
  if (keep.size === 0) return;
  const drop: number[] = [];
  for (let l = 1; l <= model.getLineCount(); l++) if (!keep.has(l)) drop.push(l);
  applyDelete(ed, drop);
}

/** Clicking the glyph margin toggles a bookmark on that line. */
export function attachBookmarkGutter(ed: Editor): void {
  ed.onMouseDown((e) => {
    if (e.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN || !e.target.position) return;
    const model = ed.getModel();
    if (model) toggleBookmark(model, e.target.position.lineNumber);
  });
}

// Global editor actions so the shortcuts work in every editor, including the compare view.
monaco.editor.addKeybindingRules([
  { keybinding: monaco.KeyMod.CtrlCmd | monaco.KeyCode.F2, command: '-editor.action.changeAll' },
  { keybinding: monaco.KeyCode.F2, command: '-editor.action.rename' },
]);
monaco.editor.addEditorAction({
  id: 'syntax.bookmark.toggle',
  label: 'Bookmark: Toggle',
  keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.F2],
  run: (ed) => toggleAtCursor(ed),
});
monaco.editor.addEditorAction({
  id: 'syntax.bookmark.next',
  label: 'Bookmark: Next',
  keybindings: [monaco.KeyCode.F2],
  run: (ed) => gotoBookmark(ed, 1),
});
monaco.editor.addEditorAction({
  id: 'syntax.bookmark.previous',
  label: 'Bookmark: Previous',
  keybindings: [monaco.KeyMod.Shift | monaco.KeyCode.F2],
  run: (ed) => gotoBookmark(ed, -1),
});

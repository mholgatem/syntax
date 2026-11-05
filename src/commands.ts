import { store, type Doc, type PaneIndex } from './state/documents';
import { settings } from './state/settings';
import { clearRecent, forgetRecent, recentFiles, recentSupported, type RecentEntry } from './state/recent';
import { SCHEMES } from './editor/themes';
import {
  clearBookmarks,
  copyBookmarkedLines,
  cutBookmarkedLines,
  gotoBookmark,
  removeBookmarkedLines,
  removeUnbookmarkedLines,
  toggleAtCursor,
} from './editor/bookmarks';
import { alignStatements, copyAsInstance, insertInstance } from './editor/hdl/monacoHdl';
import { hdlLang } from './editor/hdl/lex';
import { saveAll, saveDoc, downloadAllZip } from './io/saveFiles';
import { openIncoming, pickAndOpen } from './io/openFiles';
import { confirmSave, confirmSaveMany, pickTwo, promptText, showInfo, toast } from './ui/dialogs';
import {
  closeCompare,
  diffNavigate,
  editorActionSupported,
  focusedDoc,
  focusedEditor,
  getCompare,
  openCompare,
  runEditorAction,
  swapCompare,
} from './ui/editorView';
import type { Menu, MenuItem } from './ui/menuBar';
import { encodingMenuItems, eolMenuItems, indentMenuItems, languageMenuItems } from './ui/statusBar';
import { showSidebarTab } from './ui/sidebar';
import { openSearchPanel } from './ui/searchPanel';
import { canInstall, promptInstall } from './pwa';
import { isMarkdown } from './ui/markdownPreview';
import { downloadIconScript, isWindows } from './ui/iconNotice';

let fileInput: HTMLInputElement;
export function setFileInput(input: HTMLInputElement): void {
  fileInput = input;
}

const otherPane = (p: PaneIndex): PaneIndex => (p === 0 ? 1 : 0);

// ---------- file commands ----------

export function newFile(): void {
  const doc = store.createUntitled();
  if (getCompare()) closeCompare();
  store.setActive(doc.id);
}

export function openFiles(): void {
  void pickAndOpen(fileInput);
}

export async function openRecent(entry: RecentEntry): Promise<void> {
  try {
    const opts = { mode: 'read' as const };
    if ((await entry.handle.queryPermission(opts)) !== 'granted' && (await entry.handle.requestPermission(opts)) !== 'granted') return;
    const file = await entry.handle.getFile();
    if (getCompare()) closeCompare();
    await openIncoming([{ file, handle: entry.handle }]);
  } catch {
    toast(`Could not open ${entry.name}. It may have been moved or deleted.`, 'error');
    void forgetRecent(entry.handle);
  }
}

export async function save(doc = focusedDoc()): Promise<boolean> {
  return doc ? saveDoc(doc) : false;
}

export async function saveAs(doc = focusedDoc()): Promise<boolean> {
  return doc ? saveDoc(doc, { saveAs: true }) : false;
}

/** Close one doc everywhere, asking to save if it has unsaved changes. Resolves false if cancelled. */
export async function closeDoc(doc: Doc | undefined = focusedDoc()): Promise<boolean> {
  if (!doc) return true;
  if (store.isDirty(doc)) {
    store.setActive(doc.id);
    const choice = await confirmSave(doc.name);
    if (choice === 'cancel') return false;
    if (choice === 'save' && !(await saveDoc(doc))) return false;
  }
  store.remove(doc.id);
  return true;
}

export async function closeMany(docs: Doc[]): Promise<boolean> {
  const dirty = docs.filter((d) => store.isDirty(d));
  if (dirty.length === 1) {
    if (!(await closeDoc(dirty[0]))) return false;
  } else if (dirty.length > 1) {
    const choice = await confirmSaveMany(dirty.length);
    if (choice === 'cancel') return false;
    if (choice === 'save') {
      for (const d of dirty) {
        store.setActive(d.id);
        if (!(await saveDoc(d))) return false;
      }
    }
  }
  for (const d of docs) store.remove(d.id);
  return true;
}

/** Close a tab in one view. A doc cloned into the other view just leaves this view. */
export async function closeTab(doc: Doc, pane: PaneIndex): Promise<boolean> {
  if (store.panes[otherPane(pane)].ids.includes(doc.id) && store.panes[pane].ids.includes(doc.id)) {
    store.removeFromPane(doc.id, pane);
    return true;
  }
  return closeDoc(doc);
}

export async function closeTabs(docs: Doc[], pane: PaneIndex): Promise<boolean> {
  const clones = docs.filter((d) => store.panes[otherPane(pane)].ids.includes(d.id));
  for (const d of clones) store.removeFromPane(d.id, pane);
  return closeMany(docs.filter((d) => !clones.includes(d)));
}

/** Alt+W: close the active tab of the focused view (or the focused side when comparing). */
function closeActive(): void {
  const doc = focusedDoc();
  if (!doc) return;
  if (getCompare()) void closeDoc(doc);
  else void closeTab(doc, store.focusedPane);
}

export async function renameDoc(doc = focusedDoc()): Promise<void> {
  if (!doc) return;
  const name = await promptText('Rename', 'File name', doc.name);
  if (!name || name === doc.name) return;
  store.rename(doc, name);
  // A rename only affects the tab and the next save; the original file on disk is untouched.
  if (doc.handle) {
    doc.handle = undefined;
    doc.metaDirty = true;
    store.emit();
  }
}

export async function compareWith(doc?: Doc): Promise<void> {
  if (store.docs.length < 2) {
    await showInfo('Compare files', 'Open at least two files to compare them.');
    return;
  }
  const active = doc ?? store.active ?? store.docs[0];
  const cmp = getCompare();
  const other = store.docs.find((d) => d !== active && d.id !== cmp?.left) ?? store.docs.find((d) => d !== active)!;
  const pair = await pickTwo(
    store.docs.map((d) => ({ value: d.id, label: d.name })),
    cmp?.left ?? active.id,
    cmp?.right ?? other.id,
  );
  if (pair) openCompare(pair[0], pair[1]);
}

/** Cycle through the tabs of the focused view. */
function cycleTab(delta: number): void {
  const ids = store.panes[store.focusedPane].ids;
  if (ids.length === 0) return;
  const i = ids.indexOf(store.activeId ?? '');
  const next = ids[(i + delta + ids.length) % ids.length];
  if (getCompare()) closeCompare();
  store.setActiveInPane(next, store.focusedPane);
}

function moveToOtherView(clone: boolean): void {
  const doc = focusedDoc();
  if (!doc) return;
  if (getCompare()) closeCompare();
  const from = store.focusedPane;
  if (clone) store.cloneToPane(doc.id, otherPane(from));
  else store.moveToPane(doc.id, from, otherPane(from));
}

function switchView(): void {
  if (!store.split || getCompare()) return;
  store.focusPane(otherPane(store.focusedPane));
}

function zoom(delta: number | null): void {
  const size = delta === null ? 14 : Math.max(6, Math.min(48, settings.get().fontSize + delta));
  settings.update({ fontSize: size });
}

type BoolSetting = 'wordWrap' | 'renderWhitespace' | 'minimap' | 'lineNumbers' | 'diffInline' | 'diffIgnoreWhitespace' | 'autoAlign';
const toggle = (key: BoolSetting) => settings.update({ [key]: !settings.get()[key] });

export function toggleMarkdownPreview(): void {
  const on = !settings.get().markdownPreview;
  settings.update({ markdownPreview: on });
  if (on && !store.docs.some(isMarkdown)) toast('The preview appears beside Markdown files.');
}

export function toggleDarkMode(): void {
  const { mode } = settings.get();
  const dark = mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  settings.update({ mode: dark ? 'light' : 'dark' });
}

// ---------- menus ----------

const noDoc = () => !focusedDoc();
const notHdl = () => {
  const doc = focusedDoc();
  return !doc || !hdlLang(doc.model.getLanguageId());
};
const act = (id: string) => () => runEditorAction(id);
const withEditor = (fn: (ed: ReturnType<typeof focusedEditor>) => unknown) => () => {
  const ed = focusedEditor();
  if (ed.getModel()) void fn(ed);
};

function editorItem(label: string, id: string, shortcut?: string): MenuItem {
  return { label, shortcut, action: act(id), disabled: noDoc };
}

function recentMenuItems(): MenuItem[] {
  if (!recentSupported()) return [{ label: 'Needs Chrome or Edge', action: () => undefined, disabled: () => true }];
  const items = recentFiles();
  if (items.length === 0) return [{ label: 'No recently closed files', action: () => undefined, disabled: () => true }];
  return [
    ...items.map((e, i): MenuItem => ({ label: `${i + 1}: ${e.name}`, action: () => void openRecent(e) })),
    'separator',
    { label: 'Clear Recent Files', action: () => void clearRecent() },
  ];
}

export function buildMenus(): Menu[] {
  return [
    {
      label: 'File',
      items: () => [
        { label: 'New', shortcut: 'Alt+N', action: newFile },
        { label: 'Open…', shortcut: 'Ctrl+O', action: openFiles },
        { label: 'Recent Files', submenu: recentMenuItems },
        'separator',
        { label: 'Save', shortcut: 'Ctrl+S', action: () => void save(), disabled: noDoc },
        { label: 'Save As…', shortcut: 'Ctrl+Alt+S', action: () => void saveAs(), disabled: noDoc },
        { label: 'Save All', shortcut: 'Ctrl+Shift+S', action: () => void saveAll(), disabled: () => !store.anyDirty() },
        { label: 'Download All as ZIP', action: downloadAllZip, disabled: () => store.docs.length === 0 },
        'separator',
        { label: 'Rename…', action: () => void renameDoc(), disabled: noDoc },
        'separator',
        { label: 'Close', shortcut: 'Alt+W', action: closeActive, disabled: noDoc },
        { label: 'Close All', action: () => void closeMany([...store.docs]), disabled: () => store.docs.length === 0 },
        {
          label: 'Close All but Active',
          action: () => void closeMany(store.docs.filter((d) => d.id !== store.activeId)),
          disabled: () => store.docs.length < 2,
        },
        ...(canInstall() ? (['separator', { label: 'Install as App…', action: () => void promptInstall() }] as MenuItem[]) : []),
      ],
    },
    {
      label: 'Edit',
      items: () => [
        editorItem('Undo', 'undo', 'Ctrl+Z'),
        editorItem('Redo', 'redo', 'Ctrl+Y'),
        'separator',
        editorItem('Cut', 'editor.action.clipboardCutAction', 'Ctrl+X'),
        editorItem('Copy', 'editor.action.clipboardCopyAction', 'Ctrl+C'),
        editorItem('Paste', 'editor.action.clipboardPasteAction', 'Ctrl+V'),
        editorItem('Select All', 'editor.action.selectAll', 'Ctrl+A'),
        'separator',
        {
          label: 'Line Operations',
          submenu: () => [
            editorItem('Duplicate Line', 'editor.action.copyLinesDownAction', 'Ctrl+D'),
            editorItem('Delete Line', 'editor.action.deleteLines', 'Ctrl+Shift+K'),
            editorItem('Move Line Up', 'editor.action.moveLinesUpAction', 'Alt+↑'),
            editorItem('Move Line Down', 'editor.action.moveLinesDownAction', 'Alt+↓'),
            editorItem('Join Lines', 'editor.action.joinLines'),
            'separator',
            editorItem('Sort Lines Ascending', 'editor.action.sortLinesAscending'),
            editorItem('Sort Lines Descending', 'editor.action.sortLinesDescending'),
            editorItem('Remove Duplicate Lines', 'editor.action.removeDuplicateLines'),
            editorItem('Trim Trailing Whitespace', 'editor.action.trimTrailingWhitespace'),
          ],
        },
        {
          label: 'Convert Case',
          submenu: () => [
            editorItem('UPPERCASE', 'editor.action.transformToUppercase'),
            editorItem('lowercase', 'editor.action.transformToLowercase'),
            editorItem('Title Case', 'editor.action.transformToTitlecase'),
          ],
        },
        {
          label: 'Comment',
          submenu: () => [
            editorItem('Toggle Line Comment', 'editor.action.commentLine', 'Ctrl+/'),
            editorItem('Toggle Block Comment', 'editor.action.blockComment', 'Shift+Alt+A'),
          ],
        },
        {
          label: 'Indentation',
          submenu: () => [
            editorItem('Indent', 'editor.action.indentLines', 'Ctrl+]'),
            editorItem('Outdent', 'editor.action.outdentLines', 'Ctrl+['),
            'separator',
            ...indentMenuItems(),
          ],
        },
        { label: 'EOL Conversion', submenu: eolMenuItems },
        'separator',
        {
          label: 'Format Document',
          shortcut: 'Shift+Alt+F',
          action: act('editor.action.formatDocument'),
          disabled: () => !editorActionSupported('editor.action.formatDocument'),
        },
        {
          label: 'Format Selection',
          action: act('editor.action.formatSelection'),
          disabled: () => !editorActionSupported('editor.action.formatSelection'),
        },
        'separator',
        { label: 'Align Statements', shortcut: 'Ctrl+Alt+A', action: withEditor(alignStatements), disabled: notHdl },
        { label: 'Copy as Instance', action: withEditor(copyAsInstance), disabled: notHdl },
        { label: 'Insert Instance of…', action: withEditor(insertInstance), disabled: notHdl },
        'separator',
        editorItem('Command Palette…', 'editor.action.quickCommand', 'F1'),
      ],
    },
    {
      label: 'Search',
      items: () => [
        editorItem('Find…', 'actions.find', 'Ctrl+F'),
        editorItem('Replace…', 'editor.action.startFindReplaceAction', 'Ctrl+H'),
        editorItem('Find Next', 'editor.action.nextMatchFindAction', 'F3'),
        editorItem('Find Previous', 'editor.action.previousMatchFindAction', 'Shift+F3'),
        editorItem('Select All Occurrences', 'editor.action.selectHighlights', 'Ctrl+Shift+L'),
        { label: 'Find in All Tabs…', shortcut: 'Ctrl+Shift+F', action: openSearchPanel, disabled: () => store.docs.length === 0 },
        'separator',
        editorItem('Go to Line…', 'editor.action.gotoLine', 'Ctrl+G'),
        editorItem('Go to Matching Bracket', 'editor.action.jumpToBracket', 'Ctrl+Shift+\\'),
        { label: 'Go to Symbol…', shortcut: 'Ctrl+Shift+O', action: act('editor.action.quickOutline'), disabled: notHdl },
        { label: 'Go to Definition', shortcut: 'F12', action: act('editor.action.revealDefinition'), disabled: notHdl },
        { label: 'Peek Definition', shortcut: 'Alt+F12', action: act('editor.action.peekDefinition'), disabled: notHdl },
        'separator',
        {
          label: 'Bookmark',
          submenu: () => [
            { label: 'Toggle Bookmark', shortcut: 'Ctrl+F2', action: withEditor(toggleAtCursor), disabled: noDoc },
            { label: 'Next Bookmark', shortcut: 'F2', action: withEditor((ed) => gotoBookmark(ed, 1)), disabled: noDoc },
            { label: 'Previous Bookmark', shortcut: 'Shift+F2', action: withEditor((ed) => gotoBookmark(ed, -1)), disabled: noDoc },
            { label: 'Clear All Bookmarks', action: withEditor((ed) => clearBookmarks(ed.getModel()!)), disabled: noDoc },
            'separator',
            { label: 'Copy Bookmarked Lines', action: withEditor(copyBookmarkedLines), disabled: noDoc },
            { label: 'Cut Bookmarked Lines', action: withEditor(cutBookmarkedLines), disabled: noDoc },
            { label: 'Remove Bookmarked Lines', action: withEditor(removeBookmarkedLines), disabled: noDoc },
            { label: 'Remove Unbookmarked Lines', action: withEditor(removeUnbookmarkedLines), disabled: noDoc },
          ],
        },
      ],
    },
    {
      label: 'View',
      items: () => [
        { label: 'Word Wrap', shortcut: 'Alt+Z', checked: () => settings.get().wordWrap, action: () => toggle('wordWrap') },
        { label: 'Show Whitespace', checked: () => settings.get().renderWhitespace, action: () => toggle('renderWhitespace') },
        { label: 'Line Numbers', checked: () => settings.get().lineNumbers, action: () => toggle('lineNumbers') },
        { label: 'Minimap', checked: () => settings.get().minimap, action: () => toggle('minimap') },
        { label: 'Markdown Preview', shortcut: 'Ctrl+Shift+V', checked: () => settings.get().markdownPreview, action: toggleMarkdownPreview },
        'separator',
        {
          label: 'Outline',
          shortcut: 'Alt+O',
          checked: () => settings.get().sidebarOpen && settings.get().sidebarTab === 'outline',
          action: () => showSidebarTab('outline', true),
        },
        {
          label: 'Search Results',
          checked: () => settings.get().sidebarOpen && settings.get().sidebarTab === 'search',
          action: () => showSidebarTab('search', true),
        },
        'separator',
        { label: 'Zoom In', shortcut: 'Ctrl+=', action: () => zoom(1) },
        { label: 'Zoom Out', shortcut: 'Ctrl+-', action: () => zoom(-1) },
        { label: 'Reset Zoom', shortcut: 'Ctrl+0', action: () => zoom(null) },
        'separator',
        editorItem('Fold All', 'editor.foldAll'),
        editorItem('Unfold All', 'editor.unfoldAll'),
        'separator',
        { label: 'Move to Other View', action: () => moveToOtherView(false), disabled: () => noDoc() || (!store.split && store.docs.length < 2) },
        { label: 'Clone to Other View', action: () => moveToOtherView(true), disabled: noDoc },
        { label: 'Switch to Other View', shortcut: 'F8', action: switchView, disabled: () => !store.split },
        'separator',
        { label: 'Next Tab', shortcut: 'Alt+PgDn', action: () => cycleTab(1), disabled: () => store.docs.length < 2 },
        { label: 'Previous Tab', shortcut: 'Alt+PgUp', action: () => cycleTab(-1), disabled: () => store.docs.length < 2 },
      ],
    },
    {
      label: 'Compare',
      items: () => [
        { label: 'Compare Files…', shortcut: 'Ctrl+Alt+C', action: () => void compareWith(), disabled: () => store.docs.length < 2 },
        { label: 'Close Compare', shortcut: 'Esc', action: closeCompare, disabled: () => !getCompare() },
        'separator',
        { label: 'Next Difference', shortcut: 'Alt+F5', action: () => diffNavigate('next'), disabled: () => !getCompare() },
        { label: 'Previous Difference', shortcut: 'Shift+Alt+F5', action: () => diffNavigate('previous'), disabled: () => !getCompare() },
        { label: 'Swap Sides', action: swapCompare, disabled: () => !getCompare() },
        'separator',
        { label: 'Inline View', checked: () => settings.get().diffInline, action: () => toggle('diffInline') },
        { label: 'Ignore Leading/Trailing Whitespace', checked: () => settings.get().diffIgnoreWhitespace, action: () => toggle('diffIgnoreWhitespace') },
      ],
    },
    { label: 'Language', items: languageMenuItems },
    {
      label: 'Encoding',
      items: () => [...encodingMenuItems(), 'separator', ...eolMenuItems()],
    },
    {
      label: 'Settings',
      items: () => [
        {
          label: 'Appearance',
          submenu: () =>
            (['system', 'light', 'dark'] as const).map((m) => ({
              label: m === 'system' ? 'Match System' : m === 'light' ? 'Light' : 'Dark',
              checked: () => settings.get().mode === m,
              action: () => settings.update({ mode: m }),
            })),
        },
        {
          label: 'Color Scheme',
          submenu: () =>
            SCHEMES.map((s) => ({
              label: s.label,
              checked: () => settings.get().scheme === s.id,
              action: () => settings.update({ scheme: s.id }),
            })),
        },
        {
          label: 'Default Indentation',
          submenu: () => [
            { label: 'Spaces', checked: () => settings.get().defaultInsertSpaces, action: () => settings.update({ defaultInsertSpaces: true }) },
            { label: 'Tabs', checked: () => !settings.get().defaultInsertSpaces, action: () => settings.update({ defaultInsertSpaces: false }) },
            'separator',
            ...[2, 3, 4, 8].map((n) => ({
              label: `Size: ${n}`,
              checked: () => settings.get().defaultTabSize === n,
              action: () => settings.update({ defaultTabSize: n }),
            })),
          ],
        },
        'separator',
        {
          label: 'Auto-Align on Enter (Verilog / VHDL)',
          checked: () => settings.get().autoAlign,
          action: () => toggle('autoAlign'),
        },
        ...(isWindows()
          ? ([
              'separator',
              { label: 'Fix-icons script', action: () => void downloadIconScript('fix') },
              { label: 'Undo-icons script', action: () => void downloadIconScript('undo') },
            ] as MenuItem[])
          : []),
        'separator',
        { label: 'Keyboard Shortcuts', action: showShortcuts },
        { label: 'About Syntax', action: showAbout },
      ],
    },
  ];
}

// ---------- keyboard shortcuts ----------

interface Shortcut {
  key: string; // KeyboardEvent.key, lower-case
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  run: () => void;
  /** Only when comparing. */
  compareOnly?: boolean;
}

const SHORTCUTS: Shortcut[] = [
  { key: 'o', ctrl: true, run: openFiles },
  { key: 's', ctrl: true, run: () => void save() },
  { key: 's', ctrl: true, alt: true, run: () => void saveAs() },
  { key: 's', ctrl: true, shift: true, run: () => void saveAll() },
  // Browsers reserve Ctrl+N / Ctrl+W / Ctrl+Tab, so new/close/switch use Alt.
  { key: 'n', alt: true, run: newFile },
  { key: 'w', alt: true, run: closeActive },
  { key: 'pagedown', alt: true, run: () => cycleTab(1) },
  { key: 'pageup', alt: true, run: () => cycleTab(-1) },
  { key: 'z', alt: true, run: () => toggle('wordWrap') },
  { key: 'o', alt: true, run: () => showSidebarTab('outline', true) },
  { key: 'f', ctrl: true, shift: true, run: openSearchPanel },
  { key: 'v', ctrl: true, shift: true, run: toggleMarkdownPreview },
  { key: 'f8', run: switchView },
  { key: '=', ctrl: true, run: () => zoom(1) },
  { key: '+', ctrl: true, shift: true, run: () => zoom(1) },
  { key: '-', ctrl: true, run: () => zoom(-1) },
  { key: '0', ctrl: true, run: () => zoom(null) },
  { key: 'c', ctrl: true, alt: true, run: () => void compareWith() },
  { key: 'f5', alt: true, run: () => diffNavigate('next'), compareOnly: true },
  { key: 'f5', alt: true, shift: true, run: () => diffNavigate('previous'), compareOnly: true },
  { key: 'escape', run: closeCompare, compareOnly: true },
];

export function initShortcuts(): void {
  window.addEventListener(
    'keydown',
    (e) => {
      if (document.querySelector('.modal-backdrop')) return;
      const key = e.key.toLowerCase();
      const ctrl = e.ctrlKey || e.metaKey;
      // Alt+1..9 jumps to a tab of the focused view.
      if (e.altKey && !ctrl && !e.shiftKey && /^[1-9]$/.test(key)) {
        const ids = store.panes[store.focusedPane].ids;
        const id = key === '9' ? ids[ids.length - 1] : ids[Number(key) - 1];
        if (id) {
          e.preventDefault();
          if (getCompare()) closeCompare();
          store.setActiveInPane(id, store.focusedPane);
        }
        return;
      }
      for (const s of SHORTCUTS) {
        if (s.key !== key || !!s.ctrl !== ctrl || !!s.alt !== e.altKey || !!s.shift !== e.shiftKey) continue;
        if (s.compareOnly && !getCompare()) continue;
        // Escape closes Monaco's find widget first; only close compare if nothing else is open.
        if (key === 'escape' && document.querySelector('.find-widget.visible, .suggest-widget.visible, .quick-input-widget:not([style*="display: none"])')) continue;
        e.preventDefault();
        e.stopPropagation();
        s.run();
        return;
      }
    },
    true,
  );
}

// ---------- help ----------

const SHORTCUT_ROWS: [string, string][] = [
  ['New file', 'Alt+N  (or double-click the tab strip)'],
  ['Open files', 'Ctrl+O  (or drag and drop files/folders)'],
  ['Save / Save As / Save All', 'Ctrl+S / Ctrl+Alt+S / Ctrl+Shift+S'],
  ['Close tab', 'Alt+W  (or middle-click the tab)'],
  ['Next / previous tab', 'Alt+PgDn / Alt+PgUp, Alt+1…9'],
  ['Switch view (split)', 'F8'],
  ['Undo / Redo', 'Ctrl+Z / Ctrl+Y'],
  ['Find / Replace', 'Ctrl+F / Ctrl+H'],
  ['Find in all tabs', 'Ctrl+Shift+F'],
  ['Go to line / symbol', 'Ctrl+G / Ctrl+Shift+O'],
  ['Go to / peek definition', 'F12 or Ctrl+Click / Alt+F12'],
  ['Bookmark: toggle / next / previous', 'Ctrl+F2 / F2 / Shift+F2  (or click the margin)'],
  ['Outline panel', 'Alt+O'],
  ['Markdown preview', 'Ctrl+Shift+V'],
  ['Align statements (HDL)', 'Ctrl+Alt+A'],
  ['Format document', 'Shift+Alt+F'],
  ['Duplicate / delete line', 'Ctrl+D / Ctrl+Shift+K'],
  ['Move line', 'Alt+↑ / Alt+↓'],
  ['Toggle comment', 'Ctrl+/'],
  ['Multi-cursor / column select', 'Alt+Click / Shift+Alt+Drag'],
  ['Word wrap', 'Alt+Z'],
  ['Zoom', 'Ctrl+= / Ctrl+- / Ctrl+0'],
  ['Compare files', 'Ctrl+Alt+C, then Alt+F5 / Shift+Alt+F5 to step, Esc to close'],
  ['Command palette', 'F1'],
];

function showShortcuts(): void {
  const table = document.createElement('table');
  table.className = 'shortcuts';
  for (const [a, b] of SHORTCUT_ROWS) {
    const tr = table.insertRow();
    tr.insertCell().textContent = a;
    const kbd = document.createElement('kbd');
    kbd.textContent = b;
    tr.insertCell().append(kbd);
  }
  void showInfo('Keyboard shortcuts', table);
}

function showAbout(): void {
  const p = document.createElement('div');
  p.innerHTML =
    '<p><strong>Syntax</strong> is a browser-based code editor. Files never leave your computer: everything runs locally in this tab, and open tabs are kept in this browser’s storage so a reload doesn’t lose work.</p>' +
    '<p>Editing is powered by the open-source Monaco editor.</p>';
  void showInfo('About Syntax', p);
}

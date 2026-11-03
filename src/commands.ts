import { store, type Doc } from './state/documents';
import { settings } from './state/settings';
import { SCHEMES } from './editor/themes';
import { saveAll, saveDoc, downloadAllZip } from './io/saveFiles';
import { pickAndOpen } from './io/openFiles';
import { confirmSave, confirmSaveMany, pickTwo, promptText, showInfo } from './ui/dialogs';
import {
  closeCompare,
  diffNavigate,
  focusedDoc,
  getCompare,
  openCompare,
  runEditorAction,
  swapCompare,
} from './ui/editorView';
import type { Menu, MenuItem } from './ui/menuBar';
import { encodingMenuItems, eolMenuItems, languageMenuItems } from './ui/statusBar';

let fileInput: HTMLInputElement;
export function setFileInput(input: HTMLInputElement): void {
  fileInput = input;
}

// ---------- file commands ----------

export function newFile(): void {
  const doc = store.createUntitled();
  if (getCompare()) closeCompare();
  store.setActive(doc.id);
}

export function openFiles(): void {
  void pickAndOpen(fileInput);
}

export async function save(doc = focusedDoc()): Promise<boolean> {
  return doc ? saveDoc(doc) : false;
}

export async function saveAs(doc = focusedDoc()): Promise<boolean> {
  return doc ? saveDoc(doc, { saveAs: true }) : false;
}

/** Close one doc, asking to save if it has unsaved changes. Resolves false if cancelled. */
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

function cycleTab(delta: number): void {
  if (store.docs.length === 0) return;
  const i = store.docs.findIndex((d) => d.id === store.activeId);
  const next = store.docs[(i + delta + store.docs.length) % store.docs.length];
  if (getCompare()) closeCompare();
  store.setActive(next.id);
}

function zoom(delta: number | null): void {
  const size = delta === null ? 14 : Math.max(6, Math.min(48, settings.get().fontSize + delta));
  settings.update({ fontSize: size });
}

const toggle = (key: 'wordWrap' | 'renderWhitespace' | 'minimap' | 'lineNumbers' | 'diffInline' | 'diffIgnoreWhitespace') =>
  settings.update({ [key]: !settings.get()[key] });

export function toggleDarkMode(): void {
  const { mode } = settings.get();
  const dark = mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  settings.update({ mode: dark ? 'light' : 'dark' });
}

// ---------- menus ----------

const noDoc = () => !focusedDoc();
const act = (id: string) => () => runEditorAction(id);

function editorItem(label: string, id: string, shortcut?: string): MenuItem {
  return { label, shortcut, action: act(id), disabled: noDoc };
}

export function buildMenus(): Menu[] {
  return [
    {
      label: 'File',
      items: () => [
        { label: 'New', shortcut: 'Alt+N', action: newFile },
        { label: 'Open…', shortcut: 'Ctrl+O', action: openFiles },
        'separator',
        { label: 'Save', shortcut: 'Ctrl+S', action: () => void save(), disabled: noDoc },
        { label: 'Save As…', shortcut: 'Ctrl+Alt+S', action: () => void saveAs(), disabled: noDoc },
        { label: 'Save All', shortcut: 'Ctrl+Shift+S', action: () => void saveAll(), disabled: () => !store.anyDirty() },
        { label: 'Download All as ZIP', action: downloadAllZip, disabled: () => store.docs.length === 0 },
        'separator',
        { label: 'Rename…', action: () => void renameDoc(), disabled: noDoc },
        'separator',
        { label: 'Close', shortcut: 'Alt+W', action: () => void closeDoc(), disabled: noDoc },
        { label: 'Close All', action: () => void closeMany([...store.docs]), disabled: () => store.docs.length === 0 },
        {
          label: 'Close All but Active',
          action: () => void closeMany(store.docs.filter((d) => d.id !== store.activeId)),
          disabled: () => store.docs.length < 2,
        },
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
            editorItem('Convert Indentation to Spaces', 'editor.action.indentationToSpaces'),
            editorItem('Convert Indentation to Tabs', 'editor.action.indentationToTabs'),
            editorItem('Format Document', 'editor.action.formatDocument', 'Shift+Alt+F'),
          ],
        },
        { label: 'EOL Conversion', submenu: eolMenuItems },
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
        'separator',
        editorItem('Go to Line…', 'editor.action.gotoLine', 'Ctrl+G'),
        editorItem('Go to Matching Bracket', 'editor.action.jumpToBracket', 'Ctrl+Shift+\\'),
      ],
    },
    {
      label: 'View',
      items: () => [
        { label: 'Word Wrap', shortcut: 'Alt+Z', checked: () => settings.get().wordWrap, action: () => toggle('wordWrap') },
        { label: 'Show Whitespace', checked: () => settings.get().renderWhitespace, action: () => toggle('renderWhitespace') },
        { label: 'Line Numbers', checked: () => settings.get().lineNumbers, action: () => toggle('lineNumbers') },
        { label: 'Minimap', checked: () => settings.get().minimap, action: () => toggle('minimap') },
        'separator',
        { label: 'Zoom In', shortcut: 'Ctrl+=', action: () => zoom(1) },
        { label: 'Zoom Out', shortcut: 'Ctrl+-', action: () => zoom(-1) },
        { label: 'Reset Zoom', shortcut: 'Ctrl+0', action: () => zoom(null) },
        'separator',
        editorItem('Fold All', 'editor.foldAll'),
        editorItem('Unfold All', 'editor.unfoldAll'),
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
  { key: 'w', alt: true, run: () => void closeDoc() },
  { key: 'pagedown', alt: true, run: () => cycleTab(1) },
  { key: 'pageup', alt: true, run: () => cycleTab(-1) },
  { key: 'z', alt: true, run: () => toggle('wordWrap') },
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
      // Alt+1..9 jumps to a tab.
      if (e.altKey && !ctrl && !e.shiftKey && /^[1-9]$/.test(key)) {
        const doc = key === '9' ? store.docs[store.docs.length - 1] : store.docs[Number(key) - 1];
        if (doc) {
          e.preventDefault();
          if (getCompare()) closeCompare();
          store.setActive(doc.id);
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

function showShortcuts(): void {
  const rows: [string, string][] = [
    ['New file', 'Alt+N  (or double-click the tab strip)'],
    ['Open files', 'Ctrl+O  (or drag and drop files/folders)'],
    ['Save / Save As / Save All', 'Ctrl+S / Ctrl+Alt+S / Ctrl+Shift+S'],
    ['Close tab', 'Alt+W  (or middle-click the tab)'],
    ['Next / previous tab', 'Alt+PgDn / Alt+PgUp, Alt+1…9'],
    ['Undo / Redo', 'Ctrl+Z / Ctrl+Y'],
    ['Find / Replace', 'Ctrl+F / Ctrl+H'],
    ['Go to line', 'Ctrl+G'],
    ['Duplicate / delete line', 'Ctrl+D / Ctrl+Shift+K'],
    ['Move line', 'Alt+↑ / Alt+↓'],
    ['Toggle comment', 'Ctrl+/'],
    ['Multi-cursor / column select', 'Alt+Click / Shift+Alt+Drag'],
    ['Word wrap', 'Alt+Z'],
    ['Zoom', 'Ctrl+= / Ctrl+- / Ctrl+0'],
    ['Compare files', 'Ctrl+Alt+C, then Alt+F5 / Shift+Alt+F5 to step, Esc to close'],
    ['Command palette', 'F1'],
  ];
  const table = document.createElement('table');
  table.className = 'shortcuts';
  for (const [a, b] of rows) {
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

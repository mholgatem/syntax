import './styles/app.css';
import { store, type Doc, type PaneIndex } from './state/documents';
import { settings } from './state/settings';
import { restoreSession, startAutosave } from './state/persistence';
import { forgetRecent, loadRecent, rememberClosed } from './state/recent';
import { handleDrop, handleInputChange } from './io/openFiles';
import { saveAll, downloadAllZip } from './io/saveFiles';
import { initTheme } from './ui/theme';
import {
  closeCompare,
  diffNavigate,
  getCompare,
  initEditors,
  onCompareChange,
  runEditorAction,
  swapCompare,
  viewStateFor,
} from './ui/editorView';
import { initTabBar } from './ui/tabBar';
import { initMenuBar } from './ui/menuBar';
import { initStatusBar } from './ui/statusBar';
import { initSidebar, showSidebarTab } from './ui/sidebar';
import { initOutline } from './ui/outline';
import { initSearchPanel, openSearchPanel } from './ui/searchPanel';
import { initPwa } from './pwa';
import {
  buildMenus,
  closeDoc,
  closeTab,
  closeTabs,
  compareWith,
  initShortcuts,
  newFile,
  openFiles,
  renameDoc,
  save,
  saveAs,
  setFileInput,
  toggleDarkMode,
} from './commands';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function initToolbar(root: HTMLElement): void {
  type Btn = { icon: string; title: string; run: () => void; id?: string } | 'sep';
  const buttons: Btn[] = [
    { icon: 'new-file', title: 'New (Alt+N)', run: newFile },
    { icon: 'folder-opened', title: 'Open… (Ctrl+O)', run: openFiles },
    { icon: 'save', title: 'Save (Ctrl+S)', run: () => void save(), id: 'tb-save' },
    { icon: 'save-all', title: 'Save All (Ctrl+Shift+S)', run: () => void saveAll(), id: 'tb-save-all' },
    { icon: 'file-zip', title: 'Download all as ZIP', run: downloadAllZip },
    { icon: 'close', title: 'Close (Alt+W)', run: () => void closeDoc() },
    'sep',
    { icon: 'discard', title: 'Undo (Ctrl+Z)', run: () => runEditorAction('undo') },
    { icon: 'redo', title: 'Redo (Ctrl+Y)', run: () => runEditorAction('redo') },
    'sep',
    { icon: 'search', title: 'Find (Ctrl+F)', run: () => runEditorAction('actions.find') },
    { icon: 'replace', title: 'Replace (Ctrl+H)', run: () => runEditorAction('editor.action.startFindReplaceAction') },
    'sep',
    { icon: 'zoom-in', title: 'Zoom In (Ctrl+=)', run: () => settings.update({ fontSize: Math.min(48, settings.get().fontSize + 1) }) },
    { icon: 'zoom-out', title: 'Zoom Out (Ctrl+-)', run: () => settings.update({ fontSize: Math.max(6, settings.get().fontSize - 1) }) },
    { icon: 'word-wrap', title: 'Word Wrap (Alt+Z)', run: () => settings.update({ wordWrap: !settings.get().wordWrap }), id: 'tb-wrap' },
    { icon: 'whitespace', title: 'Show Whitespace', run: () => settings.update({ renderWhitespace: !settings.get().renderWhitespace }), id: 'tb-ws' },
    'sep',
    { icon: 'diff', title: 'Compare Files (Ctrl+Alt+C)', run: () => void compareWith(), id: 'tb-compare' },
    'sep',
    { icon: 'list-tree', title: 'Outline (Alt+O)', run: () => showSidebarTab('outline', true), id: 'tb-outline' },
    { icon: 'search-fuzzy', title: 'Find in All Tabs (Ctrl+Shift+F)', run: openSearchPanel, id: 'tb-search' },
    'sep',
    { icon: 'color-mode', title: 'Toggle Light/Dark', run: toggleDarkMode },
  ];
  for (const b of buttons) {
    if (b === 'sep') {
      const s = document.createElement('span');
      s.className = 'toolbar-sep';
      root.append(s);
      continue;
    }
    const el = document.createElement('button');
    el.className = `toolbar-btn codicon codicon-${b.icon}`;
    el.title = b.title;
    el.setAttribute('aria-label', b.title);
    if (b.id) el.id = b.id;
    el.addEventListener('mousedown', (e) => e.preventDefault()); // keep editor focus
    el.addEventListener('click', b.run);
    root.append(el);
  }
  const syncToggles = () => {
    const s = settings.get();
    $('tb-wrap').classList.toggle('on', s.wordWrap);
    $('tb-ws').classList.toggle('on', s.renderWhitespace);
    $('tb-compare').classList.toggle('on', !!getCompare());
    $('tb-outline').classList.toggle('on', s.sidebarOpen && s.sidebarTab === 'outline');
    $('tb-search').classList.toggle('on', s.sidebarOpen && s.sidebarTab === 'search');
    ($('tb-save-all') as HTMLButtonElement).disabled = !store.anyDirty();
  };
  settings.subscribe(syncToggles);
  store.subscribe(syncToggles);
  onCompareChange(syncToggles);
  syncToggles();
}

function initDiffToolbar(): void {
  const bar = $('diff-toolbar');
  const title = document.createElement('span');
  title.className = 'diff-title';
  const mk = (icon: string, label: string, run: () => void, id?: string) => {
    const b = document.createElement('button');
    b.className = 'diff-btn';
    if (id) b.id = id;
    b.innerHTML = `<span class="codicon codicon-${icon}" aria-hidden="true"></span>`;
    b.append(document.createTextNode(label));
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', run);
    return b;
  };
  const toggleInline = mk('split-horizontal', 'Inline', () => settings.update({ diffInline: !settings.get().diffInline }), 'diff-inline');
  const toggleWs = mk('whitespace', 'Ignore whitespace', () => settings.update({ diffIgnoreWhitespace: !settings.get().diffIgnoreWhitespace }), 'diff-ws');
  bar.append(
    title,
    mk('arrow-up', 'Previous', () => diffNavigate('previous')),
    mk('arrow-down', 'Next', () => diffNavigate('next')),
    mk('arrow-swap', 'Swap', swapCompare),
    toggleInline,
    toggleWs,
    mk('close', 'Close compare', closeCompare),
  );
  const sync = () => {
    const cmp = getCompare();
    const l = cmp && store.get(cmp.left);
    const r = cmp && store.get(cmp.right);
    title.replaceChildren();
    if (l && r) {
      const a = document.createElement('strong');
      a.textContent = l.name;
      const b = document.createElement('strong');
      b.textContent = r.name;
      title.append(a, document.createTextNode('  ↔  '), b);
    }
    toggleInline.classList.toggle('on', settings.get().diffInline);
    toggleWs.classList.toggle('on', settings.get().diffIgnoreWhitespace);
  };
  onCompareChange(sync);
  store.subscribe(sync);
  settings.subscribe(sync);
}

function initDropZone(): void {
  const overlay = $('drop-overlay');
  let depth = 0;
  const isFileDrag = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    depth++;
    overlay.classList.add('visible');
  });
  window.addEventListener('dragover', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'copy';
  });
  window.addEventListener('dragleave', (e) => {
    if (!isFileDrag(e)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) overlay.classList.remove('visible');
  });
  window.addEventListener('drop', (e) => {
    depth = 0;
    overlay.classList.remove('visible');
    if (!isFileDrag(e) || !e.dataTransfer) return;
    e.preventDefault();
    if (getCompare()) closeCompare();
    void handleDrop(e.dataTransfer);
  });
}

/** Drag the divider between the two views. */
function initPaneDivider(): void {
  const divider = $('pane-divider');
  const left = $('pane-0');
  const right = $('pane-1');
  const apply = (ratio: number) => {
    left.style.flexGrow = String(ratio);
    right.style.flexGrow = String(1 - ratio);
  };
  divider.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    divider.setPointerCapture(e.pointerId);
    divider.classList.add('dragging');
    const box = $('panes').getBoundingClientRect();
    let ratio = settings.get().splitRatio;
    const move = (ev: PointerEvent) => {
      ratio = Math.max(0.15, Math.min(0.85, (ev.clientX - box.left) / box.width));
      apply(ratio);
    };
    const up = () => {
      divider.classList.remove('dragging');
      divider.removeEventListener('pointermove', move);
      divider.removeEventListener('pointerup', up);
      settings.update({ splitRatio: ratio });
    };
    divider.addEventListener('pointermove', move);
    divider.addEventListener('pointerup', up);
  });
  divider.addEventListener('dblclick', () => settings.update({ splitRatio: 0.5 }));
  settings.subscribe((s) => apply(s.splitRatio));
  apply(settings.get().splitRatio);
}

function initWelcome(): void {
  const welcome = $('welcome');
  $('welcome-new').addEventListener('click', newFile);
  $('welcome-open').addEventListener('click', openFiles);
  const sync = () => welcome.classList.toggle('visible', store.docs.length === 0);
  store.subscribe(sync);
  sync();
}

async function main(): Promise<void> {
  initTheme();
  initEditors([$('editor-host'), $('editor-host-2')], $('diff-host'));
  initMenuBar($('menubar'), buildMenus());
  initToolbar($('toolbar'));
  const tabActions = {
    closeTab: (d: Doc, p: PaneIndex) => void closeTab(d, p),
    closeTabs: (docs: Doc[], p: PaneIndex) => void closeTabs(docs, p),
    rename: (d: Doc) => void renameDoc(d),
    save: (d: Doc) => void save(d),
    saveAs: (d: Doc) => void saveAs(d),
    compareWith: (d: Doc) => void compareWith(d),
    newFile,
  };
  initTabBar($('tabbar'), 0, tabActions);
  initTabBar($('tabbar-2'), 1, tabActions);
  initPaneDivider();
  initStatusBar($('statusbar'));
  initSidebar();
  initOutline($('outline-panel'));
  initSearchPanel($('search-panel'));
  initDiffToolbar();
  initDropZone();
  initWelcome();
  initShortcuts();

  const input = $<HTMLInputElement>('file-input');
  setFileInput(input);
  input.addEventListener('change', () => void handleInputChange(input));

  // Recently closed files: remember a file when its tab closes, forget it when it is reopened.
  void loadRecent();
  store.onRemove((doc) => {
    if (doc.handle) void rememberClosed(doc.name, doc.handle);
  });
  let known = new Set<string>();

  const restored = await restoreSession();
  if (!restored) store.setActive(null);
  known = new Set(store.docs.map((d) => d.id));
  store.subscribe(() => {
    for (const d of store.docs) {
      if (known.has(d.id)) continue;
      known.add(d.id);
      if (d.handle) void forgetRecent(d.handle);
    }
  });
  startAutosave(viewStateFor);
  initPwa();

  // Ask before leaving with unsaved changes. Browsers show their own generic message.
  window.addEventListener('beforeunload', (e) => {
    if (store.anyDirty()) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // Keep the document title informative.
  const syncTitle = () => {
    const d = store.active;
    document.title = d ? `${store.isDirty(d) ? '● ' : ''}${d.name} — Syntax` : 'Syntax';
  };
  store.subscribe(syncTitle);
  syncTitle();
  document.body.classList.add('ready');
}

void main();

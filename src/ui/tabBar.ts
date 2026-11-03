import { store, type Doc, type PaneIndex } from '../state/documents';
import { languageLabel } from '../editor/languages';
import { closeCompare, getCompare, onCompareChange } from './editorView';
import { showContextMenu, type MenuItem } from './menuBar';

export interface TabActions {
  /** Close a tab in one view (only the view's copy if the doc is cloned). */
  closeTab(doc: Doc, pane: PaneIndex): void;
  closeTabs(docs: Doc[], pane: PaneIndex): void;
  rename(doc: Doc): void;
  save(doc: Doc): void;
  saveAs(doc: Doc): void;
  compareWith(doc: Doc): void;
  newFile(): void;
}

const DRAG_TYPE = 'application/x-syntax-tab';
const other = (p: PaneIndex): PaneIndex => (p === 0 ? 1 : 0);

/** Render the tab strip of one view. */
export function initTabBar(root: HTMLElement, pane: PaneIndex, actions: TabActions): void {
  root.setAttribute('role', 'tablist');

  const dropAt = (e: DragEvent, index: number | undefined) => {
    const data = e.dataTransfer?.getData(DRAG_TYPE);
    if (!data) return;
    e.preventDefault();
    e.stopPropagation();
    const [from, id] = [Number(data[0]) as PaneIndex, data.slice(2)];
    if (from === pane) {
      const ids = store.panes[pane].ids;
      let to = index ?? ids.length;
      if (ids.indexOf(id) < to) to--;
      store.move(id, to, pane);
    } else {
      if (getCompare()) closeCompare();
      store.moveToPane(id, from, pane, index);
    }
  };

  const render = () => {
    const cmp = getCompare();
    const paneState = store.panes[pane];
    root.parentElement?.classList.toggle('focused', store.focusedPane === pane);
    root.replaceChildren(
      ...store.paneDocs(pane).map((doc, idx) => {
        const tab = document.createElement('div');
        tab.className = 'tab';
        tab.setAttribute('role', 'tab');
        tab.dataset.id = doc.id;
        tab.draggable = true;
        const isActive = doc.id === paneState.activeId && !cmp;
        const inCompare = !!cmp && (cmp.left === doc.id || cmp.right === doc.id);
        tab.classList.toggle('active', isActive);
        tab.classList.toggle('in-compare', inCompare);
        tab.classList.toggle('cloned', store.panesOf(doc.id).length > 1);
        tab.setAttribute('aria-selected', String(isActive));
        const dirty = store.isDirty(doc);
        tab.classList.toggle('dirty', dirty);
        tab.title = `${doc.name}${doc.handle ? '' : doc.untitled ? ' (not saved yet)' : ' (no file link: Save downloads a copy)'}\n${languageLabel(doc.model.getLanguageId())}${dirty ? ' • modified' : ''}`;

        const icon = document.createElement('span');
        icon.className = 'tab-state codicon ' + (dirty ? 'codicon-circle-filled' : 'codicon-file');
        icon.setAttribute('aria-hidden', 'true');

        const label = document.createElement('span');
        label.className = 'tab-label';
        label.textContent = doc.name;

        const close = document.createElement('button');
        close.className = 'tab-close codicon codicon-close';
        close.title = 'Close (Alt+W)';
        close.setAttribute('aria-label', `Close ${doc.name}`);
        close.addEventListener('click', (e) => {
          e.stopPropagation();
          actions.closeTab(doc, pane);
        });

        tab.append(icon, label, close);
        tab.addEventListener('mousedown', (e) => {
          if (e.button === 1) e.preventDefault(); // suppress autoscroll on middle-click
        });
        tab.addEventListener('auxclick', (e) => {
          if (e.button === 1) actions.closeTab(doc, pane);
        });
        tab.addEventListener('click', () => {
          if (getCompare()) closeCompare();
          store.setActiveInPane(doc.id, pane);
        });
        tab.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          actions.rename(doc);
        });
        tab.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          showContextMenu(e.clientX, e.clientY, tabMenu(doc, pane, actions));
        });

        tab.addEventListener('dragstart', (e) => {
          e.dataTransfer!.setData(DRAG_TYPE, `${pane}:${doc.id}`);
          e.dataTransfer!.effectAllowed = 'move';
          tab.classList.add('dragging');
        });
        tab.addEventListener('dragend', () => tab.classList.remove('dragging'));
        tab.addEventListener('dragover', (e) => {
          if (!e.dataTransfer?.types.includes(DRAG_TYPE)) return;
          e.preventDefault();
          e.stopPropagation();
          const rect = tab.getBoundingClientRect();
          const after = e.clientX > rect.left + rect.width / 2;
          tab.classList.toggle('drop-before', !after);
          tab.classList.toggle('drop-after', after);
        });
        tab.addEventListener('dragleave', () => tab.classList.remove('drop-before', 'drop-after'));
        tab.addEventListener('drop', (e) => {
          tab.classList.remove('drop-before', 'drop-after');
          const rect = tab.getBoundingClientRect();
          dropAt(e, idx + (e.clientX > rect.left + rect.width / 2 ? 1 : 0));
        });
        return tab;
      }),
    );
    root.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };

  // Dropping on empty tab-strip space appends the tab to this view.
  root.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types.includes(DRAG_TYPE)) e.preventDefault();
  });
  root.addEventListener('drop', (e) => dropAt(e, undefined));
  // Double-click empty tab-strip space for a new file (Notepad++ behaviour).
  root.addEventListener('dblclick', (e) => {
    if (e.target !== root) return;
    store.focusPane(pane);
    actions.newFile();
  });
  root.addEventListener(
    'wheel',
    (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        root.scrollLeft += e.deltaY;
        e.preventDefault();
      }
    },
    { passive: false },
  );

  store.subscribe(render);
  onCompareChange(render);
  render();
}

function tabMenu(doc: Doc, pane: PaneIndex, a: TabActions): MenuItem[] {
  const docs = store.paneDocs(pane);
  const others = docs.filter((d) => d !== doc);
  const idx = docs.indexOf(doc);
  const otherPane = other(pane);
  const inOther = store.panes[otherPane].ids.includes(doc.id);
  return [
    { label: 'Save', action: () => a.save(doc) },
    { label: 'Save As…', action: () => a.saveAs(doc) },
    { label: 'Rename…', action: () => a.rename(doc) },
    'separator',
    { label: 'Compare With…', action: () => a.compareWith(doc), disabled: () => store.docs.length < 2 },
    'separator',
    {
      label: 'Move to Other View',
      action: () => {
        if (getCompare()) closeCompare();
        store.moveToPane(doc.id, pane, otherPane);
      },
      disabled: () => docs.length < 2 && !store.split,
    },
    {
      label: 'Clone to Other View',
      action: () => {
        if (getCompare()) closeCompare();
        store.cloneToPane(doc.id, otherPane);
      },
      disabled: () => inOther,
    },
    'separator',
    { label: 'Close', action: () => a.closeTab(doc, pane) },
    { label: 'Close Others', action: () => a.closeTabs(others, pane), disabled: () => others.length === 0 },
    { label: 'Close Tabs to the Left', action: () => a.closeTabs(docs.slice(0, idx), pane), disabled: () => idx === 0 },
    { label: 'Close Tabs to the Right', action: () => a.closeTabs(docs.slice(idx + 1), pane), disabled: () => idx === docs.length - 1 },
    { label: 'Close All', action: () => a.closeTabs([...docs], pane) },
    'separator',
    { label: 'Copy File Name', action: () => void navigator.clipboard?.writeText(doc.name) },
  ];
}

import { store, type Doc } from '../state/documents';
import { languageLabel } from '../editor/languages';
import { closeCompare, getCompare, onCompareChange } from './editorView';
import { showContextMenu, type MenuItem } from './menuBar';

export interface TabActions {
  close(doc: Doc): void;
  closeMany(docs: Doc[]): void;
  rename(doc: Doc): void;
  save(doc: Doc): void;
  saveAs(doc: Doc): void;
  compareWith(doc: Doc): void;
  newFile(): void;
}

const DRAG_TYPE = 'application/x-syntax-tab';

export function initTabBar(root: HTMLElement, actions: TabActions): void {
  root.setAttribute('role', 'tablist');

  const render = () => {
    const cmp = getCompare();
    root.replaceChildren(
      ...store.docs.map((doc) => {
        const tab = document.createElement('div');
        tab.className = 'tab';
        tab.setAttribute('role', 'tab');
        tab.dataset.id = doc.id;
        tab.draggable = true;
        const isActive = doc.id === store.activeId && !cmp;
        const inCompare = !!cmp && (cmp.left === doc.id || cmp.right === doc.id);
        tab.classList.toggle('active', isActive);
        tab.classList.toggle('in-compare', inCompare);
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
          actions.close(doc);
        });

        tab.append(icon, label, close);
        tab.addEventListener('mousedown', (e) => {
          if (e.button === 1) e.preventDefault(); // suppress autoscroll on middle-click
        });
        tab.addEventListener('auxclick', (e) => {
          if (e.button === 1) actions.close(doc);
        });
        tab.addEventListener('click', () => {
          if (getCompare()) closeCompare();
          store.setActive(doc.id);
        });
        tab.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          actions.rename(doc);
        });
        tab.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          showContextMenu(e.clientX, e.clientY, tabMenu(doc, actions));
        });

        tab.addEventListener('dragstart', (e) => {
          e.dataTransfer!.setData(DRAG_TYPE, doc.id);
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
          const id = e.dataTransfer?.getData(DRAG_TYPE);
          tab.classList.remove('drop-before', 'drop-after');
          if (!id) return;
          e.preventDefault();
          e.stopPropagation();
          const rect = tab.getBoundingClientRect();
          const after = e.clientX > rect.left + rect.width / 2;
          const from = store.docs.findIndex((d) => d.id === id);
          let to = store.docs.findIndex((d) => d.id === doc.id) + (after ? 1 : 0);
          if (from < to) to--;
          store.move(id, to);
        });
        return tab;
      }),
    );
    root.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };

  // Double-click empty tab-strip space for a new file (Notepad++ behaviour).
  root.addEventListener('dblclick', (e) => {
    if (e.target === root) actions.newFile();
  });
  root.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      root.scrollLeft += e.deltaY;
      e.preventDefault();
    }
  }, { passive: false });

  store.subscribe(render);
  onCompareChange(render);
  render();
}

function tabMenu(doc: Doc, a: TabActions): MenuItem[] {
  const others = store.docs.filter((d) => d !== doc);
  const idx = store.docs.indexOf(doc);
  return [
    { label: 'Save', action: () => a.save(doc) },
    { label: 'Save As…', action: () => a.saveAs(doc) },
    { label: 'Rename…', action: () => a.rename(doc) },
    'separator',
    { label: 'Compare With…', action: () => a.compareWith(doc), disabled: () => others.length === 0 },
    'separator',
    { label: 'Close', action: () => a.close(doc) },
    { label: 'Close Others', action: () => a.closeMany(others), disabled: () => others.length === 0 },
    { label: 'Close Tabs to the Left', action: () => a.closeMany(store.docs.slice(0, idx)), disabled: () => idx === 0 },
    { label: 'Close Tabs to the Right', action: () => a.closeMany(store.docs.slice(idx + 1)), disabled: () => idx === store.docs.length - 1 },
    { label: 'Close All', action: () => a.closeMany([...store.docs]) },
    'separator',
    { label: 'Copy File Name', action: () => void navigator.clipboard?.writeText(doc.name) },
  ];
}

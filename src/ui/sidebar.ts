import { settings, type SidebarTab } from '../state/settings';

// Right-hand side panel with tabs (Outline, Search). Panels register a callback that runs
// whenever they become visible, so they can skip work while hidden.

const showHandlers = new Map<SidebarTab, () => void>();

export function registerSidebarPanel(tab: SidebarTab, onShow: () => void): void {
  showHandlers.set(tab, onShow);
}

export function isPanelVisible(tab: SidebarTab): boolean {
  const s = settings.get();
  return s.sidebarOpen && s.sidebarTab === tab;
}

/** Open the panel on `tab`. With `toggle`, close it instead if that tab is already showing. */
export function showSidebarTab(tab: SidebarTab, toggle = false): void {
  if (toggle && isPanelVisible(tab)) {
    settings.update({ sidebarOpen: false });
    return;
  }
  settings.update({ sidebarOpen: true, sidebarTab: tab });
}

export function closeSidebar(): void {
  settings.update({ sidebarOpen: false });
}

export function initSidebar(): void {
  const sidebar = document.getElementById('sidebar')!;
  const resizer = document.getElementById('sidebar-resizer')!;
  const tabs = [...sidebar.querySelectorAll<HTMLButtonElement>('.sidebar-tab')];
  const panels = [...sidebar.querySelectorAll<HTMLElement>('.sidebar-panel')];

  let shown: string | null = null;
  const apply = () => {
    const s = settings.get();
    document.body.classList.toggle('sidebar-open', s.sidebarOpen);
    document.documentElement.style.setProperty('--sidebar-width', `${s.sidebarWidth}px`);
    for (const t of tabs) {
      const active = t.dataset.tab === s.sidebarTab;
      t.classList.toggle('active', active);
      t.setAttribute('aria-selected', String(active));
    }
    for (const p of panels) p.classList.toggle('active', p.dataset.tab === s.sidebarTab);
    const now = s.sidebarOpen ? s.sidebarTab : null;
    if (now && now !== shown) showHandlers.get(now)?.();
    shown = now;
  };

  for (const t of tabs) t.addEventListener('click', () => showSidebarTab(t.dataset.tab as SidebarTab));
  sidebar.querySelector('.sidebar-close')!.addEventListener('click', closeSidebar);

  resizer.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    resizer.setPointerCapture(e.pointerId);
    resizer.classList.add('dragging');
    let width = settings.get().sidebarWidth;
    const move = (ev: PointerEvent) => {
      width = Math.round(Math.max(180, Math.min(window.innerWidth * 0.7, window.innerWidth - ev.clientX)));
      document.documentElement.style.setProperty('--sidebar-width', `${width}px`);
    };
    const up = () => {
      resizer.classList.remove('dragging');
      resizer.removeEventListener('pointermove', move);
      resizer.removeEventListener('pointerup', up);
      settings.update({ sidebarWidth: width });
    };
    resizer.addEventListener('pointermove', move);
    resizer.addEventListener('pointerup', up);
  });

  settings.subscribe(apply);
  apply();
}

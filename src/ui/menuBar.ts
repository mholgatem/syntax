// Desktop-style menu bar, dropdowns, submenus and context menus.

export type MenuItem =
  | 'separator'
  | {
      label: string;
      shortcut?: string;
      action?: () => void;
      disabled?: () => boolean;
      checked?: () => boolean;
      submenu?: () => MenuItem[];
    };

export interface Menu {
  label: string;
  items: () => MenuItem[];
}

let openPopups: HTMLElement[] = [];
let activeTop: HTMLButtonElement | null = null;
let onCloseAll: (() => void) | null = null;

function closeAll(): void {
  for (const p of openPopups) p.remove();
  openPopups = [];
  activeTop?.classList.remove('open');
  activeTop?.setAttribute('aria-expanded', 'false');
  activeTop = null;
  onCloseAll?.();
  onCloseAll = null;
}

function closeFrom(level: number): void {
  for (const p of openPopups.splice(level)) p.remove();
}

function renderPopup(items: MenuItem[], x: number, y: number, level: number, alignRightOf?: DOMRect): HTMLElement {
  closeFrom(level);
  const popup = document.createElement('div');
  popup.className = 'menu-popup';
  popup.setAttribute('role', 'menu');
  popup.tabIndex = -1;

  for (const item of items) {
    if (item === 'separator') {
      const sep = document.createElement('div');
      sep.className = 'menu-sep';
      sep.setAttribute('role', 'separator');
      popup.append(sep);
      continue;
    }
    const row = document.createElement('button');
    row.className = 'menu-item';
    row.setAttribute('role', item.checked ? 'menuitemcheckbox' : 'menuitem');
    const disabled = item.disabled?.() ?? false;
    row.disabled = disabled;
    const checked = item.checked?.();
    if (checked !== undefined) row.setAttribute('aria-checked', String(checked));

    const check = document.createElement('span');
    check.className = 'menu-check codicon' + (checked ? ' codicon-check' : '');
    const label = document.createElement('span');
    label.className = 'menu-label';
    label.textContent = item.label;
    const right = document.createElement('span');
    right.className = 'menu-shortcut';
    if (item.submenu) right.className += ' codicon codicon-chevron-right';
    else right.textContent = item.shortcut ?? '';
    row.append(check, label, right);

    if (item.submenu) {
      const open = () => {
        const r = row.getBoundingClientRect();
        renderPopup(item.submenu!(), r.right, r.top - 4, level + 1, r);
      };
      row.addEventListener('mouseenter', open);
      row.addEventListener('click', open);
      row.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          e.stopPropagation();
          open();
          (openPopups[level + 1]?.querySelector('.menu-item:not(:disabled)') as HTMLElement | null)?.focus();
        }
      });
    } else {
      row.addEventListener('mouseenter', () => {
        closeFrom(level + 1);
        row.focus({ preventScroll: true });
      });
      row.addEventListener('click', () => {
        if (disabled) return;
        closeAll();
        item.action?.();
      });
    }
    popup.append(row);
  }

  popup.addEventListener('keydown', (e) => {
    const rows = [...popup.querySelectorAll<HTMLButtonElement>(':scope > .menu-item:not(:disabled)')];
    const i = rows.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      const next = e.key === 'ArrowDown' ? (i + 1) % rows.length : (i - 1 + rows.length) % rows.length;
      rows[next]?.focus();
    } else if (e.key === 'ArrowLeft' && level > 0) {
      e.preventDefault();
      e.stopPropagation();
      closeFrom(level);
      (openPopups[level - 1]?.querySelector('.menu-item:focus, .menu-item') as HTMLElement | null)?.focus();
    }
  });

  document.body.append(popup);
  openPopups.push(popup);

  // Keep the popup on screen.
  const r = popup.getBoundingClientRect();
  let left = x;
  let top = y;
  if (left + r.width > window.innerWidth - 4) left = alignRightOf ? alignRightOf.left - r.width : window.innerWidth - r.width - 4;
  if (top + r.height > window.innerHeight - 4) top = Math.max(4, window.innerHeight - r.height - 4);
  popup.style.left = `${Math.max(4, left)}px`;
  popup.style.top = `${top}px`;
  return popup;
}

export function showContextMenu(x: number, y: number, items: MenuItem[]): void {
  closeAll();
  const popup = renderPopup(items, x, y, 0);
  popup.focus();
}

export function initMenuBar(root: HTMLElement, menus: Menu[]): void {
  root.setAttribute('role', 'menubar');
  const buttons: HTMLButtonElement[] = [];

  const openMenu = (btn: HTMLButtonElement, menu: Menu, focusFirst: boolean) => {
    closeAll();
    activeTop = btn;
    btn.classList.add('open');
    btn.setAttribute('aria-expanded', 'true');
    const r = btn.getBoundingClientRect();
    const popup = renderPopup(menu.items(), r.left, r.bottom, 0);
    popup.classList.add('menu-dropdown');
    if (focusFirst) (popup.querySelector('.menu-item:not(:disabled)') as HTMLElement | null)?.focus();
    else popup.focus();
    popup.addEventListener('keydown', (e) => {
      const idx = buttons.indexOf(btn);
      if (e.key === 'ArrowRight' && !(document.activeElement as HTMLElement)?.querySelector('.codicon-chevron-right')) {
        e.preventDefault();
        const n = buttons[(idx + 1) % buttons.length];
        openMenu(n, menus[buttons.indexOf(n)], true);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const n = buttons[(idx - 1 + buttons.length) % buttons.length];
        openMenu(n, menus[buttons.indexOf(n)], true);
      }
    });
  };

  menus.forEach((menu) => {
    const btn = document.createElement('button');
    btn.className = 'menubar-item';
    btn.textContent = menu.label;
    btn.setAttribute('aria-haspopup', 'menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (activeTop === btn) closeAll();
      else openMenu(btn, menu, false);
    });
    btn.addEventListener('mouseenter', () => {
      if (activeTop && activeTop !== btn) openMenu(btn, menu, false);
    });
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        openMenu(btn, menu, true);
      }
    });
    buttons.push(btn);
    root.append(btn);
  });

  document.addEventListener(
    'mousedown',
    (e) => {
      if (openPopups.length === 0) return;
      const t = e.target as Node;
      if (openPopups.some((p) => p.contains(t)) || buttons.some((b) => b.contains(t))) return;
      closeAll();
    },
    true,
  );
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape' && openPopups.length) {
        e.preventDefault();
        e.stopPropagation();
        const top = activeTop;
        closeAll();
        top?.focus();
      }
    },
    true,
  );
  window.addEventListener('blur', closeAll);
  window.addEventListener('resize', closeAll);
}

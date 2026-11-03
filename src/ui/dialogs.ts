// Small promise-based modal dialogs and toasts (no browser alert/confirm/prompt).

interface ButtonSpec<T> {
  label: string;
  value: T;
  primary?: boolean;
  danger?: boolean;
}

function modalRoot(): HTMLElement {
  return document.getElementById('modal-root')!;
}

function openModal<T>(opts: {
  title: string;
  body: HTMLElement | string;
  buttons: ButtonSpec<T>[];
  cancelValue: T;
  onOpen?: (dialog: HTMLElement) => void;
  /** Called on Enter / primary button; may return a different value (e.g. input contents). */
  resolvePrimary?: () => T;
}): Promise<T> {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement as HTMLElement | null;
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const dialog = document.createElement('div');
    dialog.className = 'modal';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    const h = document.createElement('h2');
    h.textContent = opts.title;
    dialog.append(h);

    const body = document.createElement('div');
    body.className = 'modal-body';
    if (typeof opts.body === 'string') body.textContent = opts.body;
    else body.append(opts.body);
    dialog.append(body);

    const footer = document.createElement('div');
    footer.className = 'modal-buttons';
    dialog.append(footer);

    const close = (value: T) => {
      document.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      prevFocus?.focus?.();
      resolve(value);
    };

    for (const b of opts.buttons) {
      const btn = document.createElement('button');
      btn.textContent = b.label;
      if (b.primary) btn.classList.add('primary');
      if (b.danger) btn.classList.add('danger');
      btn.addEventListener('click', () =>
        close(b.primary && opts.resolvePrimary ? opts.resolvePrimary() : b.value),
      );
      footer.append(btn);
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close(opts.cancelValue);
      } else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
        const primary = opts.buttons.find((b) => b.primary);
        if (primary) {
          e.preventDefault();
          e.stopPropagation();
          close(opts.resolvePrimary ? opts.resolvePrimary() : primary.value);
        }
      } else if (e.key === 'Tab') {
        // Keep focus inside the dialog.
        const focusables = [...dialog.querySelectorAll<HTMLElement>('button, input, select')];
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    backdrop.addEventListener('mousedown', (e) => {
      if (e.target === backdrop) close(opts.cancelValue);
    });

    backdrop.append(dialog);
    modalRoot().append(backdrop);
    opts.onOpen?.(dialog);
    if (!dialog.contains(document.activeElement)) {
      (footer.querySelector('button.primary') as HTMLElement | null)?.focus();
    }
  });
}

export type SaveChoice = 'save' | 'discard' | 'cancel';

export function confirmSave(fileName: string): Promise<SaveChoice> {
  return openModal<SaveChoice>({
    title: 'Save changes?',
    body: `"${fileName}" has unsaved changes. Save them before closing?`,
    cancelValue: 'cancel',
    buttons: [
      { label: 'Save', value: 'save', primary: true },
      { label: "Don't Save", value: 'discard', danger: true },
      { label: 'Cancel', value: 'cancel' },
    ],
  });
}

export function confirmSaveMany(count: number): Promise<SaveChoice> {
  return openModal<SaveChoice>({
    title: 'Save changes?',
    body: `${count} files have unsaved changes. Save them all before closing?`,
    cancelValue: 'cancel',
    buttons: [
      { label: 'Save All', value: 'save', primary: true },
      { label: "Don't Save", value: 'discard', danger: true },
      { label: 'Cancel', value: 'cancel' },
    ],
  });
}

export function promptText(title: string, label: string, initial: string): Promise<string | null> {
  const wrap = document.createElement('label');
  wrap.className = 'field';
  const span = document.createElement('span');
  span.textContent = label;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = initial;
  input.spellcheck = false;
  wrap.append(span, input);
  return openModal<string | null>({
    title,
    body: wrap,
    cancelValue: null,
    buttons: [
      { label: 'OK', value: null, primary: true },
      { label: 'Cancel', value: null },
    ],
    resolvePrimary: () => input.value.trim() || null,
    onOpen: () => {
      input.focus();
      // Select the stem, not the extension (like a file manager rename).
      const dot = initial.lastIndexOf('.');
      input.setSelectionRange(0, dot > 0 ? dot : initial.length);
    },
  });
}

export interface PickOption {
  value: string;
  label: string;
  /** Extra text shown after the label (e.g. the file it comes from). */
  hint?: string;
}

/** Ask the user to choose one option from a filterable list. */
export function pickOne(title: string, options: PickOption[], okLabel = 'OK'): Promise<string | null> {
  const body = document.createElement('div');
  body.className = 'pick-one';
  const filter = document.createElement('input');
  filter.type = 'text';
  filter.placeholder = 'Type to filter';
  filter.spellcheck = false;
  filter.setAttribute('aria-label', 'Filter');
  const list = document.createElement('select');
  list.size = Math.min(12, Math.max(4, options.length));
  list.setAttribute('aria-label', title);
  const fill = () => {
    const q = filter.value.trim().toLowerCase();
    list.replaceChildren(
      ...options
        .filter((o) => !q || `${o.label} ${o.hint ?? ''}`.toLowerCase().includes(q))
        .map((o) => {
          const opt = document.createElement('option');
          opt.value = o.value;
          opt.textContent = o.hint ? `${o.label}  —  ${o.hint}` : o.label;
          return opt;
        }),
    );
    list.selectedIndex = list.options.length ? 0 : -1;
  };
  filter.addEventListener('input', fill);
  filter.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = list.options.length;
      if (n) list.selectedIndex = (list.selectedIndex + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
    }
  });
  fill();
  body.append(filter, list);
  return openModal<string | null>({
    title,
    body,
    cancelValue: null,
    buttons: [
      { label: okLabel, value: null, primary: true },
      { label: 'Cancel', value: null },
    ],
    resolvePrimary: () => list.value || null,
    onOpen: (dialog) => {
      filter.focus();
      list.addEventListener('dblclick', () => {
        (dialog.querySelector('button.primary') as HTMLButtonElement | null)?.click();
      });
    },
  });
}

/** Ask the user for two files to compare. */
export function pickTwo(options: PickOption[], left?: string, right?: string): Promise<[string, string] | null> {
  const body = document.createElement('div');
  body.className = 'pick-two';
  const mk = (labelText: string, initial?: string) => {
    const wrap = document.createElement('label');
    wrap.className = 'field';
    const span = document.createElement('span');
    span.textContent = labelText;
    const sel = document.createElement('select');
    for (const o of options) {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      sel.append(opt);
    }
    if (initial) sel.value = initial;
    wrap.append(span, sel);
    body.append(wrap);
    return sel;
  };
  const a = mk('Left (original)', left ?? options[0]?.value);
  const b = mk('Right (modified)', right ?? options[1]?.value);
  return openModal<[string, string] | null>({
    title: 'Compare files',
    body,
    cancelValue: null,
    buttons: [
      { label: 'Compare', value: null, primary: true },
      { label: 'Cancel', value: null },
    ],
    resolvePrimary: () => [a.value, b.value],
    onOpen: () => a.focus(),
  });
}

export function showInfo(title: string, body: HTMLElement | string): Promise<void> {
  return openModal<void>({
    title,
    body,
    cancelValue: undefined,
    buttons: [{ label: 'Close', value: undefined, primary: true }],
  });
}

export function toast(
  message: string,
  kind: 'info' | 'error' = 'info',
  action?: { label: string; run: () => void; sticky?: boolean },
): void {
  const root = document.getElementById('toast-root')!;
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  el.textContent = message;
  const dismiss = () => {
    el.classList.add('leaving');
    window.setTimeout(() => el.remove(), 300);
  };
  if (action) {
    const btn = document.createElement('button');
    btn.className = 'toast-action';
    btn.textContent = action.label;
    btn.addEventListener('click', () => {
      dismiss();
      action.run();
    });
    el.append(btn);
  }
  root.append(el);
  if (!action?.sticky) window.setTimeout(dismiss, action ? 8000 : 3500);
}

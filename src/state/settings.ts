// User preferences, persisted to localStorage (a per-browser convenience).

export type ThemeMode = 'system' | 'light' | 'dark';

export interface Settings {
  mode: ThemeMode;
  scheme: string;
  fontSize: number;
  wordWrap: boolean;
  renderWhitespace: boolean;
  minimap: boolean;
  lineNumbers: boolean;
  diffInline: boolean;
  diffIgnoreWhitespace: boolean;
  /** Realign `=`, `<=`, `=>`… blocks in HDL files when Enter is pressed. */
  autoAlign: boolean;
  /** Indentation for new files and files whose indentation can't be detected. */
  defaultTabSize: number;
  defaultInsertSpaces: boolean;
  sidebarOpen: boolean;
  sidebarTab: SidebarTab;
  sidebarWidth: number;
  /** Width of the left view as a fraction of the workspace, when split. */
  splitRatio: number;
  /** Show a rendered preview beside markdown tabs. */
  markdownPreview: boolean;
  /** Width of the editor beside the markdown preview, as a fraction of the view. */
  previewRatio: number;
}

export type SidebarTab = 'outline' | 'search';

export const DEFAULT_SETTINGS: Settings = {
  mode: 'system',
  scheme: 'default',
  fontSize: 14,
  wordWrap: false,
  renderWhitespace: false,
  minimap: true,
  lineNumbers: true,
  diffInline: false,
  diffIgnoreWhitespace: false,
  autoAlign: false,
  defaultTabSize: 4,
  defaultInsertSpaces: true,
  sidebarOpen: false,
  sidebarTab: 'outline',
  sidebarWidth: 300,
  splitRatio: 0.5,
  markdownPreview: false,
  previewRatio: 0.5,
};

const KEY = 'syntax.settings.v1';
type Listener = (s: Settings) => void;

class SettingsStore {
  private value: Settings;
  private listeners = new Set<Listener>();

  constructor() {
    let stored: Partial<Settings> = {};
    try {
      stored = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    } catch {
      /* storage unavailable or corrupt: use defaults */
    }
    this.value = { ...DEFAULT_SETTINGS, ...stored };
  }

  get(): Settings {
    return this.value;
  }

  update(patch: Partial<Settings>): void {
    this.value = { ...this.value, ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(this.value));
    } catch {
      /* ignore */
    }
    for (const l of this.listeners) l(this.value);
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}

export const settings = new SettingsStore();

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

export function resolvedMode(s: Settings = settings.get()): 'light' | 'dark' {
  if (s.mode === 'system') return darkQuery.matches ? 'dark' : 'light';
  return s.mode;
}

export function onSystemModeChange(cb: () => void): void {
  darkQuery.addEventListener('change', cb);
}

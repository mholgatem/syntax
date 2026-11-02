import { monaco } from '../editor/monacoSetup';
import { cssVars, getScheme, monacoThemeName } from '../editor/themes';
import { onSystemModeChange, resolvedMode, settings } from '../state/settings';

/** Apply the current scheme + light/dark mode to Monaco and the app chrome. */
export function applyTheme(): void {
  const s = settings.get();
  const mode = resolvedMode(s);
  const scheme = getScheme(s.scheme);
  const palette = scheme[mode];
  monaco.editor.setTheme(monacoThemeName(scheme.id, mode));
  const root = document.documentElement;
  for (const [k, v] of Object.entries(cssVars(palette))) root.style.setProperty(k, v);
  root.dataset.theme = mode;
  root.style.colorScheme = mode;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', palette.chromeBg);
}

export function initTheme(): void {
  applyTheme();
  settings.subscribe(applyTheme);
  onSystemModeChange(applyTheme);
}

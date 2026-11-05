import { monaco } from '../editor/monacoSetup';
import { cssVars, getScheme, monacoThemeName, schemeMode } from '../editor/themes';
import { onSystemModeChange, resolvedMode, settings } from '../state/settings';

/** Apply the current scheme + light/dark mode to Monaco and the app chrome. */
export function applyTheme(): void {
  const s = settings.get();
  const scheme = getScheme(s.scheme);
  const mode = schemeMode(scheme, resolvedMode(s));
  const palette = scheme[mode];
  monaco.editor.setTheme(monacoThemeName(scheme.id, mode));
  const root = document.documentElement;
  root.style.removeProperty('--module-name'); // only some schemes set it
  for (const [k, v] of Object.entries(cssVars(palette))) root.style.setProperty(k, v);
  root.dataset.theme = mode;
  root.dataset.scheme = scheme.id;
  root.toggleAttribute('data-crt', !!scheme.effects?.crt);
  root.toggleAttribute('data-module-names', !!palette.moduleName);
  root.style.colorScheme = mode;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', palette.chromeBg);
}

export function initTheme(): void {
  applyTheme();
  settings.subscribe(applyTheme);
  onSystemModeChange(applyTheme);
}

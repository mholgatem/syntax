import { settings } from '../state/settings';
import { downloadBlob } from '../io/saveFiles';
import {
  FIX_SCRIPT_NAME,
  UNDO_SCRIPT_NAME,
  buildIco,
  fixIconsScript,
  renderIconPngs,
  toBase64,
  undoIconsScript,
} from '../io/iconFix';
import { showInfo, showSplash, toast } from './dialogs';

// The welcome splash shown the first time Syntax runs as an installed app on Windows,
// explaining the blank file-type icons, and the Settings commands that download the
// fix / undo scripts (see io/iconFix.ts).

const asset = (path: string) => `${import.meta.env.BASE_URL}${path}`;

interface NavigatorUAData {
  platform?: string;
}

export function isWindows(): boolean {
  const uaData = (navigator as Navigator & { userAgentData?: NavigatorUAData }).userAgentData;
  return uaData?.platform ? uaData.platform === 'Windows' : /Windows/i.test(navigator.userAgent);
}

export function isInstalledApp(): boolean {
  return ['standalone', 'window-controls-overlay'].some((m) => window.matchMedia(`(display-mode: ${m})`).matches);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text) e.textContent = text;
  if (className) e.className = className;
  return e;
}

/** Build a script, download it, and show how to run it. */
export async function downloadIconScript(kind: 'fix' | 'undo'): Promise<void> {
  let text: string;
  try {
    text = kind === 'fix' ? fixIconsScript(toBase64(buildIco(await renderIconPngs(asset('icons/icon-512.png'))))) : undoIconsScript();
  } catch (err) {
    toast(`Could not create the script: ${String(err)}`, 'error');
    return;
  }
  const name = kind === 'fix' ? FIX_SCRIPT_NAME : UNDO_SCRIPT_NAME;
  downloadBlob(name, new TextEncoder().encode(text), 'text/plain');

  const body = el('div', undefined, 'script-steps');
  body.append(
    el('p', kind === 'fix' ? 'The script that gives your files the Syntax icon is downloading.' : 'The script that restores the original file icons is downloading.'),
  );
  const ol = el('ol');
  const step1 = el('li', 'Open your ');
  step1.append(el('strong', 'Downloads'), document.createTextNode(' folder. If your browser asks whether to keep the file, choose '), el('strong', 'Keep'), document.createTextNode('.'));
  const step2 = el('li', 'Right-click ');
  step2.append(el('code', name), document.createTextNode(' and choose '), el('strong', 'Run with PowerShell'), document.createTextNode('. On Windows 11 it may be under '), el('em', 'Show more options'), document.createTextNode('.'));
  const step3 = el('li', kind === 'fix' ? 'A window lists the file types it updated. Icons refresh right away; if some still look blank, sign out and back in.' : 'A window lists what it restored, then you can close it.');
  ol.append(step1, step2, step3);
  body.append(ol);
  body.append(
    el(
      'p',
      kind === 'fix'
        ? 'It only changes your own Windows user settings and needs no admin rights. Reinstalling Syntax can reset the icons; just run the script again. To undo it, use Settings → Undo-icons script.'
        : 'It only changes your own Windows user settings and needs no admin rights.',
      'muted',
    ),
  );
  await showInfo(kind === 'fix' ? 'Fix file icons' : 'Undo file icon fix', body);
}

/** Show the welcome splash once, the first time Syntax runs as an installed app on Windows. */
export async function maybeShowIconNotice(): Promise<void> {
  if (settings.get().iconNoticeSeen || !isWindows() || !isInstalledApp()) return;
  const body = el('div');
  body.append(
    el('p', 'Syntax is installed and can open files straight from File Explorer.'),
    el(
      'p',
      'One catch: installed web apps can’t give their file types an icon in Windows, so files that open with Syntax show a blank page icon. This is a browser limitation and doesn’t affect opening, editing or saving.',
    ),
    el('p', 'If you’d like the Syntax icon on those files, download the fix-icons script. You can undo it at any time.'),
    el('p', 'Both scripts are also under Settings.', 'muted'),
  );
  const choice = await showSplash({
    title: 'Welcome to Syntax',
    banner: asset('images/Syntax-Neon-Splash.png'),
    body,
    cancelValue: 'close' as const,
    buttons: [
      { label: 'Got it', value: 'close' as const },
      { label: 'Get Fix-icons script', value: 'fix' as const, primary: true },
    ],
  });
  settings.update({ iconNoticeSeen: true });
  if (choice === 'fix') await downloadIconScript('fix');
}

import { settings } from '../state/settings';
import { downloadBlob } from '../io/saveFiles';
import { FIX_SCRIPT_NAME, ZIP_NAME, buildIco, buildIconScriptsZip, renderIconPngs, toBase64 } from '../io/iconFix';
import { showInfo, showSplash, toast } from './dialogs';

// The welcome splash shown when Syntax starts as an installed app on Windows, explaining
// the blank file-type icons, and the download of the fix / undo scripts (see io/iconFix.ts).

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

type Part = string | Node;

/** An element whose children are text and nodes, e.g. rich('p', 'Press ', strong('OK')). */
function rich<K extends keyof HTMLElementTagNameMap>(tag: K, ...parts: Part[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.append(...parts);
  return e;
}
const strong = (t: string) => rich('strong', t);
const em = (t: string) => rich('em', t);
const code = (t: string) => rich('code', t);
function withClass<T extends HTMLElement>(e: T, className: string): T {
  e.className = className;
  return e;
}

/** Generate the zip (both scripts + instructions), download it, and show how to use it. */
export async function downloadIconScripts(): Promise<void> {
  let zip: Uint8Array;
  try {
    zip = buildIconScriptsZip(toBase64(buildIco(await renderIconPngs(asset('icons/icon-512.png')))));
  } catch (err) {
    toast(`Could not create the scripts: ${String(err)}`, 'error');
    return;
  }
  downloadBlob(ZIP_NAME, zip, 'application/zip');

  const body = withClass(rich('div'), 'script-steps');
  body.append(
    rich(
      'p',
      'The fix-icons and undo-icons scripts are downloading as ',
      code(ZIP_NAME),
      ', along with instructions. If your browser asks whether to keep it, choose ',
      strong('Keep'),
      '.',
    ),
  );

  // Windows blocks downloaded scripts until they're unblocked, so lead with that. Unblocking
  // the zip before extracting it unblocks both scripts at once.
  const warn = withClass(rich('div'), 'unblock-warning');
  warn.setAttribute('role', 'alert');
  warn.append(
    withClass(rich('p', withClass(rich('span'), 'codicon codicon-warning'), ' You must UNBLOCK this zip before extracting it.'), 'unblock-title'),
    rich(
      'ol',
      rich('li', 'Navigate to ', code(ZIP_NAME), ' (', strong('Ctrl+J'), ', then ', strong('Show in folder'), ').'),
      rich('li', 'Right-click it and choose ', strong('Properties'), '.'),
      rich('li', 'On the ', strong('General'), ' tab, at the bottom next to ', em('Security'), ', tick ', strong('Unblock'), ', then click ', strong('OK'), '.'),
    ),
  );
  body.append(warn);

  body.append(
    withClass(rich('p', 'Then run it:'), 'then'),
    rich(
      'ol',
      rich('li', 'Right-click the zip and choose ', strong('Extract All'), '.'),
      rich(
        'li',
        'In the extracted folder, right-click ',
        code(FIX_SCRIPT_NAME),
        ' and choose ',
        strong('Run with PowerShell'),
        '. On Windows 11 it may be under ',
        em('Show more options'),
        '.',
      ),
      rich('li', 'A window lists the file types it updated. Icons refresh right away; if some still look blank, sign out and back in.'),
    ),
    rich('p', 'The instructions in the zip also explain how to preview the changes first with a dry run.'),
    withClass(
      rich(
        'p',
        'This script only changes the current Windows user settings. No admin rights are required. Reinstalling Syntax may reset the icons; just run the script again. To undo it, run the undo-icons script.',
      ),
      'muted',
    ),
  );
  await showInfo('Fix icons', body);
}

/** Show the welcome splash at startup when running as an installed app on Windows. */
export async function maybeShowIconNotice(): Promise<void> {
  if (!settings.get().welcomeSplash || !isWindows() || !isInstalledApp()) return;
  const body = rich(
    'div',
    rich('p', 'Now that Syntax is installed, you can open code files straight from File Explorer.'),
    rich(
      'p',
      rich('strong', em('One catch:')),
      ' Due to browser limitations, web apps can’t assign a custom icon to associated filetypes, so files that open with Syntax will show a blank page icon.',
    ),
    rich(
      'p',
      'If you’d like the Syntax icon on those files, we can generate a script for you. You can undo it at anytime with the companion undo-icons script. ',
      em('As always, use caution when running unknown scripts.'),
    ),
    withClass(rich('p', 'If you’d like to handle this later, both scripts can be generated from the Settings menu.'), 'muted'),
  );

  const dontShow = document.createElement('input');
  dontShow.type = 'checkbox';
  const checkLabel = withClass(rich('label', dontShow, ' Don’t show this splash at startup'), 'splash-check');

  const choice = await showSplash({
    title: 'Welcome to Syntax',
    banner: asset('images/Syntax-Neon-Splash.png'),
    body,
    footerExtra: checkLabel,
    cancelValue: 'close' as const,
    buttons: [
      { label: 'Got it', value: 'close' as const },
      { label: 'Generate scripts', value: 'generate' as const, primary: true },
    ],
  });
  if (dontShow.checked) settings.update({ welcomeSplash: false });
  if (choice === 'generate') await downloadIconScripts();
}

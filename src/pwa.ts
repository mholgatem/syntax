import { toast } from './ui/dialogs';
import { openIncoming } from './io/openFiles';

// Installable-app support: service worker registration and update prompt, the browser's
// install prompt, and files sent from the OS "Open with" menu (File Handling API).

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
interface LaunchParams {
  files: FileSystemHandle[];
}
declare global {
  interface Window {
    launchQueue?: { setConsumer(consumer: (params: LaunchParams) => void): void };
  }
}

let installEvent: BeforeInstallPromptEvent | null = null;
const installListeners = new Set<() => void>();
const notify = () => installListeners.forEach((l) => l());

export const canInstall = (): boolean => !!installEvent;

export function onInstallAvailabilityChange(l: () => void): void {
  installListeners.add(l);
}

export async function promptInstall(): Promise<void> {
  const e = installEvent;
  if (!e) return;
  installEvent = null;
  notify();
  await e.prompt();
}

/** Open files the OS handed to the installed app. */
function initLaunchQueue(): void {
  window.launchQueue?.setConsumer(async (params) => {
    const handles = (params.files ?? []).filter((h): h is FileSystemFileHandle => h.kind === 'file');
    if (!handles.length) return;
    try {
      const items = await Promise.all(handles.map(async (handle) => ({ file: await handle.getFile(), handle })));
      await openIncoming(items);
    } catch (err) {
      toast(`Could not open the file: ${String(err)}`, 'error');
    }
  });
}

function registerServiceWorker(): void {
  const base = import.meta.env.BASE_URL;
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Only after the user accepted an update (the first install doesn't take over the page).
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker
    .register(`${base}sw.js`, { scope: base })
    .then((reg) => {
      const offer = (worker: ServiceWorker) =>
        toast('A new version of Syntax is available.', 'info', {
          label: 'Reload',
          sticky: true,
          run: () => worker.postMessage({ type: 'SKIP_WAITING' }),
        });
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) offer(worker);
        });
      });
      window.setInterval(() => void reg.update().catch(() => undefined), 60 * 60 * 1000);
    })
    .catch((err) => console.warn('Service worker registration failed', err));
}

export function initPwa(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvent = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    installEvent = null;
    notify();
    toast('Syntax is installed. You can open source files with it from your file manager.');
  });
  initLaunchQueue();
  if (import.meta.env.PROD && 'serviceWorker' in navigator) registerServiceWorker();
}

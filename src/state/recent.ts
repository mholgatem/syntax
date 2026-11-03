import { get, set } from 'idb-keyval';

// Recently closed files (File > Recent Files). Only files with a File System Access
// handle can be reopened, so this is a Chrome / Edge feature. Stored in IndexedDB.

export interface RecentEntry {
  name: string;
  handle: FileSystemFileHandle;
  closedAt: number;
}

type SameEntry = (a: FileSystemFileHandle, b: FileSystemFileHandle) => Promise<boolean>;

export const MAX_RECENT = 15;
const KEY = 'syntax.recent.v1';

/** Put `entry` first, dropping older entries for the same file, keeping at most `max`. */
export async function withEntry(list: RecentEntry[], entry: RecentEntry, same: SameEntry, max = MAX_RECENT): Promise<RecentEntry[]> {
  const out = [entry];
  for (const e of list) {
    if (out.length >= max) break;
    if (!(await same(e.handle, entry.handle))) out.push(e);
  }
  return out;
}

export async function withoutHandle(list: RecentEntry[], handle: FileSystemFileHandle, same: SameEntry): Promise<RecentEntry[]> {
  const out: RecentEntry[] = [];
  for (const e of list) if (!(await same(e.handle, handle))) out.push(e);
  return out;
}

const sameEntry: SameEntry = (a, b) => a.isSameEntry(b).catch(() => false);

let cache: RecentEntry[] = [];
let queue: Promise<unknown> = Promise.resolve();

/** Run list updates one at a time so concurrent closes don't overwrite each other. */
function update(fn: (list: RecentEntry[]) => Promise<RecentEntry[]>): Promise<void> {
  const next = queue.then(async () => {
    cache = await fn(cache);
    try {
      await set(KEY, cache);
    } catch {
      /* storage unavailable: keep the in-memory list */
    }
  });
  queue = next.catch(() => undefined);
  return next;
}

export const recentSupported = (): boolean => typeof window !== 'undefined' && 'showOpenFilePicker' in window;

export async function loadRecent(): Promise<void> {
  try {
    const stored = await get<RecentEntry[]>(KEY);
    if (Array.isArray(stored)) cache = stored.filter((e) => e && e.handle && e.name);
  } catch {
    cache = [];
  }
}

export function recentFiles(): readonly RecentEntry[] {
  return cache;
}

export function rememberClosed(name: string, handle: FileSystemFileHandle): Promise<void> {
  return update((list) => withEntry(list, { name, handle, closedAt: Date.now() }, sameEntry));
}

export function forgetRecent(handle: FileSystemFileHandle): Promise<void> {
  return update((list) => withoutHandle(list, handle, sameEntry));
}

export function clearRecent(): Promise<void> {
  return update(async () => []);
}

import { store, type Doc } from '../state/documents';
import { decodeText, isProbablyBinary } from './text';
import { toast } from '../ui/dialogs';

const MAX_BYTES = 50 * 1024 * 1024;

interface Incoming {
  file: File;
  handle?: FileSystemFileHandle;
}

/** Open files as tabs. Re-opening a file that's already open just focuses its tab. */
export async function openIncoming(items: Incoming[]): Promise<Doc[]> {
  const opened: Doc[] = [];
  const skipped: string[] = [];
  for (const { file, handle } of items) {
    const existing = await findOpen(handle);
    if (existing) {
      opened.push(existing);
      continue;
    }
    if (file.size > MAX_BYTES) {
      skipped.push(`${file.name} (too large)`);
      continue;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (isProbablyBinary(bytes)) {
      skipped.push(`${file.name} (binary)`);
      continue;
    }
    const { text, encoding } = decodeText(bytes);
    opened.push(store.create({ name: file.name, text, encoding, handle }));
  }
  // Replace a lone, empty, untouched "new 1" tab, like Notepad++ does.
  if (opened.length > 0) {
    const blank = store.docs.find(
      (d) => d.untitled && d.model.getValueLength() === 0 && !store.isDirty(d) && !opened.includes(d),
    );
    if (blank && store.docs.length - 1 === opened.length) store.remove(blank.id);
    store.setActive(opened[opened.length - 1].id);
  }
  if (skipped.length) toast(`Skipped: ${skipped.join(', ')}`, 'error');
  return opened;
}

async function findOpen(handle?: FileSystemFileHandle): Promise<Doc | undefined> {
  if (!handle) return undefined;
  for (const d of store.docs) {
    if (d.handle && (await d.handle.isSameEntry(handle).catch(() => false))) return d;
  }
  return undefined;
}

/** Open dialog: uses the File System Access API when available so files can be saved in place. */
export async function pickAndOpen(fallbackInput: HTMLInputElement): Promise<void> {
  if ('showOpenFilePicker' in window) {
    let handles: FileSystemFileHandle[];
    try {
      handles = await window.showOpenFilePicker({ multiple: true });
    } catch (err) {
      if ((err as DOMException).name !== 'AbortError') toast(String(err), 'error');
      return;
    }
    const items = await Promise.all(handles.map(async (h) => ({ file: await h.getFile(), handle: h })));
    await openIncoming(items);
    return;
  }
  fallbackInput.value = '';
  fallbackInput.click();
}

export function handleInputChange(input: HTMLInputElement): Promise<Doc[]> {
  const files = [...(input.files ?? [])];
  return openIncoming(files.map((file) => ({ file })));
}

/**
 * Read dropped files and folders. All DataTransferItem accessors must be called
 * synchronously inside the drop event, before any await.
 */
export async function handleDrop(dt: DataTransfer): Promise<Doc[]> {
  const items = [...dt.items].filter((i) => i.kind === 'file');
  const pending: Promise<Incoming[]>[] = items.map((item) => {
    const handlePromise = item.getAsFileSystemHandle?.();
    const entry = item.webkitGetAsEntry?.();
    const file = item.getAsFile();
    if (handlePromise) {
      return handlePromise
        .then((h) => (h ? fromHandle(h) : file ? [{ file }] : []))
        .catch(() => (entry ? fromEntry(entry) : file ? [{ file }] : []));
    }
    if (entry) return fromEntry(entry);
    return Promise.resolve(file ? [{ file }] : []);
  });
  const all = (await Promise.all(pending)).flat();
  all.sort((a, b) => a.file.name.localeCompare(b.file.name, undefined, { numeric: true }));
  return openIncoming(all);
}

const SKIP_DIRS = new Set(['.git', 'node_modules', '.svn', '.hg', '__pycache__', '.venv', 'dist', 'build']);
const MAX_FILES = 500;

async function fromHandle(h: FileSystemHandle, out: Incoming[] = []): Promise<Incoming[]> {
  if (out.length >= MAX_FILES) return out;
  if (h.kind === 'file') {
    const fh = h as FileSystemFileHandle;
    out.push({ file: await fh.getFile(), handle: fh });
  } else if (!SKIP_DIRS.has(h.name)) {
    for await (const child of (h as FileSystemDirectoryHandle).values()) await fromHandle(child, out);
  }
  return out;
}

async function fromEntry(entry: FileSystemEntry, out: Incoming[] = []): Promise<Incoming[]> {
  if (out.length >= MAX_FILES) return out;
  if (entry.isFile) {
    const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
    out.push({ file });
  } else if (entry.isDirectory && !SKIP_DIRS.has(entry.name)) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries returns results in batches until it returns an empty array.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
      if (batch.length === 0) break;
      for (const child of batch) await fromEntry(child, out);
    }
  }
  return out;
}

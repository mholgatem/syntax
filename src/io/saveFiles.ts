import { store, type Doc } from '../state/documents';
import { encodeText } from './text';
import { buildZip } from './zip';
import { toast } from '../ui/dialogs';

const canPickSave = () => 'showSaveFilePicker' in window;

function docBytes(doc: Doc): Uint8Array {
  return encodeText(doc.model.getValue(), doc.encoding);
}

async function ensureWritable(handle: FileSystemFileHandle): Promise<boolean> {
  const opts = { mode: 'readwrite' as const };
  if ((await handle.queryPermission?.(opts)) === 'granted') return true;
  return (await handle.requestPermission?.(opts)) === 'granted';
}

async function writeHandle(handle: FileSystemFileHandle, bytes: Uint8Array): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(bytes as Uint8Array<ArrayBuffer>);
  await writable.close();
}

export function downloadBlob(name: string, data: Uint8Array, type = 'application/octet-stream'): void {
  const url = URL.createObjectURL(new Blob([data as Uint8Array<ArrayBuffer>], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Save a doc. Writes in place if we have a file handle; otherwise asks where to save
 * (or downloads, in browsers without the File System Access API).
 * Resolves true if the doc was saved, false if the user cancelled or it failed.
 */
export async function saveDoc(doc: Doc, opts: { saveAs?: boolean } = {}): Promise<boolean> {
  const bytes = docBytes(doc);
  try {
    if (doc.handle && !opts.saveAs) {
      if (await ensureWritable(doc.handle)) {
        await writeHandle(doc.handle, bytes);
        store.markSaved(doc);
        toast(`Saved ${doc.name}`);
        return true;
      }
      // Permission denied: fall through to Save As.
    }
    if (canPickSave()) {
      const handle = await window.showSaveFilePicker({ suggestedName: suggestedName(doc) });
      await writeHandle(handle, bytes);
      doc.handle = handle;
      if (handle.name !== doc.name) store.rename(doc, handle.name);
      store.markSaved(doc);
      toast(`Saved ${doc.name}`);
      return true;
    }
    downloadBlob(suggestedName(doc), bytes);
    store.markSaved(doc);
    return true;
  } catch (err) {
    if ((err as DOMException).name === 'AbortError') return false;
    console.error(err);
    toast(`Could not save ${doc.name}: ${(err as Error).message}`, 'error');
    return false;
  }
}

function suggestedName(doc: Doc): string {
  return doc.untitled && !doc.name.includes('.') ? `${doc.name}.txt` : doc.name;
}

/** Save every dirty doc. Resolves true only if all of them were saved. */
export async function saveAll(): Promise<boolean> {
  let ok = true;
  for (const doc of store.docs.filter((d) => store.isDirty(d))) {
    store.setActive(doc.id);
    ok = (await saveDoc(doc)) && ok;
  }
  return ok;
}

export function downloadAllZip(): void {
  if (store.docs.length === 0) {
    toast('No files are open', 'error');
    return;
  }
  const zip = buildZip(store.docs.map((d) => ({ name: suggestedName(d), data: docBytes(d) })));
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  downloadBlob(`syntax-files-${stamp}.zip`, zip, 'application/zip');
}

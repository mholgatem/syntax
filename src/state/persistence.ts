import { get, set } from 'idb-keyval';
import { store } from './documents';
import type { Encoding } from '../io/text';
import type { monaco } from '../editor/monacoSetup';

// Snapshots open tabs (including unsaved edits) to IndexedDB so a reload or crash
// doesn't lose work. Monaco can't serialize undo history, so that is not restored.

type ViewState = monaco.editor.ICodeEditorViewState | null;

interface StoredDoc {
  id: string;
  name: string;
  languageId: string;
  languageLocked: boolean;
  text: string;
  savedHash: string;
  encoding: Encoding;
  untitled: boolean;
  handle?: FileSystemFileHandle;
  viewState: ViewState;
}

interface Session {
  version: 1;
  docs: StoredDoc[];
  activeId: string | null;
}

const KEY = 'syntax.session.v1';

function snapshot(includeHandles: boolean, viewStateFor: (id: string) => ViewState): Session {
  return {
    version: 1,
    activeId: store.activeId,
    docs: store.docs.map((d) => ({
      id: d.id,
      name: d.name,
      languageId: d.model.getLanguageId(),
      languageLocked: d.languageLocked,
      text: d.model.getValue(),
      // An encoding-only change can't be detected from text, so force "dirty" on restore.
      savedHash: d.metaDirty ? '' : d.savedHash,
      encoding: d.encoding,
      untitled: d.untitled,
      handle: includeHandles ? d.handle : undefined,
      viewState: viewStateFor(d.id),
    })),
  };
}

/** Recreate tabs from the last session. Returns false if there was nothing to restore. */
export async function restoreSession(): Promise<boolean> {
  let session: Session | undefined;
  try {
    session = await get<Session>(KEY);
  } catch {
    return false;
  }
  if (!session || session.version !== 1 || session.docs.length === 0) return false;
  for (const s of session.docs) {
    store.create({
      id: s.id,
      name: s.name,
      text: s.text,
      languageId: s.languageId,
      languageLocked: s.languageLocked,
      encoding: s.encoding,
      untitled: s.untitled,
      handle: s.handle,
      savedHash: s.savedHash,
      viewState: s.viewState,
    });
  }
  const active = session.activeId && store.get(session.activeId) ? session.activeId : store.docs[0].id;
  store.setActive(active);
  return true;
}

/** Start debounced autosave. Returns a function that saves immediately. */
export function startAutosave(viewStateFor: (id: string) => ViewState): () => Promise<void> {
  let timer: number | undefined;
  let handlesCloneable = true;

  const flush = async () => {
    window.clearTimeout(timer);
    timer = undefined;
    try {
      await set(KEY, snapshot(handlesCloneable, viewStateFor));
    } catch (err) {
      if (!handlesCloneable) {
        console.warn('Session autosave failed', err);
        return;
      }
      // Some browsers can't store file handles in IndexedDB; retry without them.
      handlesCloneable = false;
      try {
        await set(KEY, snapshot(false, viewStateFor));
      } catch (err2) {
        console.warn('Session autosave failed', err2);
      }
    }
  };
  const schedule = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(flush, 800);
  };

  store.subscribe(schedule);
  store.onContent(schedule);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flush();
  });
  window.addEventListener('pagehide', () => void flush());
  return flush;
}

import { store } from '../state/documents';
import { languageLabel, sortedLanguages } from '../editor/languages';
import type { Encoding } from '../io/text';
import { focusedDoc, focusedEditor, getCompare, getEditor, onCompareChange, onDiffUpdated, diffChangeCount } from './editorView';
import { showContextMenu, type MenuItem } from './menuBar';

const ENCODINGS: Encoding[] = ['UTF-8', 'UTF-8 BOM', 'UTF-16 LE', 'UTF-16 BE'];

export function languageMenuItems(): MenuItem[] {
  const doc = focusedDoc();
  return sortedLanguages().map((l) => ({
    label: l.label,
    checked: () => doc?.model.getLanguageId() === l.id,
    disabled: () => !doc,
    action: () => doc && store.setLanguage(doc, l.id),
  }));
}

export function encodingMenuItems(): MenuItem[] {
  const doc = focusedDoc();
  return ENCODINGS.map((enc) => ({
    label: enc,
    checked: () => doc?.encoding === enc,
    disabled: () => !doc,
    action: () => doc && store.setEncoding(doc, enc),
  }));
}

export function eolMenuItems(): MenuItem[] {
  const doc = focusedDoc();
  return (['CRLF', 'LF'] as const).map((eol) => ({
    label: eol === 'CRLF' ? 'Windows (CR LF)' : 'Unix / macOS (LF)',
    checked: () => !!doc && store.getEol(doc) === eol,
    disabled: () => !doc,
    action: () => doc && store.setEol(doc, eol),
  }));
}

export function initStatusBar(root: HTMLElement): void {
  const cell = (cls: string, clickable = false) => {
    const el = document.createElement(clickable ? 'button' : 'span');
    el.className = `status-cell ${cls}`;
    root.append(el);
    return el;
  };
  const lang = cell('status-lang', true);
  const spacer = cell('status-spacer');
  const diff = cell('status-diff');
  const length = cell('status-length');
  const pos = cell('status-pos', true);
  const eol = cell('status-eol', true);
  const enc = cell('status-enc', true);
  const ins = cell('status-ins');
  ins.textContent = 'INS';
  spacer.textContent = '';

  lang.title = 'Change language mode';
  pos.title = 'Go to line (Ctrl+G)';
  eol.title = 'Change line endings';
  enc.title = 'Change encoding used when saving';

  const popupAbove = (el: HTMLElement, items: MenuItem[]) => {
    const r = el.getBoundingClientRect();
    showContextMenu(r.left, r.top - 4 - Math.min(items.length * 26, window.innerHeight * 0.6), items);
  };
  lang.addEventListener('click', () => popupAbove(lang, languageMenuItems()));
  eol.addEventListener('click', () => popupAbove(eol, eolMenuItems()));
  enc.addEventListener('click', () => popupAbove(enc, encodingMenuItems()));
  pos.addEventListener('click', () => {
    const ed = focusedEditor();
    ed.focus();
    ed.trigger('status', 'editor.action.gotoLine', null);
  });

  const update = () => {
    const doc = focusedDoc();
    const ed = focusedEditor();
    root.classList.toggle('empty', !doc);
    if (!doc) {
      for (const c of [lang, length, pos, eol, enc]) c.textContent = '';
      diff.textContent = '';
      return;
    }
    const model = doc.model;
    lang.textContent = languageLabel(model.getLanguageId());
    length.textContent = `length: ${model.getValueLength().toLocaleString()}    lines: ${model.getLineCount().toLocaleString()}`;
    const sel = ed.getSelection();
    const p = ed.getPosition();
    let selText = '';
    if (sel && !sel.isEmpty()) {
      const chars = model.getValueInRange(sel).length;
      const lines = sel.endLineNumber - sel.startLineNumber + 1;
      selText = `    Sel: ${chars.toLocaleString()} | ${lines.toLocaleString()}`;
    }
    pos.textContent = p ? `Ln: ${p.lineNumber}    Col: ${p.column}${selText}` : '';
    eol.textContent = store.getEol(doc) === 'CRLF' ? 'Windows (CR LF)' : 'Unix (LF)';
    enc.textContent = doc.encoding;
    if (getCompare()) {
      const n = diffChangeCount();
      diff.textContent = n === 0 ? 'Files are identical' : `${n} difference${n === 1 ? '' : 's'}`;
    } else diff.textContent = '';
  };

  let raf = 0;
  const schedule = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(update);
  };

  const editor = getEditor();
  editor.onDidChangeCursorSelection(schedule);
  editor.onDidChangeModel(schedule);
  editor.onDidFocusEditorText(schedule);
  store.subscribe(schedule);
  store.onContent(schedule);
  onCompareChange(schedule);
  onDiffUpdated(schedule);
  // Diff editor sides report focus/selection via the document.
  document.addEventListener('selectionchange', schedule);
  document.addEventListener('focusin', schedule);
  document.addEventListener('keyup', schedule);
  document.addEventListener('mouseup', schedule);
  update();
}

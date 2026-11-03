import { monaco } from './monacoSetup';

// Improves the syntax-colored HTML that Monaco puts on the clipboard (used when pasting
// into Google Docs, Word, email, ...):
//  1. Tokenizes the copied lines first. Monaco tokenizes lazily in the background, and
//     untokenized lines would otherwise be copied without colors.
//  2. Adds bracket pair colors. Those are editor decorations rather than tokens, so
//     Monaco's HTML leaves brackets in the default text color.
// Both rely on Monaco internals, feature-detected, so a failure just falls back to
// Monaco's own output.

interface BracketInfo {
  range: monaco.IRange;
  nestingLevel: number;
  nestingLevelOfEqualBracketType: number;
  isInvalid: boolean;
}

interface ModelInternals {
  tokenization?: { forceTokenization?: (line: number) => void };
  bracketPairs?: {
    getBracketsInRange?: (range: monaco.IRange, onlyColorized?: boolean) => { toArray(): BracketInfo[] };
  };
}

const MAX_LINES = 200_000;

/** Synchronously tokenize a model up to `lineNumber`. */
function forceTokenization(model: monaco.editor.ITextModel, lineNumber: number): void {
  if (lineNumber < 1 || lineNumber > MAX_LINES) return;
  (model as unknown as ModelInternals).tokenization?.forceTokenization?.(Math.min(lineNumber, model.getLineCount()));
}

/** The range Monaco copies: the selection, or the whole line for an empty selection. */
function copiedRange(ed: monaco.editor.ICodeEditor, model: monaco.editor.ITextModel): monaco.Range | null {
  const selections = ed.getSelections() ?? [];
  if (selections.length !== 1) return null; // Monaco doesn't produce HTML for multi-cursor copies
  const sel = selections[0];
  if (!sel.isEmpty()) return sel;
  if (!ed.getOption(monaco.editor.EditorOption.emptySelectionClipboard)) return null;
  const line = sel.startLineNumber;
  return new monaco.Range(line, 1, line, model.getLineMaxColumn(line));
}

function cssColorToHex(color: string): string {
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return color;
  return '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('');
}

/** Map of line number -> (0-based column -> CSS color) for each colorized bracket in range. */
function bracketColors(
  ed: monaco.editor.ICodeEditor,
  model: monaco.editor.ITextModel,
  range: monaco.Range,
): Map<number, Map<number, string>> {
  const result = new Map<number, Map<number, string>>();
  const opts = ed.getOption(monaco.editor.EditorOption.bracketPairColorization);
  if (!opts.enabled) return result;
  const brackets = (model as unknown as ModelInternals).bracketPairs?.getBracketsInRange?.(range, true)?.toArray();
  if (!brackets?.length) return result;

  // Read the theme's colors from the same CSS classes the editor renders with.
  const host = ed.getDomNode();
  if (!host) return result;
  const probe = document.createElement('span');
  probe.style.display = 'none';
  host.append(probe);
  const colorCache = new Map<string, string>();
  const colorFor = (className: string) => {
    let c = colorCache.get(className);
    if (c === undefined) {
      probe.className = className;
      c = cssColorToHex(getComputedStyle(probe).color);
      colorCache.set(className, c);
    }
    return c;
  };
  try {
    for (const b of brackets) {
      const level = opts.independentColorPoolPerBracketType ? b.nestingLevelOfEqualBracketType : b.nestingLevel;
      const color = colorFor(b.isInvalid ? 'unexpected-closing-bracket' : `bracket-highlighting-${level % 30}`);
      const line = b.range.startLineNumber;
      let cols = result.get(line);
      if (!cols) result.set(line, (cols = new Map()));
      for (let col = b.range.startColumn; col < b.range.endColumn; col++) cols.set(col - 1, color);
    }
  } finally {
    probe.remove();
  }
  return result;
}

const isBlank = (ch: string) => /[\s ​]/.test(ch);

/**
 * Recolor bracket characters in Monaco's clipboard HTML. The HTML has one child per copied
 * line (a <div> of styled <span>s, or <br> for an empty line). Tabs are expanded to spaces
 * in the HTML, so characters are matched to model columns by skipping whitespace on both sides.
 */
function addBracketColors(
  html: string,
  lineText: (lineNumber: number) => string,
  range: monaco.Range,
  colors: Map<number, Map<number, string>>,
): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const root = doc.body.firstElementChild;
  if (!root) return html;
  const lines = [...root.children];
  lines.forEach((lineEl, i) => {
    const lineNumber = range.startLineNumber + i;
    const cols = colors.get(lineNumber);
    if (!cols || lineEl.tagName !== 'DIV') return;
    const text = lineText(lineNumber);
    let offset = i === 0 ? range.startColumn - 1 : 0;

    for (const span of [...lineEl.querySelectorAll(':scope > span')] as HTMLElement[]) {
      const content = span.textContent ?? '';
      // Split this span into runs of characters that share a color.
      const runs: { text: string; color: string | null }[] = [];
      for (const ch of content) {
        let color: string | null = null;
        if (!isBlank(ch)) {
          while (offset < text.length && isBlank(text[offset])) offset++;
          color = cols.get(offset) ?? null;
          offset += ch.length; // surrogate pairs are two UTF-16 units
        }
        const last = runs[runs.length - 1];
        if (last && last.color === color) last.text += ch;
        else runs.push({ text: ch, color });
      }
      if (!runs.some((r) => r.color)) continue;
      const replacement = runs.map((r) => {
        const s = span.cloneNode(false) as HTMLElement;
        if (r.color) s.style.color = r.color;
        s.textContent = r.text;
        return s;
      });
      span.replaceWith(...replacement);
    }
  });
  return root.outerHTML;
}

/**
 * Install document-level copy/cut hooks. `getEditor` returns the editor that currently has
 * focus (the main editor or a side of the diff editor).
 */
export function installRichCopy(getEditor: () => monaco.editor.ICodeEditor): void {
  const onCopy = (e: ClipboardEvent) => {
    const ed = getEditor();
    const model = ed.getModel();
    if (!model || !e.clipboardData || !(ed.hasTextFocus() || ed.hasWidgetFocus())) return;
    const range = copiedRange(ed, model);
    if (!range || range.endLineNumber > MAX_LINES) return;

    try {
      forceTokenization(model, range.endLineNumber);
    } catch (err) {
      console.warn('Could not tokenize before copy', err);
    }

    let colors: Map<number, Map<number, string>>;
    try {
      colors = bracketColors(ed, model, range);
    } catch (err) {
      console.warn('Could not read bracket colors', err);
      return;
    }
    if (colors.size === 0) return;
    // Snapshot the copied lines now: on cut, the text is removed right after copying.
    const snapshot = new Map<number, string>();
    for (let n = range.startLineNumber; n <= range.endLineNumber; n++) {
      if (colors.has(n)) snapshot.set(n, model.getLineContent(n));
    }

    // Monaco writes the clipboard in its own handler, which runs after this capture-phase
    // listener. Wrap setData for this event so its HTML gets the bracket colors added.
    const data = e.clipboardData;
    const original = data.setData.bind(data);
    data.setData = (format: string, value: string) => {
      if (format === 'text/html') {
        try {
          value = addBracketColors(value, (n) => snapshot.get(n) ?? '', range, colors);
        } catch (err) {
          console.warn('Could not add bracket colors to copied HTML', err);
        }
      }
      original(format, value);
    };
  };
  document.addEventListener('copy', onCopy, true);
  document.addEventListener('cut', onCopy, true);
}

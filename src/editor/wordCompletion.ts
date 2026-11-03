import { monaco } from './monacoSetup';

// Word completion that ignores comments. Monaco's built-in word-based suggestions scan the
// raw text in a worker, so words that only appear in comments get suggested too. This
// replacement reads the syntax tokens the editor already computed for highlighting and
// skips comment tokens. (Editors must set `wordBasedSuggestions: 'off'`.)

interface LineTokensInternal {
  getCount(): number;
  getEndOffset(i: number): number;
  getStandardTokenType(i: number): number; // 1 = comment
}
interface ModelInternals {
  tokenization?: { getLineTokens?: (line: number) => LineTokensInternal };
}

const COMMENT = 1;
const MAX_LINES = 50_000;
const MAX_WORDS = 5_000;
// Same separators as Monaco's default word definition.
const WORD_RE = /[^\s`~!@#$%^&*()\-=+[{\]}\\|;:'",.<>/?]+/g;

/** The text of a line with comment tokens blanked out, or the whole line if tokens are unavailable. */
function codeText(model: monaco.editor.ITextModel, line: number): string {
  const text = model.getLineContent(line);
  const tokens = (model as unknown as ModelInternals).tokenization?.getLineTokens?.(line);
  if (!tokens) return text;
  let out = '';
  let start = 0;
  for (let i = 0, n = tokens.getCount(); i < n; i++) {
    const end = tokens.getEndOffset(i);
    out += tokens.getStandardTokenType(i) === COMMENT ? ' ' : text.slice(start, end);
    start = end;
  }
  return out;
}

export function registerWordCompletion(): void {
  monaco.languages.registerCompletionItemProvider('*', {
    provideCompletionItems(model, position) {
      if (model.getLineCount() > MAX_LINES) return { suggestions: [] };
      const current = model.getWordAtPosition(position);
      const replace = current
        ? new monaco.Range(position.lineNumber, current.startColumn, position.lineNumber, current.endColumn)
        : monaco.Range.fromPositions(position);
      const insert = replace.setEndPosition(position.lineNumber, position.column);

      const words = new Set<string>();
      for (let line = 1; line <= model.getLineCount() && words.size < MAX_WORDS; line++) {
        for (const [w] of codeText(model, line).matchAll(WORD_RE)) {
          if (!/^\d/.test(w)) words.add(w);
        }
      }
      words.delete(current?.word ?? ''); // don't suggest the word being typed

      return {
        suggestions: [...words].map((w) => ({
          kind: monaco.languages.CompletionItemKind.Text,
          label: w,
          insertText: w,
          range: { insert, replace },
        })),
      };
    },
  });
}

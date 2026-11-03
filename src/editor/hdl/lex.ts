// Tiny HDL lexer shared by the outline parser and the aligner. Pure (no Monaco), so it
// can be unit tested in Node.

export type HdlLang = 'verilog' | 'vhdl';

/** Map a Monaco language id to the HDL family it belongs to, or null for other languages. */
export function hdlLang(languageId: string): HdlLang | null {
  if (languageId === 'verilog' || languageId === 'systemverilog') return 'verilog';
  if (languageId === 'vhdl') return 'vhdl';
  return null;
}

// Verilog compiler directives whose whole line (with `\` continuations for `define) is not code.
const LINE_DIRECTIVES = new Set([
  'define', 'undef', 'undefineall', 'include', 'timescale', 'ifdef', 'ifndef', 'elsif', 'else', 'endif',
  'default_nettype', 'celldefine', 'endcelldefine', 'resetall', 'line', 'pragma', 'begin_keywords',
  'end_keywords', 'unconnected_drive', 'nounconnected_drive',
]);

/**
 * Return `text` with comments, strings and (for Verilog) compiler-directive lines replaced by
 * spaces. Newlines and the overall length are kept, so offsets still match the original.
 */
export function stripCode(text: string, lang: HdlLang): string {
  const out = text.split('');
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' ';
  };
  const n = text.length;
  let i = 0;
  let lineStart = true;
  while (i < n) {
    const c = text[i];
    const d = text[i + 1];
    if (c === '\n') {
      lineStart = true;
      i++;
      continue;
    }
    if (lineStart && (c === ' ' || c === '\t' || c === '\r')) {
      i++;
      continue;
    }
    const atLineStart = lineStart;
    lineStart = false;
    // Line comments
    if ((lang === 'verilog' && c === '/' && d === '/') || (lang === 'vhdl' && c === '-' && d === '-')) {
      const end = text.indexOf('\n', i);
      const stop = end < 0 ? n : end;
      blank(i, stop);
      i = stop;
      continue;
    }
    // Block comments (VHDL-2008 has them too)
    if (c === '/' && d === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end < 0 ? n : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"' && text[j] !== '\n') {
        if (lang === 'verilog' && text[j] === '\\') j++;
        j++;
      }
      const stop = Math.min(n, j + 1);
      blank(i, stop);
      i = stop;
      continue;
    }
    if (lang === 'verilog' && c === '`' && atLineStart) {
      const m = /^`(\w+)/.exec(text.slice(i, i + 40));
      if (m && LINE_DIRECTIVES.has(m[1])) {
        let stop = i;
        for (;;) {
          const end = text.indexOf('\n', stop);
          if (end < 0) {
            stop = n;
            break;
          }
          const lineText = text.slice(stop, end).replace(/\r$/, '');
          stop = end;
          if (m[1] === 'define' && lineText.endsWith('\\')) {
            stop = end + 1;
            continue;
          }
          break;
        }
        blank(i, stop);
        i = stop;
        continue;
      }
    }
    i++;
  }
  return out.join('');
}

export interface Tok {
  /** Text as written. */
  t: string;
  /** Lower-cased for VHDL (case-insensitive), as written for Verilog. */
  k: string;
  kind: 'id' | 'num' | 'sym' | 'dir';
  s: number;
  e: number;
}

const SYMS = ['::', ':=', '<=', '=>', '==', '!=', '>=', '->', '##', '**', '<<', '>>', '.*'];

/** Tokenize text that has already been through `stripCode`. */
export function tokenize(code: string, lang: HdlLang): Tok[] {
  const toks: Tok[] = [];
  const n = code.length;
  let i = 0;
  const push = (kind: Tok['kind'], s: number, e: number) => {
    const t = code.slice(s, e);
    toks.push({ t, k: lang === 'vhdl' ? t.toLowerCase() : t, kind, s, e });
  };
  while (i < n) {
    const c = code[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }
    let m: RegExpExecArray | null;
    const rest = () => code.slice(i, i + 200);
    if (/[A-Za-z_]/.test(c) || (lang === 'verilog' && c === '$')) {
      const re = lang === 'verilog' ? /^[A-Za-z_$][\w$]*/ : /^[A-Za-z_]\w*/;
      m = re.exec(rest())!;
      push('id', i, i + m[0].length);
      i += m[0].length;
      continue;
    }
    if (lang === 'verilog' && c === '\\') {
      m = /^\\\S+/.exec(rest());
      if (m) {
        push('id', i, i + m[0].length);
        i += m[0].length;
        continue;
      }
    }
    if (lang === 'verilog' && c === '`') {
      m = /^`\w+/.exec(rest());
      if (m) {
        push('dir', i, i + m[0].length);
        i += m[0].length;
        continue;
      }
    }
    if (lang === 'verilog') {
      m = /^(?:\d[\d_]*)?\s*'[sS]?[bBoOdDhH]\s*[0-9a-fA-F_xXzZ?]+|^'[01xXzZ]\b|^\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(rest());
    } else {
      m = /^'.'|^\d[\d_]*(?:#[0-9a-fA-F_.]+#|\.\d+)?(?:[eE][+-]?\d+)?/.exec(rest());
    }
    if (m && m[0].length > 0) {
      push('num', i, i + m[0].length);
      i += m[0].length;
      continue;
    }
    const sym = SYMS.find((s) => code.startsWith(s, i));
    const len = sym ? sym.length : 1;
    push('sym', i, i + len);
    i += len;
  }
  return toks;
}

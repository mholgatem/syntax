// "Align Statements": line up `=`, `<=`, `:=`, `=>`, `.port (sig)` and declaration columns
// across consecutive lines that share an indentation and a statement shape. Pure.

import type { HdlLang } from './lex';

interface Parsed {
  indent: string;
  /** Lines align together only when their kind matches. */
  kind: string;
  cells: string[];
  comment: string;
}

const V_DIRS = /^(input|output|inout|ref)\b\s*/;
const V_TYPE_WORD =
  /^(wire|reg|logic|bit|byte|int|integer|shortint|longint|real|realtime|shortreal|time|string|tri|tri0|tri1|triand|trior|trireg|wand|wor|supply0|supply1|uwire|genvar|var|signed|unsigned|const|rand|randc|interconnect)\b\s*/;
const V_STMT_KEYWORDS = new Set([
  'if', 'else', 'for', 'foreach', 'while', 'do', 'repeat', 'forever', 'case', 'casez', 'casex', 'return', 'wait',
  'assert', 'assume', 'cover', 'begin', 'end', 'always', 'always_ff', 'always_comb', 'always_latch', 'initial',
  'module', 'function', 'task', 'typedef', 'disable', 'fork', 'join', 'default', 'unique', 'priority',
]);
const VHDL_STMT_KEYWORDS = new Set(['if', 'elsif', 'else', 'when', 'while', 'for', 'return', 'assert', 'report', 'wait', 'case', 'with', 'select', 'exit', 'next', 'loop']);
const VHDL_LABEL_TARGETS = /^(entity|component|configuration|process|postponed|block|for|if|case|assert)\b/i;

/** Split off a trailing comment that is not inside a string. */
function splitComment(line: string, lang: HdlLang): [string, string] {
  const marker = lang === 'verilog' ? '//' : '--';
  let inStr = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inStr = !inStr;
    else if (!inStr && line.startsWith(marker, i)) return [line.slice(0, i), line.slice(i)];
  }
  return [line, ''];
}

/** Find the assignment operator at bracket depth 0 (outside strings). */
function findAssign(code: string, lang: HdlLang): { at: number; op: string } | null {
  let depth = 0;
  let inStr = false;
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c === '"') inStr = !inStr;
    if (inStr) continue;
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (depth === 0 && c === '=') {
      const prev = code[i - 1] ?? '';
      const next = code[i + 1] ?? '';
      if (next === '=' || next === '>') return null; // ==, ===, =>
      if (lang === 'vhdl') {
        if (prev === '<' || prev === ':') return { at: i - 1, op: prev + '=' };
        return null; // VHDL `=` is a comparison
      }
      if (prev === '<') return { at: i - 1, op: '<=' };
      if ('!>=+-*/%&|^'.includes(prev) && prev !== '') return null;
      return { at: i, op: '=' };
    }
  }
  return null;
}

function parseVerilog(code: string): Omit<Parsed, 'indent' | 'comment'> | null {
  let m = /^\.([\w$]+)\s*(\(.*)$/.exec(code);
  if (m) return { kind: 'conn', cells: ['.' + m[1], m[2]] };

  let rest = code;
  let dir = '';
  if ((m = V_DIRS.exec(rest))) {
    dir = m[1];
    rest = rest.slice(m[0].length);
  }
  const types: string[] = [];
  while ((m = V_TYPE_WORD.exec(rest))) {
    types.push(m[1]);
    rest = rest.slice(m[0].length);
  }
  if (dir && types.length === 0 && (m = /^([A-Za-z_][\w$]*(?:::[A-Za-z_][\w$]*)?(?:\.[A-Za-z_][\w$]*)?)\s+(?=[A-Za-z_\\[])/.exec(rest))) {
    types.push(m[1]);
    rest = rest.slice(m[0].length);
  }
  if (dir || types.length) {
    let range = '';
    while (rest.startsWith('[')) {
      let depth = 0;
      let j = 0;
      for (; j < rest.length; j++) {
        if (rest[j] === '[') depth++;
        else if (rest[j] === ']' && --depth === 0) break;
      }
      range += rest.slice(0, j + 1);
      rest = rest.slice(j + 1).trimStart();
    }
    if (!rest) return null;
    return { kind: dir ? 'decl-dir' : 'decl', cells: [dir, types.join(' '), range, rest] };
  }

  const a = findAssign(code, 'verilog');
  if (!a) return null;
  const lhs = code.slice(0, a.at).trim();
  const first = /^[A-Za-z_]\w*/.exec(lhs)?.[0] ?? '';
  if (!lhs || V_STMT_KEYWORDS.has(first) || /[()]/.test(lhs.replace(/\[.*?\]/g, ''))) return null;
  return { kind: 'assign' + a.op, cells: [lhs, a.op, code.slice(a.at + a.op.length).trim()] };
}

function parseVhdl(code: string): Omit<Parsed, 'indent' | 'comment'> | null {
  let m = /^((?:signal|constant|variable|shared\s+variable|file|alias)\s+[\w\s,]+?)\s*:(?!=)\s*(.*)$/i.exec(code);
  if (m) return { kind: 'vdecl', cells: [m[1].replace(/\s+/g, ' '), ':', m[2]] };
  m = /^([A-Za-z]\w*(?:\s*,\s*[A-Za-z]\w*)*)\s*:(?!=)\s*(in|out|inout|buffer|linkage)\b\s*(.*)$/i.exec(code);
  if (m) return { kind: 'vport', cells: [m[1], ':', m[2], m[3]] };
  m = /^([A-Za-z]\w*(?:\s*,\s*[A-Za-z]\w*)*)\s*:(?!=)\s*(.*)$/.exec(code);
  if (m && !VHDL_LABEL_TARGETS.test(m[2]) && /^[A-Za-z]/.test(m[2])) return { kind: 'vgeneric', cells: [m[1], ':', m[2]] };
  const arrow = code.indexOf('=>');
  if (arrow > 0) return { kind: 'map', cells: [code.slice(0, arrow).trim(), '=>', code.slice(arrow + 2).trim()] };
  const a = findAssign(code, 'vhdl');
  if (!a) return null;
  const lhs = code.slice(0, a.at).trim();
  const first = (/^[A-Za-z_]\w*/.exec(lhs)?.[0] ?? '').toLowerCase();
  if (!lhs || VHDL_STMT_KEYWORDS.has(first)) return null;
  return { kind: 'assign' + a.op, cells: [lhs, a.op, code.slice(a.at + a.op.length).trim()] };
}

/** Parse one line into alignable cells, or null if it isn't an alignable statement. */
export function parseAlignLine(line: string, lang: HdlLang): Parsed | null {
  const indent = /^\s*/.exec(line)![0];
  const [codeRaw, comment] = splitComment(line.slice(indent.length), lang);
  const code = codeRaw.trimEnd();
  if (!code) return null;
  const p = lang === 'verilog' ? parseVerilog(code) : parseVhdl(code);
  return p ? { ...p, indent, comment } : null;
}

const keyOf = (p: Parsed) => `${p.indent}\u0000${p.kind}`;

/** Align a group of already-parsed lines of the same kind and indentation. */
function alignParsed(group: Parsed[]): string[] {
  const cols = group[0].cells.length;
  const widths: number[] = [];
  for (let c = 0; c < cols - 1; c++) widths.push(Math.max(...group.map((p) => p.cells[c].length)));
  const codes = group.map((p) => {
    const parts: string[] = [];
    for (let c = 0; c < cols - 1; c++) {
      if (widths[c] === 0) continue; // column empty on every line
      parts.push(p.cells[c].padEnd(widths[c]));
    }
    parts.push(p.cells[cols - 1]);
    return (p.indent + parts.join(' ')).trimEnd();
  });
  if (!group.some((p) => p.comment)) return codes;
  const w = Math.max(...codes.map((c) => c.length));
  return codes.map((c, i) => (group[i].comment ? `${c.padEnd(w)} ${group[i].comment}` : c));
}

/**
 * Align every run of consecutive, same-shaped lines in `lines`. Lines that aren't part of
 * a run of at least two are returned unchanged.
 */
export function alignLines(lines: string[], lang: HdlLang): string[] {
  const parsed = lines.map((l) => parseAlignLine(l, lang));
  const out = [...lines];
  let i = 0;
  while (i < lines.length) {
    const p = parsed[i];
    if (!p) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < lines.length && parsed[j] && keyOf(parsed[j]!) === keyOf(p)) j++;
    if (j - i >= 2) {
      const aligned = alignParsed(parsed.slice(i, j) as Parsed[]);
      for (let k = i; k < j; k++) out[k] = aligned[k - i];
    }
    i = j;
  }
  return out;
}

/** The inclusive line range [start, end] of the alignable run containing `index`, or null. */
export function blockAround(lines: string[], index: number, lang: HdlLang): [number, number] | null {
  const p = parseAlignLine(lines[index] ?? '', lang);
  if (!p) return null;
  const key = keyOf(p);
  const same = (i: number) => {
    const q = i >= 0 && i < lines.length ? parseAlignLine(lines[i], lang) : null;
    return !!q && keyOf(q) === key;
  };
  let a = index;
  let b = index;
  while (same(a - 1)) a--;
  while (same(b + 1)) b++;
  return b > a ? [a, b] : null;
}

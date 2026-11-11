// Auto-insert the matching `end…` when Enter is pressed after a Verilog / SystemVerilog
// block opener (`begin`, `case (x)`, `module m;`, `fork`…). Pure (no Monaco).

import { stripCode, tokenize, type Tok } from './lex';

interface Group {
  openers: string[];
  closers: string[];
  /** What to insert. */
  close: string;
  /** What must follow the opener on its line for Enter to trigger. */
  trigger: 'label' | 'paren' | 'statement' | 'bare';
}

const GROUPS: Group[] = [
  { openers: ['begin'], closers: ['end'], close: 'end', trigger: 'label' },
  { openers: ['case', 'casex', 'casez', 'randcase'], closers: ['endcase'], close: 'endcase', trigger: 'paren' },
  { openers: ['fork'], closers: ['join', 'join_any', 'join_none'], close: 'join', trigger: 'label' },
  { openers: ['generate'], closers: ['endgenerate'], close: 'endgenerate', trigger: 'bare' },
  { openers: ['specify'], closers: ['endspecify'], close: 'endspecify', trigger: 'bare' },
  { openers: ['table'], closers: ['endtable'], close: 'endtable', trigger: 'bare' },
  { openers: ['config'], closers: ['endconfig'], close: 'endconfig', trigger: 'statement' },
  { openers: ['module', 'macromodule'], closers: ['endmodule'], close: 'endmodule', trigger: 'statement' },
  ...(
    [
      ['interface', 'endinterface'],
      ['program', 'endprogram'],
      ['package', 'endpackage'],
      ['class', 'endclass'],
      ['function', 'endfunction'],
      ['task', 'endtask'],
      ['covergroup', 'endgroup'],
      ['clocking', 'endclocking'],
      ['property', 'endproperty'],
      ['sequence', 'endsequence'],
      ['checker', 'endchecker'],
      ['primitive', 'endprimitive'],
    ] as const
  ).map(([o, c]): Group => ({ openers: [o], closers: [c], close: c, trigger: 'statement' })),
];

const BY_OPENER = new Map<string, Group>();
const BY_CLOSER = new Map<string, Group>();
for (const g of GROUPS) {
  for (const o of g.openers) BY_OPENER.set(o, g);
  for (const c of g.closers) BY_CLOSER.set(c, g);
}

/** Words that, earlier in the same statement, mean a header has no body. */
const BODILESS = new Set(['extern', 'typedef', 'import', 'export', 'pure']);
/** Words right before `property` / `sequence` that make it a use, not a declaration. */
const ASSERTION = new Set(['assert', 'assume', 'cover', 'restrict', 'expect']);

/** Does the keyword token at `i` really open a block that needs a closer? */
function opensBlock(toks: Tok[], i: number): boolean {
  const k = toks[i].k;
  const g = BY_OPENER.get(k);
  if (!g) return false;
  const prev = toks[i - 1]?.k;
  if (k === 'fork') return prev !== 'wait' && prev !== 'disable';
  if (k === 'interface' && (prev === 'virtual' || toks[i + 1]?.k === 'class')) return false;
  if ((k === 'property' || k === 'sequence') && prev && ASSERTION.has(prev)) return false;
  if (g.trigger !== 'statement') return true;
  // Look back through the start of this statement for extern / typedef / DPI import…
  for (let j = i - 1; j >= 0 && j >= i - 8; j--) {
    const t = toks[j].k;
    if (t === ';' || t === 'begin' || t === 'end' || BY_CLOSER.has(t)) break;
    if (BODILESS.has(t)) return false;
  }
  return true;
}

/** Does what follows the opener on its line (`after`) satisfy the group's trigger rule? */
function triggers(g: Group, after: Tok[]): boolean {
  if (after.some((t) => g.closers.includes(t.k))) return false;
  switch (g.trigger) {
    case 'bare':
      return after.length === 0;
    case 'label':
      return after.length === 0 || (after.length === 2 && after[0].k === ':' && after[1].kind === 'id');
    case 'statement':
      return after.length > 0 && after[after.length - 1].k === ';';
    case 'paren': {
      if (after[0]?.k !== '(') return false;
      let depth = 0;
      for (let j = 0; j < after.length; j++) {
        if (after[j].k === '(') depth++;
        else if (after[j].k === ')' && --depth === 0) return j === after.length - 1;
      }
      return false;
    }
  }
}

/**
 * The closer to insert when Enter is pressed at `cursor` (on the line starting at
 * `lineStart`) in Verilog / SystemVerilog `text`, or null for a plain Enter.
 */
export function autoEndFor(text: string, lineStart: number, cursor: number): string | null {
  const lineEnd = text.indexOf('\n', cursor);
  if (text.slice(cursor, lineEnd < 0 ? text.length : lineEnd).trim()) return null;
  const toks = tokenize(stripCode(text, 'verilog'), 'verilog');
  const first = toks.findIndex((t) => t.s >= lineStart);
  if (first < 0 || toks[first].s >= cursor) return null;
  let last = first;
  while (last + 1 < toks.length && toks[last + 1].s < cursor) last++;

  // The last real opener on the line.
  let at = -1;
  for (let i = last; i >= first && at < 0; i--) if (opensBlock(toks, i)) at = i;
  if (at < 0) return null;
  const g = BY_OPENER.get(toks[at].k)!;
  if (!triggers(g, toks.slice(at + 1, last + 1))) return null;

  // Only when the file is short of a closer for this kind of block.
  let balance = 0;
  toks.forEach((t, i) => {
    if (g.closers.includes(t.k)) balance--;
    else if (g.openers.includes(t.k) && opensBlock(toks, i)) balance++;
  });
  return balance > 0 ? g.close : null;
}

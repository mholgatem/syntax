// Outline parser for Verilog / SystemVerilog and VHDL. It is a forgiving, structure-level
// scanner rather than a full grammar: it finds design units, their ports and parameters,
// declarations, processes, instances and generate blocks. Pure (no Monaco).

import { stripCode, tokenize, type HdlLang, type Tok } from './lex';

export type HdlKind =
  | 'module'
  | 'interface'
  | 'program'
  | 'package'
  | 'class'
  | 'entity'
  | 'architecture'
  | 'component'
  | 'port'
  | 'parameter'
  | 'signal'
  | 'constant'
  | 'type'
  | 'function'
  | 'task'
  | 'process'
  | 'instance'
  | 'generate'
  | 'modport';

export interface HdlSymbol {
  name: string;
  kind: HdlKind;
  /** Short description shown next to the name (type, direction, value, ...). */
  detail: string;
  /** Offsets into the source text (end is exclusive). */
  start: number;
  end: number;
  nameStart: number;
  nameEnd: number;
  children: HdlSymbol[];
  /** Ports: direction (input/output/inout/ref, VHDL in/out/inout/buffer), or '' if unknown. */
  dir?: string;
  /** Ports, signals, parameters: the declared type. */
  type?: string;
  /** Parameters / generics / constants: the default value. */
  value?: string;
  /** Parameters that can be overridden from an instance (not localparam). */
  overridable?: boolean;
  /** Instances: the instantiated module/entity. Architectures: their entity. */
  of?: string;
}

/** Design units that can be instantiated. */
export const INSTANTIABLE: ReadonlySet<HdlKind> = new Set(['module', 'interface', 'program', 'entity', 'component']);

export function parseHdl(text: string, lang: HdlLang): HdlSymbol[] {
  const code = stripCode(text, lang);
  const toks = tokenize(code, lang);
  return lang === 'verilog' ? new VerilogParser(code, toks).parse() : new VhdlParser(code, toks).parse();
}

/** Depth-first walk over a symbol tree. */
export function walkSymbols(symbols: HdlSymbol[], fn: (s: HdlSymbol, parent: HdlSymbol | null) => void, parent: HdlSymbol | null = null): void {
  for (const s of symbols) {
    fn(s, parent);
    walkSymbols(s.children, fn, s);
  }
}

const DESIGN_UNITS: ReadonlySet<HdlKind> = new Set(['module', 'interface', 'program', 'package', 'entity', 'component']);

/**
 * Source ranges of module / entity names, for highlighting: the name of each design unit
 * declaration, and the instantiated module in each instance (`alu u0 (...)`,
 * `u0: entity work.alu`). Offsets are into `text`, end exclusive.
 */
export function moduleNameRanges(symbols: HdlSymbol[], text: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  walkSymbols(symbols, (s) => {
    if (DESIGN_UNITS.has(s.kind)) {
      out.push({ start: s.nameStart, end: s.nameEnd });
    } else if (s.kind === 'instance' && s.of) {
      // The module name sits before the instance name in Verilog and after it in VHDL
      // (where `of` may be qualified, e.g. work.alu): find it as a whole word.
      const name = s.of.split('.').pop()!;
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(?<![\\w$])${escaped}(?![\\w$])`, 'gi');
      re.lastIndex = s.start;
      const m = re.exec(text);
      if (m && m.index < s.end) out.push({ start: m.index, end: m.index + name.length });
    }
  });
  return out.sort((a, b) => a.start - b.start);
}

/** The innermost symbol whose range contains `offset`, with its ancestors (outermost first). */
export function symbolPathAt(symbols: HdlSymbol[], offset: number): HdlSymbol[] {
  const path: HdlSymbol[] = [];
  let level = symbols;
  for (;;) {
    const hit = level.find((s) => s.start <= offset && offset <= s.end);
    if (!hit) return path;
    path.push(hit);
    level = hit.children;
  }
}

// ---------------------------------------------------------------------------

abstract class Parser {
  protected n: number;
  constructor(
    protected code: string,
    protected toks: Tok[],
  ) {
    this.n = toks.length;
  }

  protected k(i: number): string {
    return this.toks[i]?.k ?? '';
  }
  protected t(i: number): string {
    return this.toks[i]?.t ?? '';
  }
  protected isId(i: number): boolean {
    return this.toks[i]?.kind === 'id';
  }

  /** Index of the bracket closing the one at `i` (any of ( [ { ). */
  protected matchClose(i: number): number {
    let depth = 0;
    for (let j = i; j < this.n; j++) {
      const t = this.toks[j].t;
      if (t === '(' || t === '[' || t === '{') depth++;
      else if (t === ')' || t === ']' || t === '}') {
        depth--;
        if (depth <= 0) return j;
      }
    }
    return this.n - 1;
  }

  /** Index of the next `;` at bracket depth 0 (or `n` if none). */
  protected skipTo(i: number, sep = ';'): number {
    let depth = 0;
    for (let j = i; j < this.n; j++) {
      const t = this.toks[j].t;
      if (t === '(' || t === '[' || t === '{') depth++;
      else if (t === ')' || t === ']' || t === '}') depth = Math.max(0, depth - 1);
      else if (depth === 0 && t === sep) return j;
    }
    return this.n;
  }

  /** Split the token range [a, b) at `sep` tokens that are at bracket depth 0. */
  protected splitTop(a: number, b: number, sep: string): [number, number][] {
    const out: [number, number][] = [];
    let depth = 0;
    let s = a;
    for (let j = a; j < b; j++) {
      const t = this.toks[j].t;
      if (t === '(' || t === '[' || t === '{') depth++;
      else if (t === ')' || t === ']' || t === '}') depth--;
      else if (depth === 0 && t === sep) {
        out.push([s, j]);
        s = j + 1;
      }
    }
    if (s < b) out.push([s, b]);
    return out;
  }

  /** First index in [a, b) of token `t` at depth 0, or -1. */
  protected findTop(a: number, b: number, t: string): number {
    let depth = 0;
    for (let j = a; j < b; j++) {
      const x = this.toks[j].t;
      if (x === '(' || x === '[' || x === '{') depth++;
      else if (x === ')' || x === ']' || x === '}') depth--;
      else if (depth === 0 && this.toks[j].k === t) return j;
    }
    return -1;
  }

  /** Last identifier in [a, b) that is at bracket depth 0, or -1. */
  protected lastIdTop(a: number, b: number): number {
    let depth = 0;
    let found = -1;
    for (let j = a; j < b; j++) {
      const t = this.toks[j].t;
      if (t === '(' || t === '[' || t === '{') depth++;
      else if (t === ')' || t === ']' || t === '}') depth--;
      else if (depth === 0 && this.toks[j].kind === 'id') found = j;
    }
    return found;
  }

  /** Source text of tokens a..b inclusive, whitespace collapsed. */
  protected text(a: number, b: number): string {
    if (a > b || a >= this.n) return '';
    return this.code
      .slice(this.toks[a].s, this.toks[Math.min(b, this.n - 1)].e)
      .replace(/\s+/g, ' ')
      .trim();
  }

  protected sym(kind: HdlKind, nameIdx: number, startIdx: number, endIdx: number, detail = '', extra: Partial<HdlSymbol> = {}): HdlSymbol {
    const nameTok = this.toks[nameIdx] ?? this.toks[startIdx];
    const startTok = this.toks[startIdx];
    const endTok = this.toks[Math.min(Math.max(endIdx, startIdx), this.n - 1)];
    return {
      name: this.isId(nameIdx) ? nameTok.t : extra.name ?? nameTok.t,
      kind,
      detail: detail.length > 80 ? detail.slice(0, 77) + '…' : detail,
      start: startTok.s,
      end: endTok.e,
      nameStart: nameTok.s,
      nameEnd: nameTok.e,
      children: [],
      ...extra,
    };
  }
}

// ---------------------------------------------------------------------------
// Verilog / SystemVerilog

const V_DIRS = new Set(['input', 'output', 'inout', 'ref']);
const V_TYPES = new Set([
  'wire', 'reg', 'logic', 'bit', 'byte', 'int', 'integer', 'shortint', 'longint', 'real', 'realtime',
  'shortreal', 'time', 'string', 'chandle', 'event', 'tri', 'tri0', 'tri1', 'triand', 'trior', 'trireg',
  'wand', 'wor', 'supply0', 'supply1', 'uwire', 'genvar', 'var', 'signed', 'unsigned', 'const', 'rand',
  'randc', 'enum', 'struct', 'union', 'interconnect', 'mailbox', 'semaphore',
]);
const V_SKIP_STMT = new Set([
  'assign', 'force', 'release', 'deassign', 'defparam', 'import', 'export', 'default', 'assert', 'assume',
  'cover', 'restrict', 'bind', 'alias', 'let', 'timeunit', 'timeprecision', 'nettype', 'specparam', 'return',
  'expect', 'wait', 'disable',
]);
const V_BLOCKS: Record<string, string> = {
  covergroup: 'endgroup',
  property: 'endproperty',
  sequence: 'endsequence',
  clocking: 'endclocking',
  specify: 'endspecify',
  primitive: 'endprimitive',
  config: 'endconfig',
  table: 'endtable',
  checker: 'endchecker',
};
const V_UNIT_END: Record<string, string> = {
  module: 'endmodule',
  macromodule: 'endmodule',
  interface: 'endinterface',
  program: 'endprogram',
};
const V_PROCESS = new Set(['always', 'always_ff', 'always_comb', 'always_latch', 'initial', 'final']);
const V_QUALIFIERS = new Set(['extern', 'pure', 'static', 'protected', 'local', 'virtual', 'automatic']);
const V_KEYWORDS = new Set([
  ...V_DIRS, ...V_TYPES, ...V_SKIP_STMT, ...Object.keys(V_BLOCKS), ...Object.values(V_BLOCKS), ...V_PROCESS,
  ...V_QUALIFIERS, 'module', 'endmodule', 'interface', 'endinterface', 'program', 'endprogram', 'package',
  'endpackage', 'class', 'endclass', 'function', 'endfunction', 'task', 'endtask', 'begin', 'end', 'if', 'else',
  'for', 'foreach', 'while', 'do', 'repeat', 'forever', 'case', 'casez', 'casex', 'endcase', 'generate',
  'endgenerate', 'fork', 'join', 'join_any', 'join_none', 'parameter', 'localparam', 'typedef', 'modport',
  'new', 'null', 'this', 'super', 'or', 'posedge', 'negedge', 'edge', 'packed', 'constraint', 'unique', 'priority',
]);

type VCtx = 'top' | 'unit' | 'gen' | 'pkg' | 'class';

class VerilogParser extends Parser {
  parse(): HdlSymbol[] {
    const out: HdlSymbol[] = [];
    this.items(0, this.n, out, 'top');
    return out;
  }

  private items(i: number, end: number, out: HdlSymbol[], ctx: VCtx): void {
    while (i < end) i = Math.max(i + 1, this.item(i, end, out, ctx));
  }

  /** Skip an optional `: label` after an end keyword at index i (returns the index after). */
  private afterLabel(i: number): number {
    return this.t(i) === ':' && this.isId(i + 1) ? i + 2 : i;
  }

  /** Index of the keyword in `closers` matching the opener at `i`, honouring nesting. */
  private matchKw(i: number, openers: ReadonlySet<string>, closers: ReadonlySet<string>, limit = this.n): number {
    let depth = 0;
    for (let j = i; j < limit; j++) {
      const k = this.k(j);
      if (openers.has(k)) depth++;
      else if (closers.has(k)) {
        depth--;
        if (depth === 0) return j;
      }
    }
    return limit - 1;
  }

  private item(i: number, end: number, out: HdlSymbol[], ctx: VCtx): number {
    const k = this.k(i);
    const tok = this.toks[i];
    if (tok.kind === 'dir') return this.t(i + 1) === '(' ? this.matchClose(i + 1) + 1 : i + 1;
    if (k === ';') return i + 1;
    if (k.startsWith('end') && V_KEYWORDS.has(k)) return this.afterLabel(i + 1);
    if (k in V_UNIT_END && !(k === 'interface' && this.k(i + 1) === 'class')) return this.unit(i, out);
    if (k === 'interface' || k === 'class') return this.classDecl(k === 'class' ? i : i + 1, out);
    if (k === 'virtual' && this.k(i + 1) === 'class') return this.classDecl(i + 1, out);
    if (k === 'package') return this.pkg(i, out);
    if (k === 'function' || k === 'task') return this.subroutine(i, out);
    if (V_QUALIFIERS.has(k)) return i + 1;
    if (V_PROCESS.has(k)) return this.process(i, out);
    if (k === 'modport') {
      const stop = this.skipTo(i);
      for (const [s, e] of this.splitTop(i + 1, stop, ',')) {
        if (this.isId(s)) out.push(this.sym('modport', s, s, e - 1, this.t(s + 1) === '(' ? this.text(s + 1, e - 1) : ''));
      }
      return stop + 1;
    }
    if (V_SKIP_STMT.has(k)) return this.skipTo(i) + 1;
    if (k in V_BLOCKS) {
      const close = this.matchKw(i, new Set([k]), new Set([V_BLOCKS[k]]), end);
      return this.afterLabel(close + 1);
    }
    if (k === 'constraint') {
      let p = i + 1;
      while (p < end && this.t(p) !== '{' && this.t(p) !== ';') p++;
      return this.t(p) === '{' ? this.matchClose(p) + 1 : p + 1;
    }
    if (V_DIRS.has(k)) return this.portDecl(i, out, ctx);
    if (k === 'parameter' || k === 'localparam') return this.paramDecl(i, out);
    if (k === 'typedef') {
      const stop = this.skipTo(i);
      const name = this.lastIdTop(i + 1, stop);
      if (name >= 0) out.push(this.sym('type', name, i, stop, this.t(i + 1)));
      return stop + 1;
    }
    if (V_TYPES.has(k)) return this.varDecl(i, i, out);
    if (k === 'generate' || k === 'endgenerate') return i + 1;
    if ((k === 'for' || k === 'if' || k === 'case') && (ctx === 'unit' || ctx === 'gen')) return this.genBlock(i, out);
    if (k === 'begin') {
      const close = this.matchKw(i, new Set(['begin']), new Set(['end']), end);
      const bodyStart = this.t(i + 1) === ':' ? i + 3 : i + 1;
      this.items(bodyStart, close, out, ctx);
      return this.afterLabel(close + 1);
    }
    if (tok.kind === 'id' && this.t(i + 1) === ':') return i + 2; // statement label
    if (tok.kind === 'id' && !V_KEYWORDS.has(k)) return this.userItem(i, out);
    return this.skipTo(i) + 1;
  }

  private unit(i: number, out: HdlSymbol[]): number {
    const kw = this.k(i);
    const kind: HdlKind = kw === 'interface' ? 'interface' : kw === 'program' ? 'program' : 'module';
    let j = i + 1;
    if (this.k(j) === 'automatic' || this.k(j) === 'static') j++;
    if (!this.isId(j)) return j;
    const nameIdx = j++;
    const unit = this.sym(kind, nameIdx, i, nameIdx);
    while (this.k(j) === 'import') j = this.skipTo(j) + 1;
    if (this.t(j) === '#' && this.t(j + 1) === '(') {
      const close = this.matchClose(j + 1);
      this.headerParams(j + 2, close, unit);
      j = close + 1;
    }
    if (this.t(j) === '(') {
      const close = this.matchClose(j);
      this.headerPorts(j + 1, close, unit);
      j = close + 1;
    }
    j = this.skipTo(j) + 1;
    const endKw = V_UNIT_END[kw];
    let close = j;
    while (close < this.n && this.k(close) !== endKw) close++;
    this.items(j, close, unit.children, 'unit');
    const after = this.afterLabel(close + 1);
    unit.end = this.toks[Math.min(after - 1, this.n - 1)].e;
    out.push(unit);
    return after;
  }

  private headerParams(a: number, b: number, unit: HdlSymbol): void {
    let local = false;
    for (let [s, e] of this.splitTop(a, b, ',')) {
      if (this.k(s) === 'parameter' || this.k(s) === 'localparam') {
        local = this.k(s) === 'localparam';
        s++;
      }
      if (s >= e) continue;
      const eq = this.findTop(s, e, '=');
      const nameIdx = this.lastIdTop(s, eq >= 0 ? eq : e);
      if (nameIdx < 0) continue;
      const value = eq >= 0 ? this.text(eq + 1, e - 1) : undefined;
      const type = this.text(s, nameIdx - 1);
      unit.children.push(
        this.sym('parameter', nameIdx, s, e - 1, value !== undefined ? `= ${value}` : type, {
          value,
          type,
          overridable: !local,
        }),
      );
    }
  }

  private headerPorts(a: number, b: number, unit: HdlSymbol): void {
    let prevDir = '';
    let prevType = '';
    let ansi = false;
    for (const [s, e] of this.splitTop(a, b, ',')) {
      if (s >= e) continue;
      if (this.t(s) === '.' && this.isId(s + 1)) {
        unit.children.push(this.sym('port', s + 1, s, e - 1, '', { dir: '', type: '' }));
        continue;
      }
      let dir = V_DIRS.has(this.k(s)) ? this.k(s) : '';
      if (dir) ansi = true;
      const eq = this.findTop(s, e, '=');
      const stop = eq >= 0 ? eq : e;
      const nameIdx = this.lastIdTop(s, stop);
      if (nameIdx < 0) continue;
      let type = '';
      if (ansi) {
        const typeStart = dir ? s + 1 : s;
        type = typeStart < nameIdx ? this.text(typeStart, nameIdx - 1) : '';
        if (!dir) {
          if (!type) type = prevType;
          dir = type === prevType ? prevDir : '';
        }
        prevDir = dir;
        prevType = type;
      }
      unit.children.push(this.sym('port', nameIdx, s, e - 1, [dir, type].filter(Boolean).join(' '), { dir, type }));
    }
  }

  private portDecl(i: number, out: HdlSymbol[], ctx: VCtx): number {
    const stop = this.skipTo(i);
    if (ctx !== 'unit') return stop + 1; // task/function argument declarations etc.
    const dir = this.k(i);
    let type = '';
    this.splitTop(i, stop, ',').forEach(([s, e], idx) => {
      const eq = this.findTop(s, e, '=');
      const nameIdx = this.lastIdTop(s, eq >= 0 ? eq : e);
      if (nameIdx < 0) return;
      if (idx === 0) type = nameIdx - 1 >= s + 1 ? this.text(s + 1, nameIdx - 1) : '';
      const name = this.t(nameIdx);
      const detail = [dir, type].filter(Boolean).join(' ');
      const existing = out.find((c) => c.kind === 'port' && c.name === name);
      if (existing) Object.assign(existing, { dir, type, detail });
      else out.push(this.sym('port', nameIdx, s, e - 1, detail, { dir, type }));
    });
    return stop + 1;
  }

  private paramDecl(i: number, out: HdlSymbol[]): number {
    const stop = this.skipTo(i);
    const local = this.k(i) === 'localparam';
    for (const [s, e] of this.splitTop(i + 1, stop, ',')) {
      const eq = this.findTop(s, e, '=');
      const nameIdx = this.lastIdTop(s, eq >= 0 ? eq : e);
      if (nameIdx < 0) continue;
      const value = eq >= 0 ? this.text(eq + 1, e - 1) : undefined;
      out.push(
        this.sym('parameter', nameIdx, s, e - 1, value !== undefined ? `= ${value}` : '', {
          value,
          type: s < nameIdx ? this.text(s, nameIdx - 1) : '',
          overridable: !local,
        }),
      );
    }
    return stop + 1;
  }

  /** `type name [= v], name2 ...;` where the type starts at `typeStart`. */
  private varDecl(i: number, typeStart: number, out: HdlSymbol[]): number {
    const stop = this.skipTo(i);
    let type = '';
    this.splitTop(typeStart, stop, ',').forEach(([s, e], idx) => {
      const eq = this.findTop(s, e, '=');
      const nameIdx = this.lastIdTop(s, eq >= 0 ? eq : e);
      if (nameIdx < 0 || V_KEYWORDS.has(this.k(nameIdx))) return;
      if (idx === 0) type = s < nameIdx ? this.text(s, nameIdx - 1) : '';
      out.push(this.sym('signal', nameIdx, s, e - 1, type, { type }));
    });
    return stop + 1;
  }

  /** A statement starting with a user identifier: an instance, a user-typed declaration, or other. */
  private userItem(i: number, out: HdlSymbol[]): number {
    if (this.t(i).startsWith('$')) return this.skipTo(i) + 1;
    let j = i + 1;
    while (this.t(j) === '::' && this.isId(j + 1)) j += 2;
    let params = '';
    if (this.t(j) === '#') {
      if (this.t(j + 1) === '(') {
        const close = this.matchClose(j + 1);
        params = this.text(j, close);
        j = close + 1;
      } else j += 2;
    }
    const callOpen = (p: number) => {
      while (this.t(p) === '[') p = this.matchClose(p) + 1;
      return this.t(p) === '(' ? p : -1;
    };
    if (this.isId(j) && callOpen(j + 1) >= 0 && !V_KEYWORDS.has(this.k(j))) {
      const modName = this.text(i, i);
      let close = j;
      for (;;) {
        const open = callOpen(j + 1);
        close = this.matchClose(open);
        out.push(this.sym('instance', j, i, close, modName + (params ? ' ' + params : ''), { of: modName }));
        if (this.t(close + 1) === ',' && this.isId(close + 2) && callOpen(close + 3) >= 0) j = close + 2;
        else break;
      }
      return this.skipTo(close) + 1;
    }
    let p = j;
    while (this.t(p) === '[') p = this.matchClose(p) + 1;
    if (this.isId(p) && !V_KEYWORDS.has(this.k(p))) return this.varDecl(i, i, out);
    return this.skipTo(i) + 1;
  }

  private process(i: number, out: HdlSymbol[]): number {
    const kw = this.t(i);
    let j = i + 1;
    let ev = '';
    if (this.t(j) === '@') {
      if (this.t(j + 1) === '(') {
        const close = this.matchClose(j + 1);
        ev = this.text(j, close);
        j = close + 1;
      } else {
        ev = this.text(j, j + 1);
        j += 2;
      }
    }
    let label = '';
    if (this.k(j) === 'begin' && this.t(j + 1) === ':' && this.isId(j + 2)) label = this.t(j + 2);
    const end = this.stmtEnd(j);
    out.push(this.sym('process', i, i, end - 1, label, { name: ev ? `${kw} ${ev}` : kw }));
    return end;
  }

  /** Index just after the procedural statement that starts at j. */
  private stmtEnd(j: number): number {
    if (j >= this.n) return this.n;
    const k = this.k(j);
    if (k === 'begin') return this.afterLabel(this.matchKw(j, new Set(['begin']), new Set(['end'])) + 1);
    if (k === 'fork') return this.afterLabel(this.matchKw(j, new Set(['fork']), new Set(['join', 'join_any', 'join_none'])) + 1);
    if (k === 'if') {
      let p = j + 1;
      if (this.t(p) === '(') p = this.matchClose(p) + 1;
      p = this.stmtEnd(p);
      if (this.k(p) === 'else') p = this.stmtEnd(p + 1);
      return p;
    }
    if (k === 'case' || k === 'casez' || k === 'casex' || k === 'randcase') {
      return this.matchKw(j, new Set(['case', 'casez', 'casex', 'randcase']), new Set(['endcase'])) + 1;
    }
    if (k === 'for' || k === 'while' || k === 'repeat' || k === 'foreach') {
      let p = j + 1;
      if (this.t(p) === '(') p = this.matchClose(p) + 1;
      return this.stmtEnd(p);
    }
    if (k === 'forever' || k === 'unique' || k === 'unique0' || k === 'priority') return this.stmtEnd(j + 1);
    if (k === 'do') {
      let p = this.stmtEnd(j + 1);
      if (this.k(p) === 'while') p = this.skipTo(p) + 1;
      return p;
    }
    if (k === '@' || k === '#') {
      let p = j + 1;
      if (this.t(p) === '(') p = this.matchClose(p) + 1;
      else p++;
      return this.stmtEnd(p);
    }
    if (this.isId(j) && this.t(j + 1) === ':') return this.stmtEnd(j + 2);
    return this.skipTo(j) + 1;
  }

  private subroutine(i: number, out: HdlSymbol[]): number {
    const kw = this.k(i);
    let p = i + 1;
    while (p < this.n && this.t(p) !== '(' && this.t(p) !== ';') p++;
    const nameIdx = this.lastIdTop(i + 1, p);
    const proto = this.k(i - 1) === 'extern' || this.k(i - 1) === 'pure' || this.k(i - 2) === 'pure' || this.k(i - 2) === 'extern';
    const args = this.t(p) === '(' ? this.text(p, this.matchClose(p)) : '';
    let end: number;
    if (proto) end = this.skipTo(p) + 1;
    else {
      const close = this.matchKw(i, new Set([kw]), new Set(['end' + kw]));
      end = this.afterLabel(close + 1);
    }
    if (nameIdx >= 0) out.push(this.sym(kw === 'task' ? 'task' : 'function', nameIdx, i, end - 1, args));
    return end;
  }

  private classDecl(i: number, out: HdlSymbol[]): number {
    const nameIdx = i + 1;
    const close = this.matchKw(i, new Set(['class']), new Set(['endclass']));
    const sym = this.sym('class', nameIdx, i, close);
    this.items(this.skipTo(i) + 1, close, sym.children, 'class');
    out.push(sym);
    return this.afterLabel(close + 1);
  }

  private pkg(i: number, out: HdlSymbol[]): number {
    let j = i + 1;
    if (this.k(j) === 'automatic' || this.k(j) === 'static') j++;
    let close = j;
    while (close < this.n && this.k(close) !== 'endpackage') close++;
    const sym = this.sym('package', j, i, close);
    this.items(this.skipTo(j) + 1, close, sym.children, 'pkg');
    out.push(sym);
    return this.afterLabel(close + 1);
  }

  private genBlock(i: number, out: HdlSymbol[]): number {
    const k = this.k(i);
    if (k === 'case') {
      const close = this.matchKw(i, new Set(['case']), new Set(['endcase']));
      out.push(this.sym('generate', i, i, close, this.t(i + 1) === '(' ? this.text(i + 1, this.matchClose(i + 1)) : ''));
      return close + 1;
    }
    let p = i + 1;
    let cond = '';
    if (this.t(p) === '(') {
      const close = this.matchClose(p);
      cond = this.text(p, close);
      p = close + 1;
    }
    const children: HdlSymbol[] = [];
    let label = -1;
    let after: number;
    if (this.k(p) === 'begin') {
      if (this.t(p + 1) === ':' && this.isId(p + 2)) label = p + 2;
      const close = this.matchKw(p, new Set(['begin']), new Set(['end']));
      this.items(label >= 0 ? p + 3 : p + 1, close, children, 'gen');
      after = this.afterLabel(close + 1);
    } else {
      after = this.item(p, this.n, children, 'gen');
    }
    const sym = this.sym('generate', label >= 0 ? label : i, i, after - 1, label >= 0 ? `${k} ${cond}` : '');
    if (label < 0) sym.name = `${k} ${cond}`.trim();
    sym.children = children;
    out.push(sym);
    if (k === 'if' && this.k(after) === 'else') {
      if (this.k(after + 1) === 'if') return this.genBlock(after + 1, out);
      const elseSyms: HdlSymbol[] = [];
      const next = this.item(after + 1, this.n, elseSyms, 'gen');
      const elseSym = this.sym('generate', after, after, next - 1);
      elseSym.name = 'else';
      elseSym.children = elseSyms;
      out.push(elseSym);
      return next;
    }
    return after;
  }
}

// ---------------------------------------------------------------------------
// VHDL

const VHDL_UNITS = new Set(['entity', 'architecture', 'package', 'configuration', 'context']);
const VHDL_DIRS = new Set(['in', 'out', 'inout', 'buffer', 'linkage']);

class VhdlParser extends Parser {
  parse(): HdlSymbol[] {
    const out: HdlSymbol[] = [];
    let i = 0;
    while (i < this.n) i = Math.max(i + 1, this.top(i, out));
    return out;
  }

  private top(i: number, out: HdlSymbol[]): number {
    const k = this.k(i);
    if (k === 'library' || k === 'use') return this.skipTo(i) + 1;
    if (k === 'entity' && this.isId(i + 1)) return this.entity(i, out);
    if (k === 'architecture' && this.isId(i + 1)) return this.arch(i, out);
    if (k === 'package') return this.pkg(i, out);
    if (k === 'configuration' || k === 'context') return this.unitEnd(i) + 1;
    return i + 1;
  }

  /** Index of the `;` that ends the design unit starting at `i`. */
  private unitEnd(i: number): number {
    let next = this.n;
    for (let j = i + 1; j < this.n; j++) {
      if (VHDL_UNITS.has(this.k(j)) && this.t(j - 1) === ';' && this.isId(j + 1) && this.k(j) !== 'context') {
        next = j;
        break;
      }
    }
    // Walk back over the next unit's library/use clauses.
    let end = next - 1;
    for (;;) {
      let q = end - 1;
      while (q > i && this.t(q) !== ';') q--;
      const k = this.k(q + 1);
      if (q > i && (k === 'library' || k === 'use' || k === 'context')) end = q;
      else break;
    }
    return Math.max(i, Math.min(end, this.n - 1));
  }

  private entity(i: number, out: HdlSymbol[]): number {
    const end = this.unitEnd(i);
    const sym = this.sym('entity', i + 1, i, end);
    let j = this.k(i + 2) === 'is' ? i + 3 : i + 2;
    while (j < end) {
      const k = this.k(j);
      if (k === 'begin' || k === 'end') break;
      j = Math.max(j + 1, this.declItem(j, sym.children));
    }
    out.push(sym);
    return end + 1;
  }

  private arch(i: number, out: HdlSymbol[]): number {
    const end = this.unitEnd(i);
    const of = this.k(i + 2) === 'of' && this.isId(i + 3) ? this.t(i + 3) : '';
    const sym = this.sym('architecture', i + 1, i, end, of ? `of ${of}` : '', { of });
    let j = i + 2;
    while (j < end && this.k(j) !== 'is') j++;
    j++;
    // Declarative part, then concurrent statements.
    while (j < end && this.k(j) !== 'begin') j = Math.max(j + 1, this.declItem(j, sym.children));
    j++;
    this.concurrent(j, end, sym.children);
    out.push(sym);
    return end + 1;
  }

  private pkg(i: number, out: HdlSymbol[]): number {
    const body = this.k(i + 1) === 'body';
    const nameIdx = body ? i + 2 : i + 1;
    if (this.k(nameIdx + 1) === 'is' && this.k(nameIdx + 2) === 'new') return this.skipTo(i) + 1;
    const end = this.unitEnd(i);
    const sym = this.sym('package', nameIdx, i, end, body ? 'body' : '');
    let j = nameIdx + 2;
    while (j < end) {
      if (this.k(j) === 'end') break;
      j = Math.max(j + 1, this.declItem(j, sym.children));
    }
    out.push(sym);
    return end + 1;
  }

  private concurrent(j: number, end: number, out: HdlSymbol[]): void {
    while (j < end) j = Math.max(j + 1, this.concItem(j, end, out));
  }

  /** Generic/port interface list in [a, b). */
  private iface(a: number, b: number, out: HdlSymbol[], mode: 'generic' | 'port'): void {
    for (let [s, e] of this.splitTop(a, b, ';')) {
      if (['signal', 'constant', 'variable', 'file'].includes(this.k(s))) s++;
      const colon = this.findTop(s, e, ':');
      if (colon < 0) continue;
      const dir = VHDL_DIRS.has(this.k(colon + 1)) ? this.k(colon + 1) : '';
      const typeStart = dir ? colon + 2 : colon + 1;
      const assign = this.findTop(typeStart, e, ':=');
      const type = this.text(typeStart, (assign >= 0 ? assign : e) - 1);
      const value = assign >= 0 ? this.text(assign + 1, e - 1) : undefined;
      for (let n = s; n < colon; n++) {
        if (!this.isId(n)) continue;
        if (mode === 'generic') {
          out.push(this.sym('parameter', n, s, e - 1, `${type}${value !== undefined ? ' := ' + value : ''}`, { type, value, overridable: true }));
        } else {
          out.push(this.sym('port', n, s, e - 1, `${dir} ${type}`.trim(), { dir, type }));
        }
      }
    }
  }

  private declItem(j: number, out: HdlSymbol[]): number {
    const k = this.k(j);
    if ((k === 'generic' || k === 'port') && this.t(j + 1) === '(') {
      const close = this.matchClose(j + 1);
      this.iface(j + 2, close, out, k);
      return this.t(close + 1) === ';' ? close + 2 : close + 1;
    }
    if (k === 'signal' || k === 'constant' || k === 'variable' || k === 'shared' || k === 'file') {
      const start = j;
      if (k === 'shared') j++;
      const stop = this.skipTo(j);
      const colon = this.findTop(j + 1, stop, ':');
      if (colon < 0) return stop + 1;
      const assign = this.findTop(colon + 1, stop, ':=');
      const type = this.text(colon + 1, (assign >= 0 ? assign : stop) - 1);
      const value = assign >= 0 ? this.text(assign + 1, stop - 1) : undefined;
      for (let n = j + 1; n < colon; n++) {
        if (!this.isId(n)) continue;
        out.push(
          this.sym(k === 'constant' ? 'constant' : 'signal', n, start, stop, `${type}${value !== undefined && k === 'constant' ? ' := ' + value : ''}`, {
            type,
            value,
          }),
        );
      }
      return stop + 1;
    }
    if (k === 'type' || k === 'subtype') {
      let stop = this.skipTo(j);
      const inner = this.k(j + 3);
      if (this.k(j + 2) === 'is' && (inner === 'record' || inner === 'protected' || inner === 'units')) {
        let q = j + 4;
        while (q < this.n && !(this.k(q) === 'end' && this.k(q + 1) === inner)) q++;
        stop = this.skipTo(q);
      }
      if (this.isId(j + 1)) out.push(this.sym('type', j + 1, j, stop, inner === 'record' ? 'record' : ''));
      return stop + 1;
    }
    if (k === 'component' && this.isId(j + 1)) {
      let q = j + 2;
      while (q < this.n && !(this.k(q) === 'end' && this.k(q + 1) === 'component')) q++;
      const stop = this.skipTo(q);
      const sym = this.sym('component', j + 1, j, stop);
      let p = this.k(j + 2) === 'is' ? j + 3 : j + 2;
      while (p < q) p = Math.max(p + 1, this.declItem(p, sym.children));
      out.push(sym);
      return stop + 1;
    }
    if (k === 'function' || k === 'procedure' || k === 'pure' || k === 'impure') return this.subprogram(j, out);
    if (k === 'package') {
      // VHDL-2008 local package: skip it.
      const stop = this.skipTo(j);
      if (this.findTop(j, stop, 'new') >= 0) return stop + 1;
      let q = j + 1;
      while (q < this.n && !(this.k(q) === 'end' && (this.k(q + 1) === 'package' || this.k(q + 1) === this.k(j + 1)))) q++;
      return this.skipTo(q) + 1;
    }
    return this.skipTo(j) + 1;
  }

  private subprogram(j: number, out: HdlSymbol[]): number {
    const start = j;
    if (this.k(j) === 'pure' || this.k(j) === 'impure') j++;
    const kw = this.k(j);
    const nameIdx = j + 1;
    let p = j + 2;
    let args = '';
    if (this.t(p) === '(') {
      const close = this.matchClose(p);
      args = this.text(p, close);
      p = close + 1;
    }
    const semi = this.skipTo(p);
    const is = this.findTop(p, semi, 'is');
    let end: number;
    if (is < 0) end = semi;
    else {
      const name = this.k(nameIdx);
      let q = is + 1;
      while (q < this.n && !(this.k(q) === 'end' && (this.k(q + 1) === kw || this.k(q + 1) === name || this.t(q + 1) === ';'))) q++;
      end = this.skipTo(q);
    }
    if (this.isId(nameIdx)) out.push(this.sym('function', nameIdx, start, end, args, { name: this.t(nameIdx) }));
    if (kw === 'procedure' && out.length && out[out.length - 1].nameStart === this.toks[nameIdx]?.s) out[out.length - 1].kind = 'task';
    return end + 1;
  }

  private concItem(j: number, end: number, out: HdlSymbol[]): number {
    const k0 = this.k(j);
    if (k0 === 'begin') return j + 1;
    if (k0 === 'elsif' || k0 === 'else' || k0 === 'when') {
      // generate branches
      let q = j + 1;
      while (q < end && this.k(q) !== 'generate' && this.t(q) !== '=>' && this.t(q) !== ';') q++;
      return q + 1;
    }
    const labelled = this.isId(j) && this.t(j + 1) === ':';
    const label = labelled ? j : -1;
    let p = labelled ? j + 2 : j;
    if (this.k(p) === 'postponed') p++;
    const k = this.k(p);
    if (k === 'process') {
      let q = p + 1;
      while (q < this.n && !(this.k(q) === 'end' && (this.k(q + 1) === 'process' || this.k(q + 1) === 'postponed'))) q++;
      const stop = this.skipTo(q);
      const sens = this.t(p + 1) === '(' ? this.text(p + 1, this.matchClose(p + 1)) : '';
      const sym = this.sym('process', label >= 0 ? label : p, j, stop, label >= 0 ? sens : '');
      if (label < 0) sym.name = sens ? `process ${sens}` : 'process';
      out.push(sym);
      return stop + 1;
    }
    if (labelled && (k === 'for' || k === 'if' || k === 'case' || k === 'block')) {
      const opener = k === 'block' ? 'block' : 'generate';
      let g = p;
      while (g < end && this.k(g) !== opener && this.t(g) !== ';') g++;
      if (this.k(g) === opener) {
        let depth = 1;
        let q = g + 1;
        for (; q < this.n; q++) {
          if (this.k(q) === opener && this.k(q - 1) !== 'end') depth++;
          else if (this.k(q) === 'end' && this.k(q + 1) === opener && --depth === 0) break;
        }
        const stop = this.skipTo(q);
        const sym = this.sym('generate', label, j, stop, k === 'block' ? 'block' : this.text(p, g - 1));
        this.concurrent(g + 1, q, sym.children);
        out.push(sym);
        return stop + 1;
      }
    }
    if (labelled && (k === 'entity' || k === 'component' || k === 'configuration')) {
      const stop = this.skipTo(p);
      let q = p + 1;
      let target = -1;
      while (q < stop && this.t(q) !== '(' && this.k(q) !== 'generic' && this.k(q) !== 'port') {
        if (this.isId(q)) target = q;
        q++;
      }
      const of = target >= 0 ? this.t(target) : '';
      out.push(this.sym('instance', label, j, stop, this.text(p, Math.max(p, q - 1)), { of }));
      return stop + 1;
    }
    if (labelled && this.isId(p) && (this.k(p + 1) === 'port' || this.k(p + 1) === 'generic' || this.t(p + 1) === ';')) {
      const stop = this.skipTo(p);
      out.push(this.sym('instance', label, j, stop, this.t(p), { of: this.t(p) }));
      return stop + 1;
    }
    if (['signal', 'constant', 'shared', 'type', 'subtype', 'component', 'function', 'procedure', 'pure', 'impure', 'file'].includes(k0)) {
      return this.declItem(j, out);
    }
    return this.skipTo(j) + 1;
  }
}

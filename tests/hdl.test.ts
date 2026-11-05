import { describe, expect, it } from 'vitest';
import { stripCode, hdlLang } from '../src/editor/hdl/lex';
import { moduleNameRanges, parseHdl, symbolPathAt, walkSymbols, type HdlSymbol } from '../src/editor/hdl/symbols';
import { instanceTemplate } from '../src/editor/hdl/instance';
import { alignLines, blockAround } from '../src/editor/hdl/align';

const names = (syms: HdlSymbol[], kind?: string) => syms.filter((s) => !kind || s.kind === kind).map((s) => s.name);
const find = (syms: HdlSymbol[], name: string) => {
  let hit: HdlSymbol | undefined;
  walkSymbols(syms, (s) => {
    if (!hit && s.name === name) hit = s;
  });
  return hit!;
};

describe('lexer', () => {
  it('maps languages', () => {
    expect(hdlLang('verilog')).toBe('verilog');
    expect(hdlLang('systemverilog')).toBe('verilog');
    expect(hdlLang('vhdl')).toBe('vhdl');
    expect(hdlLang('python')).toBeNull();
  });
  it('blanks comments, strings and directives but keeps offsets', () => {
    const src = 'a // module x\n/* module y */ b "module z"\n`define M module q \\\n  more\nc';
    const out = stripCode(src, 'verilog');
    expect(out.length).toBe(src.length);
    expect(out).not.toMatch(/module/);
    expect(out.split('\n').length).toBe(src.split('\n').length);
    expect(out.trim().startsWith('a')).toBe(true);
    expect(out.trimEnd().endsWith('c')).toBe(true);
  });
});

describe('Verilog / SystemVerilog outline', () => {
  const ansi = `
// module commented_out (input a);
module counter #(parameter W = 8, localparam MAX = (1 << W) - 1) (
  input  wire         clk,
  input  wire         rst,
  output reg  [W-1:0] q,
  output              done
);
  wire [W-1:0] next, other;
  logic        flag = 1'b0;
  state_t      state;
  localparam int DEPTH = 4;
  always @(posedge clk) begin : seq
    if (rst) q <= 0;
    else     q <= next;
  end
  always_comb next = q + 1'b1;
  assign done = q == MAX;
  adder #(.W(W)) u_add (.a(q), .b(1), .y(other));
  genvar i;
  for (i = 0; i < 4; i++) begin : g_bits
    flop u_ff (.d(q[i]), .q());
  end
  function automatic logic [7:0] inc(input logic [7:0] x);
    return x + 1;
  endfunction
  task run; endtask
endmodule : counter
`;
  const syms = parseHdl(ansi, 'verilog');

  it('finds the module and ignores commented-out code', () => {
    expect(names(syms)).toEqual(['counter']);
  });
  it('reads ANSI ports with direction and type', () => {
    const m = syms[0];
    expect(names(m.children, 'port')).toEqual(['clk', 'rst', 'q', 'done']);
    const q = find(syms, 'q');
    expect(q.dir).toBe('output');
    expect(q.type).toBe('reg [W-1:0]');
    expect(find(syms, 'done').dir).toBe('output');
  });
  it('reads header and body parameters', () => {
    const w = find(syms, 'W');
    expect(w.value).toBe('8');
    expect(w.overridable).toBe(true);
    expect(find(syms, 'MAX').overridable).toBe(false);
    expect(find(syms, 'DEPTH').overridable).toBe(false);
  });
  it('reads declarations, processes, instances, generate blocks and subroutines', () => {
    const m = syms[0];
    expect(names(m.children, 'signal')).toEqual(['next', 'other', 'flag', 'state', 'i']);
    expect(names(m.children, 'process')).toEqual(['always @(posedge clk)', 'always_comb']);
    const inst = find(syms, 'u_add');
    expect(inst.kind).toBe('instance');
    expect(inst.of).toBe('adder');
    const gen = find(syms, 'g_bits');
    expect(gen.kind).toBe('generate');
    expect(names(gen.children)).toEqual(['u_ff']);
    expect(find(syms, 'inc').kind).toBe('function');
    expect(find(syms, 'run').kind).toBe('task');
  });
  it('locates the innermost symbol at an offset', () => {
    const at = ansi.indexOf('flop u_ff');
    expect(symbolPathAt(syms, at).map((s) => s.name)).toEqual(['counter', 'g_bits', 'u_ff']);
  });

  it('fills non-ANSI port directions from body declarations', () => {
    const src = `module old(a, b, y);\n  input a, b;\n  output [3:0] y;\n  reg [3:0] y;\nendmodule`;
    const m = parseHdl(src, 'verilog')[0];
    const ports = m.children.filter((c) => c.kind === 'port');
    expect(ports.map((p) => [p.name, p.dir])).toEqual([
      ['a', 'input'],
      ['b', 'input'],
      ['y', 'output'],
    ]);
    expect(ports[2].type).toBe('[3:0]');
  });

  it('handles SV packages, classes, interfaces and modports', () => {
    const src = `
package pkg;
  typedef enum logic [1:0] {IDLE, RUN} state_t;
  parameter int N = 4;
  function int twice(int x); return 2*x; endfunction
  class packet extends base;
    rand bit [7:0] data;
    constraint c { data < 10; }
    extern function void show();
    task send(); endtask
  endclass
endpackage
interface bus_if #(parameter W = 8) (input logic clk);
  logic [W-1:0] data;
  modport master (output data), slave (input data);
endinterface
program automatic tb; initial begin end endprogram`;
    const syms = parseHdl(src, 'verilog');
    expect(syms.map((s) => [s.kind, s.name])).toEqual([
      ['package', 'pkg'],
      ['interface', 'bus_if'],
      ['program', 'tb'],
    ]);
    expect(names(syms[0].children)).toEqual(['state_t', 'N', 'twice', 'packet']);
    expect(names(find(syms, 'packet').children)).toEqual(['data', 'show', 'send']);
    expect(names(syms[1].children, 'modport')).toEqual(['master', 'slave']);
  });
});

describe('VHDL outline', () => {
  const src = `
library ieee;
use ieee.std_logic_1164.all;
-- entity fake is end;
entity alu is
  generic (WIDTH : integer := 8; DEPTH : natural := 4);
  port (
    a, b : in  std_logic_vector(WIDTH-1 downto 0);
    y    : out std_logic_vector(WIDTH-1 downto 0)
  );
end entity alu;

architecture rtl of alu is
  type state_t is record x : integer; y : integer; end record;
  signal s1, s2 : std_logic;
  constant ZERO : std_logic_vector(7 downto 0) := (others => '0');
  component adder is
    port (x : in bit; z : out bit);
  end component;
  function f(v : integer) return integer is
    variable t : integer;
  begin
    if v > 0 then return v; end if;
    return 0;
  end function;
begin
  y <= a and b;
  seq : process (clk) is
    variable cnt : integer;
  begin
    if rising_edge(clk) then cnt := cnt + 1; end if;
  end process seq;
  process (a) begin end process;
  u_add : entity work.adder port map (x => s1, z => s2);
  u_cmp : adder port map (x => s1, z => s2);
  g : for i in 0 to 3 generate
    u_n : entity work.nand2 port map (a => a(i));
  end generate g;
end architecture;

package util is
  constant N : natural := 3;
end package;
package body util is
  procedure p is begin null; end procedure;
end package body;
`;
  const syms = parseHdl(src, 'vhdl');

  it('finds design units', () => {
    expect(syms.map((s) => [s.kind, s.name, s.detail])).toEqual([
      ['entity', 'alu', ''],
      ['architecture', 'rtl', 'of alu'],
      ['package', 'util', ''],
      ['package', 'util', 'body'],
    ]);
  });
  it('reads generics and ports', () => {
    const e = syms[0];
    expect(names(e.children, 'parameter')).toEqual(['WIDTH', 'DEPTH']);
    expect(find(syms, 'WIDTH').value).toBe('8');
    expect(e.children.filter((c) => c.kind === 'port').map((p) => [p.name, p.dir])).toEqual([
      ['a', 'in'],
      ['b', 'in'],
      ['y', 'out'],
    ]);
  });
  it('reads architecture declarations and statements', () => {
    const a = syms[1];
    expect(a.children.map((c) => [c.kind, c.name])).toEqual([
      ['type', 'state_t'],
      ['signal', 's1'],
      ['signal', 's2'],
      ['constant', 'ZERO'],
      ['component', 'adder'],
      ['function', 'f'],
      ['process', 'seq'],
      ['process', 'process (a)'],
      ['instance', 'u_add'],
      ['instance', 'u_cmp'],
      ['generate', 'g'],
    ]);
    expect(find(syms, 'u_add').of).toBe('adder');
    expect(names(find(syms, 'g').children)).toEqual(['u_n']);
    expect(names(find(syms, 'adder').children)).toEqual(['x', 'z']);
    expect(find(syms, 'p').kind).toBe('task');
  });
});

describe('instance template', () => {
  it('builds a Verilog instance with aligned named connections', () => {
    const m = parseHdl('module fifo #(parameter W = 8, localparam L = 2) (input clk, input [W-1:0] din, output full); endmodule', 'verilog')[0];
    expect(instanceTemplate(m, 'verilog')).toBe(
      ['fifo #(', '  .W    (W)', ') u_fifo (', '  .clk  (clk),', '  .din  (din),', '  .full (full)', ');'].join('\n'),
    );
  });
  it('handles modules with no parameters or ports', () => {
    const m = parseHdl('module top; endmodule', 'verilog')[0];
    expect(instanceTemplate(m, 'verilog')).toBe('top u_top ();');
  });
  it('builds a VHDL entity instance', () => {
    const e = parseHdl('entity e is generic (N : integer := 1); port (clk : in bit; dout : out bit); end;', 'vhdl')[0];
    expect(instanceTemplate(e, 'vhdl', '  ')).toBe(
      [
        'u_e : entity work.e',
        '  generic map (',
        '    N    => N',
        '  )',
        '  port map (',
        '    clk  => clk,',
        '    dout => dout',
        '  );',
      ].join('\n'),
    );
  });
});

describe('align statements', () => {
  it('aligns nonblocking and blocking assignments separately', () => {
    expect(alignLines(['  a <= 1;', '  long_name <= b;', '  x = 2;', '  yy = 3;'], 'verilog')).toEqual([
      '  a         <= 1;',
      '  long_name <= b;',
      '  x  = 2;',
      '  yy = 3;',
    ]);
  });
  it('aligns continuous assigns and trailing comments', () => {
    expect(alignLines(['assign a = b; // one', 'assign ccc = d;  // two', 'assign e = f;'], 'verilog')).toEqual([
      'assign a   = b; // one',
      'assign ccc = d; // two',
      'assign e   = f;',
    ]);
  });
  it('aligns port declarations into columns', () => {
    expect(alignLines(['input wire clk,', 'input [7:0] data,', 'output reg [W-1:0] q'], 'verilog')).toEqual([
      'input  wire         clk,',
      'input       [7:0]   data,',
      'output reg  [W-1:0] q',
    ]);
  });
  it('aligns port connections', () => {
    expect(alignLines(['  .clk(clk),', '  .data_in (d),', '  .q(q)'], 'verilog')).toEqual([
      '  .clk     (clk),',
      '  .data_in (d),',
      '  .q       (q)',
    ]);
  });
  it('leaves conditions, loops and differing indentation alone', () => {
    const lines = ['if (a <= b) x = 1;', 'for (i = 0; i < 4; i++)', '  y = 2;', 'zz = 3;'];
    expect(alignLines(lines, 'verilog')).toEqual(lines);
  });
  it('is idempotent', () => {
    const once = alignLines(['a <= 1;', 'bbb <= 2; // c'], 'verilog');
    expect(alignLines(once, 'verilog')).toEqual(once);
  });
  it('aligns VHDL signals, ports, maps and assignments', () => {
    expect(alignLines(['signal a : std_logic;', 'signal long_name : integer := 0;'], 'vhdl')).toEqual([
      'signal a         : std_logic;',
      'signal long_name : integer := 0;',
    ]);
    expect(alignLines(['clk : in std_logic;', 'data_out : out std_logic_vector(7 downto 0)'], 'vhdl')).toEqual([
      'clk      : in  std_logic;',
      'data_out : out std_logic_vector(7 downto 0)',
    ]);
    expect(alignLines(['x => a,', 'long => b'], 'vhdl')).toEqual(['x    => a,', 'long => b']);
    expect(alignLines(['y <= a;', 'zz <= b;', 'v := 1;'], 'vhdl')).toEqual(['y  <= a;', 'zz <= b;', 'v := 1;']);
  });
  it('finds the block around a line', () => {
    const lines = ['a = 1;', 'bb = 2;', '', 'c <= 3;'];
    expect(blockAround(lines, 1, 'verilog')).toEqual([0, 1]);
    expect(blockAround(lines, 3, 'verilog')).toBeNull();
    expect(blockAround(lines, 2, 'verilog')).toBeNull();
  });
});

describe('moduleNameRanges', () => {
  const names = (text: string, lang: 'verilog' | 'vhdl') =>
    moduleNameRanges(parseHdl(text, lang), text).map((r) => `${r.start}:${text.slice(r.start, r.end)}`);

  it('finds Verilog module declarations and instantiated modules', () => {
    const src = [
      'module top;',
      '  alu #(.W(8)) u_alu (.a(a));',
      '  fifo f0 (.clk(clk));',
      'endmodule',
      'module alu; endmodule',
      '',
    ].join('\n');
    expect(names(src, 'verilog')).toEqual([
      `${src.indexOf('top')}:top`,
      `${src.indexOf('alu')}:alu`,
      `${src.indexOf('fifo')}:fifo`,
      `${src.lastIndexOf('alu')}:alu`,
    ]);
  });

  it('finds VHDL entities and entity instances', () => {
    const src = [
      'entity alu is',
      'end entity;',
      'architecture rtl of top is',
      'begin',
      '  u0: entity work.alu port map (a => a);',
      'end architecture;',
      '',
    ].join('\n');
    const r = names(src, 'vhdl');
    expect(r[0]).toBe(`${src.indexOf('alu')}:alu`);
    expect(r).toContain(`${src.lastIndexOf('alu')}:alu`);
  });
});

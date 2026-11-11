// "Copy as Instance": build a ready-to-paste instantiation of a module / entity. Pure.

import type { HdlLang } from './lex';
import type { HdlSymbol } from './symbols';

const pad = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - s.length));

/** Instantiation text for `unit` (a module, interface, program, entity or component). */
export function instanceTemplate(unit: HdlSymbol, lang: HdlLang, indent = '  '): string {
  const params = unit.children.filter((c) => c.kind === 'parameter' && c.overridable);
  const ports = unit.children.filter((c) => c.kind === 'port');
  const inst = `u_${unit.name}`;

  if (lang === 'verilog') {
    // Parameters stay on the header line; only the ports are stacked.
    const w = Math.max(0, ...ports.map((p) => p.name.length)) + 1;
    const conn = (names: string[]) => names.map((n, i) => `${indent}.${pad(n, w)}(${n})${i < names.length - 1 ? ',' : ''}`);
    const paramList = params.map((p) => `.${p.name}(${p.name})`).join(', ');
    const lines = [params.length ? `${unit.name} #(${paramList}) ${inst} (` : `${unit.name} ${inst} (`];
    if (ports.length === 0) {
      lines[lines.length - 1] += ');';
      return lines.join('\n');
    }
    lines.push(...conn(ports.map((p) => p.name)), ');');
    return lines.join('\n');
  }

  const w = Math.max(0, ...params.map((p) => p.name.length), ...ports.map((p) => p.name.length));
  const map = (names: string[]) =>
    names.map((n, i) => `${indent}${indent}${pad(n, w)} => ${n}${i < names.length - 1 ? ',' : ''}`);
  const head = unit.kind === 'component' ? `${inst} : ${unit.name}` : `${inst} : entity work.${unit.name}`;
  const lines = [head];
  if (params.length) lines.push(`${indent}generic map (`, ...map(params.map((p) => p.name)), `${indent})`);
  if (ports.length) lines.push(`${indent}port map (`, ...map(ports.map((p) => p.name)), `${indent})`);
  lines[lines.length - 1] += ';';
  return lines.join('\n');
}

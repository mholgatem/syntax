import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { detectLanguage, fileHandlerAccept, LANGUAGES, UNCLAIMED_EXTENSIONS } from '../src/editor/languages';
import { buildZip, uniqueNames } from '../src/io/zip';
import { decodeText, detectEol, encodeText, hashText, isProbablyBinary } from '../src/io/text';
import { SCHEMES, toMonacoTheme } from '../src/editor/themes';

describe('detectLanguage', () => {
  it.each([
    ['top.v', 'verilog'],
    ['defs.vh', 'verilog'],
    ['TOP.V', 'verilog'],
    ['tb.sv', 'systemverilog'],
    ['pkg.svh', 'systemverilog'],
    ['if.svi', 'systemverilog'],
    ['props.sva', 'systemverilog'],
    ['alu.vhd', 'vhdl'],
    ['alu.vhdl', 'vhdl'],
    ['pins.xdc', 'tcl'],
    ['timing.sdc', 'tcl'],
    ['build.tcl', 'tcl'],
    ['main.c', 'c'],
    ['main.cpp', 'cpp'],
    ['x.hpp', 'cpp'],
    ['a.py', 'python'],
    ['a.ts', 'typescript'],
    ['a.tsx', 'typescript'],
    ['a.js', 'javascript'],
    ['a.rs', 'rust'],
    ['a.go', 'go'],
    ['a.java', 'java'],
    ['a.cs', 'csharp'],
    ['a.json', 'json'],
    ['a.yml', 'yaml'],
    ['README.md', 'markdown'],
    ['Makefile', 'shell'],
    ['Dockerfile', 'dockerfile'],
    ['Dockerfile.dev', 'dockerfile'],
    ['C:\\proj\\rtl\\core.sv', 'systemverilog'],
    ['src/lib/util.rb', 'ruby'],
    ['noext', 'plaintext'],
    ['weird.zzz', 'plaintext'],
  ])('%s -> %s', (name, id) => {
    expect(detectLanguage(name)).toBe(id);
  });

  it('has no extension claimed by two languages', () => {
    const seen = new Map<string, string>();
    for (const l of LANGUAGES) {
      for (const ext of l.extensions) {
        expect(seen.get(ext), `${ext} in ${l.id} and ${seen.get(ext)}`).toBeUndefined();
        seen.set(ext, l.id);
      }
    }
  });
});

describe('fileHandlerAccept', () => {
  const accept = fileHandlerAccept();
  const claimed = Object.values(accept).flat();

  it('gives each language family its own MIME type', () => {
    expect(accept['text/x-verilog']).toContain('.v');
    expect(accept['text/x-systemverilog']).toContain('.sv');
    expect(accept['text/x-vhdl']).toEqual(['.vhd', '.vhdl', '.vho', '.vht']);
    expect(accept['text/x-tcl']).toContain('.xdc');
    expect(accept['text/x-python']).toEqual(['.py', '.pyi']);
    expect(accept['text/plain']).toBeUndefined();
    for (const mime of Object.keys(accept)) expect(mime).toMatch(/^(text|application)\/[a-z0-9.+-]+$/);
  });

  it('does not claim the excluded extensions', () => {
    for (const ext of UNCLAIMED_EXTENSIONS) expect(claimed).not.toContain(ext);
    // Families left with no extensions are dropped entirely.
    expect(accept['text/x-html']).toBeUndefined();
    expect(accept['text/x-bat']).toBeUndefined();
  });

  it('still detects languages for unclaimed extensions', () => {
    expect(detectLanguage('index.html')).toBe('html');
    expect(detectLanguage('notes.txt')).toBe('plaintext');
    expect(detectLanguage('x.svi')).toBe('systemverilog');
  });

  it('claims each extension once', () => {
    expect(new Set(claimed).size).toBe(claimed.length);
  });
});

describe('uniqueNames', () => {
  it('suffixes duplicates before the extension', () => {
    expect(uniqueNames(['a.v', 'a.v', 'A.V', 'b'])).toEqual(['a.v', 'a (2).v', 'A (3).V', 'b']);
  });
  it('sanitizes path separators and empty names', () => {
    expect(uniqueNames(['x/y.txt', '  '])).toEqual(['x_y.txt', 'untitled']);
  });
  it('does not collide with an existing suffixed name', () => {
    expect(uniqueNames(['a (2).v', 'a.v', 'a.v'])).toEqual(['a (2).v', 'a.v', 'a (3).v']);
  });
});

describe('buildZip', () => {
  it('round-trips file contents', () => {
    const zip = buildZip([
      { name: 'top.sv', data: encodeText('module top; endmodule\n', 'UTF-8') },
      { name: 'top.sv', data: encodeText('// second', 'UTF-8') },
    ]);
    const files = unzipSync(zip);
    expect(Object.keys(files).sort()).toEqual(['top (2).sv', 'top.sv']);
    expect(strFromU8(files['top.sv'])).toBe('module top; endmodule\n');
    expect(strFromU8(files['top (2).sv'])).toBe('// second');
  });
});

describe('text encoding', () => {
  it('round-trips every supported encoding', () => {
    const text = 'héllo — 世界 🎉\r\nline2';
    for (const enc of ['UTF-8', 'UTF-8 BOM', 'UTF-16 LE', 'UTF-16 BE'] as const) {
      const decoded = decodeText(encodeText(text, enc));
      expect(decoded).toEqual({ text, encoding: enc });
    }
  });
  it('detects binary data but not UTF-16 text', () => {
    expect(isProbablyBinary(new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0, 1]))).toBe(true);
    expect(isProbablyBinary(encodeText('plain', 'UTF-8'))).toBe(false);
    expect(isProbablyBinary(encodeText('wide', 'UTF-16 LE'))).toBe(false);
  });
  it('detects majority line ending', () => {
    expect(detectEol('a\r\nb\r\nc\nd')).toBe('CRLF');
    expect(detectEol('a\nb\r\nc\n')).toBe('LF');
    expect(detectEol('single line')).toBe('LF');
  });
  it('hashes deterministically and distinguishes edits', () => {
    expect(hashText('abc')).toBe(hashText('abc'));
    expect(hashText('abc')).not.toBe(hashText('abd'));
  });
});

describe('themes', () => {
  it('every scheme produces valid light and dark Monaco themes', () => {
    for (const s of SCHEMES) {
      for (const mode of ['light', 'dark'] as const) {
        const t = toMonacoTheme(s[mode], mode);
        expect(t.base).toBe(mode === 'dark' ? 'vs-dark' : 'vs');
        for (const r of t.rules) expect(r.foreground).toMatch(/^[0-9a-f]{6}$/i);
        for (const c of Object.values(t.colors)) expect(c).toMatch(/^#[0-9a-f]{6}([0-9a-f]{2})?$/i);
      }
    }
  });
});

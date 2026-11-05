import { describe, expect, it } from 'vitest';
import { BACKUP_KEY, ICON_FILE, buildIco, fixIconsScript, toBase64, undoIconsScript } from '../src/io/iconFix';

const fakePng = (n: number, fill: number) => new Uint8Array(n).fill(fill);

describe('buildIco', () => {
  const images = [
    { size: 16, png: fakePng(10, 1) },
    { size: 48, png: fakePng(20, 2) },
    { size: 256, png: fakePng(30, 3) },
  ];
  const ico = buildIco(images);
  const view = new DataView(ico.buffer);

  it('writes an icon header with one entry per image', () => {
    expect(view.getUint16(0, true)).toBe(0);
    expect(view.getUint16(2, true)).toBe(1);
    expect(view.getUint16(4, true)).toBe(3);
    expect(ico.length).toBe(6 + 16 * 3 + 60);
  });

  it('encodes sizes, with 256 as 0', () => {
    const sizes = images.map((_, i) => [ico[6 + 16 * i], ico[7 + 16 * i]]);
    expect(sizes).toEqual([[16, 16], [48, 48], [0, 0]]);
  });

  it('points each entry at its PNG data', () => {
    images.forEach((img, i) => {
      const e = 6 + 16 * i;
      expect(view.getUint16(e + 4, true)).toBe(1);
      expect(view.getUint16(e + 6, true)).toBe(32);
      const len = view.getUint32(e + 8, true);
      const off = view.getUint32(e + 12, true);
      expect(len).toBe(img.png.length);
      expect([...ico.subarray(off, off + len)]).toEqual([...img.png]);
    });
  });
});

describe('icon scripts', () => {
  const b64 = toBase64(buildIco([{ size: 16, png: fakePng(40, 7) }]));
  const scripts = { fix: fixIconsScript(b64), undo: undoIconsScript() };

  it.each(Object.entries(scripts))('%s script is ASCII with CRLF line endings', (_, s) => {
    expect(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(s)).toBe(true);
    expect(s.includes('\r\n')).toBe(true);
    expect(/[^\r]\n/.test(s)).toBe(false);
  });

  it.each(Object.entries(scripts))('%s script only touches the current user', (_, s) => {
    expect(s).toContain('[Microsoft.Win32.Registry]::CurrentUser');
    expect(s).not.toMatch(/HKLM|HKEY_LOCAL_MACHINE|LocalMachine|RunAs/i);
  });

  it('fix script embeds the icon and saves a backup', () => {
    expect(scripts.fix).toContain(`$IconData = '${b64}'`);
    expect(scripts.fix).toContain(BACKUP_KEY);
    expect(scripts.fix).toContain(ICON_FILE);
  });

  it('undo script uses the same backup key and icon path', () => {
    expect(scripts.undo).toContain(`$BackupKey = '${BACKUP_KEY}'`);
    expect(scripts.undo).toContain(ICON_FILE);
    expect(scripts.undo).not.toContain('$IconData');
  });
});

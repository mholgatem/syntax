// Byte <-> text helpers. Pure functions so they can be unit tested.

export type Encoding = 'UTF-8' | 'UTF-8 BOM' | 'UTF-16 LE' | 'UTF-16 BE';
export type Eol = 'LF' | 'CRLF';

/** Heuristic: a NUL byte in the first 8 KB means binary (unless it's UTF-16). */
export function isProbablyBinary(bytes: Uint8Array): boolean {
  if (detectBom(bytes).encoding.startsWith('UTF-16')) return false;
  const n = Math.min(bytes.length, 8192);
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true;
  return false;
}

function detectBom(bytes: Uint8Array): { encoding: Encoding; skip: number } {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { encoding: 'UTF-8 BOM', skip: 3 };
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { encoding: 'UTF-16 LE', skip: 2 };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { encoding: 'UTF-16 BE', skip: 2 };
  return { encoding: 'UTF-8', skip: 0 };
}

export function decodeText(bytes: Uint8Array): { text: string; encoding: Encoding } {
  const { encoding, skip } = detectBom(bytes);
  const label = encoding === 'UTF-16 LE' ? 'utf-16le' : encoding === 'UTF-16 BE' ? 'utf-16be' : 'utf-8';
  const text = new TextDecoder(label).decode(bytes.subarray(skip));
  return { text, encoding };
}

export function encodeText(text: string, encoding: Encoding): Uint8Array {
  if (encoding === 'UTF-8') return new TextEncoder().encode(text);
  if (encoding === 'UTF-8 BOM') {
    const body = new TextEncoder().encode(text);
    const out = new Uint8Array(body.length + 3);
    out.set([0xef, 0xbb, 0xbf]);
    out.set(body, 3);
    return out;
  }
  const le = encoding === 'UTF-16 LE';
  const out = new Uint8Array(2 + text.length * 2);
  out.set(le ? [0xff, 0xfe] : [0xfe, 0xff]);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    out[2 + i * 2] = le ? c & 0xff : c >> 8;
    out[3 + i * 2] = le ? c >> 8 : c & 0xff;
  }
  return out;
}

/** Majority line ending; defaults to LF for files with no newlines. */
export function detectEol(text: string): Eol {
  let crlf = 0;
  let lf = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      if (i > 0 && text.charCodeAt(i - 1) === 13) crlf++;
      else lf++;
    }
  }
  return crlf > lf ? 'CRLF' : 'LF';
}

/** Small, fast, non-cryptographic hash (FNV-1a) used to detect saved-content matches. */
export function hashText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16) + ':' + text.length;
}

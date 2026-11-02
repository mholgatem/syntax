import { zipSync } from 'fflate';

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

/** Make names unique: "a.v", "a.v" -> "a.v", "a (2).v". Case-insensitive, like most file systems. */
export function uniqueNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((raw) => {
    const name = sanitizeName(raw);
    if (!used.has(name.toLowerCase())) {
      used.add(name.toLowerCase());
      return name;
    }
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    for (let n = 2; ; n++) {
      const candidate = `${stem} (${n})${ext}`;
      if (!used.has(candidate.toLowerCase())) {
        used.add(candidate.toLowerCase());
        return candidate;
      }
    }
  });
}

function sanitizeName(name: string): string {
  const cleaned = name.replace(/[\/:*?"<>|\u0000-\u001f]/g, '_').trim();
  return cleaned || 'untitled';
}

export function buildZip(entries: ZipEntry[]): Uint8Array {
  const names = uniqueNames(entries.map((e) => e.name));
  const files: Record<string, Uint8Array> = {};
  entries.forEach((e, i) => (files[names[i]] = e.data));
  return zipSync(files, { level: 6 });
}

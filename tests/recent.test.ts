import { describe, expect, it, vi } from 'vitest';

vi.mock('idb-keyval', () => ({ get: vi.fn(async () => undefined), set: vi.fn(async () => undefined) }));

const { withEntry, withoutHandle, MAX_RECENT } = await import('../src/state/recent');

// Fake file handles: two handles are "the same file" when their paths match.
const h = (path: string) => ({ path }) as unknown as FileSystemFileHandle;
const same = async (a: FileSystemFileHandle, b: FileSystemFileHandle) =>
  (a as unknown as { path: string }).path === (b as unknown as { path: string }).path;
const entry = (path: string, t = 0) => ({ name: path.split('/').pop()!, handle: h(path), closedAt: t });

describe('recent files list', () => {
  it('puts the newest entry first', async () => {
    let list = await withEntry([], entry('/a.v', 1), same);
    list = await withEntry(list, entry('/b.v', 2), same);
    expect(list.map((e) => e.name)).toEqual(['b.v', 'a.v']);
  });
  it('moves a re-closed file to the front instead of duplicating it', async () => {
    let list = [entry('/b.v'), entry('/a.v'), entry('/c.v')];
    list = await withEntry(list, entry('/a.v', 9), same);
    expect(list.map((e) => e.name)).toEqual(['a.v', 'b.v', 'c.v']);
    expect(list[0].closedAt).toBe(9);
  });
  it(`keeps at most ${MAX_RECENT} entries`, async () => {
    let list: ReturnType<typeof entry>[] = [];
    for (let i = 0; i < MAX_RECENT + 5; i++) list = await withEntry(list, entry(`/f${i}.v`, i), same);
    expect(list).toHaveLength(MAX_RECENT);
    expect(list[0].name).toBe(`f${MAX_RECENT + 4}.v`);
  });
  it('removes a file that was reopened', async () => {
    const list = await withoutHandle([entry('/a.v'), entry('/b.v')], h('/a.v'), same);
    expect(list.map((e) => e.name)).toEqual(['b.v']);
  });
});

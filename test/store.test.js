import { describe, it, expect } from 'vitest';
import { createScoreStore, mergeEntry, propKey } from '../src/core/store.js';
import { rankBoard, championBoard } from '../src/core/ranking.js';

// In-memory Confluence with real version checks. Every call yields to the
// event loop, so concurrent saves genuinely interleave.
function fakeClient({ forbidWrites = false, failNetwork = () => false } = {}) {
  const props = new Map();
  const tick = () => new Promise(r => setTimeout(r, 0));
  return {
    pageId: 'p1',
    props,
    async getProperty(key) {
      await tick();
      if (failNetwork()) return { status: 'network' };
      const p = props.get(key);
      return p ? { status: 'ok', value: structuredClone(p.value), version: p.version } : { status: 'notFound' };
    },
    async createProperty(key, value) {
      await tick();
      if (failNetwork()) return { status: 'network' };
      if (forbidWrites) return { status: 'forbidden' };
      if (props.has(key)) return { status: 'conflict' };
      props.set(key, { value: structuredClone(value), version: 1 });
      return { status: 'ok' };
    },
    async updateProperty(key, value, next) {
      await tick();
      if (failNetwork()) return { status: 'network' };
      if (forbidWrites) return { status: 'forbidden' };
      const p = props.get(key);
      if (!p || p.version + 1 !== next) return { status: 'conflict' };
      props.set(key, { value: structuredClone(value), version: next });
      return { status: 'ok' };
    },
  };
}

function memStorage() {
  const m = new Map();
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) };
}

const opts = client => ({ client, storage: memStorage(), sleep: () => Promise.resolve(), random: () => 0.5 });
const u = (key, name = key) => ({ key, name });
const base = { game: 'reaction', week: '2026-W47', better: 'higher' };

describe('mergeEntry', () => {
  it('keeps the better score only', () => {
    let { value } = mergeEntry(null, { ...base, user: u('a'), score: 100, at: 't1' }, 'higher');
    const worse = mergeEntry(value, { ...base, user: u('a'), score: 50, at: 't2' }, 'higher');
    expect(worse.improved).toBe(false);
    expect(worse.value.entries.a.score).toBe(100);
    const lower = mergeEntry(null, { ...base, user: u('a'), score: 41, at: 't' }, 'lower');
    expect(mergeEntry(lower.value, { ...base, user: u('a'), score: 45, at: 't' }, 'lower').improved).toBe(false);
    expect(mergeEntry(lower.value, { ...base, user: u('a'), score: 39, at: 't' }, 'lower').improved).toBe(true);
  });
});

describe('score store', () => {
  it('creates the property on first save, then updates', async () => {
    const c = fakeClient(); const s = createScoreStore(opts(c));
    expect((await s.submit({ ...base, user: u('a'), score: 10 })).status).toBe('saved');
    expect((await s.submit({ ...base, user: u('a'), score: 5 })).status).toBe('notBest');
    expect((await s.submit({ ...base, user: u('a'), score: 20 })).status).toBe('saved');
    expect(c.props.get(propKey('2026-W47', 'reaction'))).toMatchObject({ version: 2, value: { entries: { a: { score: 20 } } } });
  });

  it('two players saving at the same instant both keep their score (create race)', async () => {
    const c = fakeClient(); const s = createScoreStore(opts(c));
    const r = await Promise.all([
      s.submit({ ...base, user: u('a'), score: 10 }),
      s.submit({ ...base, user: u('b'), score: 20 }),
    ]);
    expect(r.map(x => x.status)).toEqual(['saved', 'saved']);
    expect(Object.keys(c.props.get(propKey('2026-W47', 'reaction')).value.entries).sort()).toEqual(['a', 'b']);
  });

  it('five players at once all land (update race)', async () => {
    const c = fakeClient(); const s = createScoreStore(opts(c));
    await s.submit({ ...base, user: u('seed'), score: 1 });
    const r = await Promise.all(['a', 'b', 'c', 'd', 'e'].map((k, i) => s.submit({ ...base, user: u(k), score: i + 2 })));
    expect(r.every(x => x.status === 'saved')).toBe(true);
    expect(Object.keys(c.props.get(propKey('2026-W47', 'reaction')).value.entries)).toHaveLength(6);
  });

  it('view-only users are reported, not queued', async () => {
    const c = fakeClient({ forbidWrites: true }); const s = createScoreStore(opts(c));
    expect((await s.submit({ ...base, user: u('a'), score: 10 })).status).toBe('viewOnly');
    expect(s.pending()).toBe(0);
  });

  it('queues on network failure and flushes later, keeping only the best', async () => {
    let down = true;
    const c = fakeClient({ failNetwork: () => down }); const s = createScoreStore(opts(c));
    expect((await s.submit({ ...base, user: u('a'), score: 10 })).status).toBe('queued');
    await s.submit({ ...base, user: u('a'), score: 30 });
    await s.submit({ ...base, user: u('a'), score: 20 });
    expect(s.pending()).toBe(1);
    down = false;
    expect(await s.flushQueue()).toEqual({ sent: 1, left: 0 });
    expect(c.props.get(propKey('2026-W47', 'reaction')).value.entries.a.score).toBe(30);
  });

  it('loadBoard returns an empty board when nothing saved yet', async () => {
    const s = createScoreStore(opts(fakeClient()));
    expect(await s.loadBoard('reaction', '2026-W47')).toEqual({ status: 'ok', board: { game: 'reaction', week: '2026-W47', entries: {} } });
  });
});

describe('ranking', () => {
  const board = entries => ({ entries });
  it('ranks higher-is-better with shared places for ties, earliest first', () => {
    const r = rankBoard(board({
      a: { name: 'A', score: 100, at: '2026-11-18T03:00Z' },
      b: { name: 'B', score: 200, at: '2026-11-18T04:00Z' },
      c: { name: 'C', score: 100, at: '2026-11-18T02:00Z' },
      d: { name: 'D', score: 50, at: '2026-11-18T01:00Z' },
    }), 'higher');
    expect(r.map(x => [x.key, x.place, x.points])).toEqual([['b', 1, 10], ['c', 2, 8], ['a', 2, 8], ['d', 4, 5]]);
  });
  it('ranks lower-is-better', () => {
    const r = rankBoard(board({ a: { name: 'A', score: 45, at: '1' }, b: { name: 'B', score: 41, at: '2' } }), 'lower');
    expect(r.map(x => x.key)).toEqual(['b', 'a']);
  });
  it('gives 0 points past 8th place', () => {
    const e = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`p${i}`, { name: `P${i}`, score: 100 - i, at: '1' }]));
    expect(rankBoard(board(e), 'higher').map(x => x.points)).toEqual([10, 8, 6, 5, 4, 3, 2, 1, 0, 0]);
  });
  it('sums champion points across games', () => {
    const ranked = {
      reaction: rankBoard(board({ a: { name: 'A', score: 9, at: '1' }, b: { name: 'B', score: 5, at: '1' } }), 'higher'),
      memory: rankBoard(board({ b: { name: 'B', score: 30, at: '1' } }), 'lower'),
    };
    const champ = championBoard(ranked);
    expect(champ.map(x => [x.key, x.score, x.place])).toEqual([['b', 18, 1], ['a', 10, 2]]);
  });
});

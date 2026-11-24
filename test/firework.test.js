import { describe, it, expect } from 'vitest';
import {
  createShow, addSparker, submit, rate, step, snapshot, showStats, showSummary, isOver, artFor, cleanArt,
  DRAW_SECONDS, SUBMIT_GRACE_MS, SHOW_MS, MAX_POINTS, COLORS, SKY_TOP, SHOW_SECONDS, MAX_PLAYERS,
} from '../src/party/firework.js';

const START = 1_000_000;
const DRAW_END = START + DRAW_SECONDS * 1000;
const heart = [{ c: COLORS[0], pts: [400, 200, 350, 150, 300, 200, 400, 300, 500, 200, 450, 150, 400, 200] }];
const show = (n = 3) => {
  const sim = createShow('seed', { startAt: START });
  for (let i = 0; i < n; i++) addSparker(sim, `p${i}`, `P${i}`);
  return sim;
};
const toShow = sim => { step(sim, DRAW_END + SUBMIT_GRACE_MS); return sim; };

describe('water festival firework show (draw and rate)', () => {
  it('cleans drawings: palette colours, inside the sky, point limit', () => {
    const art = cleanArt([{ c: 'javascript:x', pts: [-50, 0, 900, 999, 'a', 3] }, { c: COLORS[2], pts: [1] }, 'junk']);
    expect(art).toEqual([{ c: COLORS[0], pts: [0, SKY_TOP, 800, 400] }]);
    const huge = cleanArt([{ c: COLORS[1], pts: Array.from({ length: 5000 }, (_, i) => i % 400) }]);
    expect(huge[0].pts.length / 2).toBe(MAX_POINTS);
    expect(cleanArt(null)).toEqual([]);
  });

  it('players draw, may update their drawing, and only before time is up', () => {
    const sim = show();
    expect(submit(sim, 'p0', heart, START + 5000)).toEqual({ kind: 'saved', points: 7 });
    expect(submit(sim, 'p0', [{ c: COLORS[1], pts: [10, 100, 20, 120] }], START + 9000).points).toBe(2);
    expect(artFor(sim, 0)).toBeNull();
    expect(sim.art.p0[0].c).toBe(COLORS[1]);
    expect(submit(sim, 'p1', heart, DRAW_END + SUBMIT_GRACE_MS + 1)).toEqual({ kind: 'invalid' });
    expect(submit(sim, 'ghost', heart, START)).toEqual({ kind: 'invalid' });
    expect(snapshot(sim)).toMatchObject({ phase: 'draw', ready: ['p0'], of: 3 });
  });

  it('launches each drawing in turn, rated 1-5 by everyone but the artist, then names it', () => {
    const sim = show(4);
    for (const k of ['p0', 'p1', 'p2']) submit(sim, k, heart, START + 1000);
    toShow(sim);
    expect(sim.phase).toBe('show');
    expect([...sim.order].sort()).toEqual(['p0', 'p1', 'p2']); // p3 drew nothing, so no firework
    expect(sim.events).toEqual([expect.objectContaining({ e: 'show', i: 0, n: 3 })]);
    const artist = sim.order[0];
    const others = ['p0', 'p1', 'p2', 'p3'].filter(k => k !== artist);
    expect(rate(sim, artist, 0, 5)).toEqual({ kind: 'own' });
    expect(rate(sim, others[0], 0, 9)).toEqual({ kind: 'invalid' });
    expect(rate(sim, others[0], 1, 4)).toEqual({ kind: 'invalid' }); // not in the sky yet
    rate(sim, others[0], 0, 2); rate(sim, others[0], 0, 5); // changed their mind
    rate(sim, others[1], 0, 4); rate(sim, others[2], 0, 3);
    expect(snapshot(sim)).toMatchObject({ votes: 3, artist, i: 0 });
    step(sim, DRAW_END + SUBMIT_GRACE_MS + SHOW_MS);
    expect(sim.events).toContainEqual({ e: 'rated', i: 0, key: artist, name: artist.toUpperCase(), avg: 4, n: 3 });
    expect(sim.events).toContainEqual(expect.objectContaining({ e: 'show', i: 1 }));
    expect(sim.players[others[0]].given).toBe(1);
  });

  it('ranks by average stars and ends after the last firework', () => {
    const sim = show(3);
    for (const k of ['p0', 'p1', 'p2']) submit(sim, k, heart, START + 1000);
    toShow(sim);
    const want = { p0: 5, p1: 2, p2: 4 };
    let t = DRAW_END + SUBMIT_GRACE_MS;
    while (!isOver(sim)) {
      const artist = sim.order[sim.i];
      for (const k of Object.keys(want)) if (k !== artist) rate(sim, k, sim.i, want[artist]);
      t += SHOW_MS; step(sim, t);
    }
    expect(t - START).toBeLessThan(SHOW_SECONDS * 1000);
    expect(showStats(sim)).toMatchObject({ p0: { score: 500, hits: 2 }, p1: { score: 200 }, p2: { score: 400 } });
    const sum = showSummary(sim);
    expect(sum.ranked.map(r => r.name)).toEqual(['P0', 'P2', 'P1']);
    expect(sum).toMatchObject({ drew: 3, noArt: [], fan: { given: 2 } });
  });

  it('nobody drew: the show ends straight away', () => {
    const sim = toShow(show(2));
    expect(isOver(sim)).toBe(true);
    expect(sim.events).toEqual([{ e: 'empty' }]);
    expect(showSummary(sim)).toMatchObject({ ranked: [], drew: 0, noArt: ['P0', 'P1'] });
  });

  it('caps the show at the player limit', () => {
    const sim = show(MAX_PLAYERS);
    expect(addSparker(sim, 'late', 'Late')).toBeNull();
  });
});

describe('firework GIF for the Telegram group', async () => {
  const { renderFireworkGif, isGif, toBase64, fromBase64, GW, GH } = await import('../src/party/firework-gif.js');
  it('renders a looping GIF of the drawing, small enough to send', async () => {
    const bytes = renderFireworkGif(heart, { seed: 's' });
    expect(isGif(bytes)).toBe(true);
    expect(bytes[6] | (bytes[7] << 8)).toBe(GW);
    expect(bytes[8] | (bytes[9] << 8)).toBe(GH);
    expect(bytes.length).toBeLessThan(600_000);
    expect(await renderFireworkGif(heart, { seed: 's', yieldEvery: 5 })).toEqual(bytes); // same result in steps
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
    expect(renderFireworkGif([], {})).toBeNull();
  });
});

describe('firework show starts early', () => {
  it('starts the show as soon as every player has launched a drawing', () => {
    const sim = show(2);
    submit(sim, 'p0', heart, START + 5000);
    step(sim, START + 9000);
    expect(sim.phase).toBe('draw'); // p1 is still drawing
    submit(sim, 'p1', heart, START + 10000);
    step(sim, START + 10100);
    expect(sim.phase).toBe('draw'); // a short beat first
    step(sim, START + 11700);
    expect(sim.phase).toBe('show');
    expect(sim.events).toEqual([expect.objectContaining({ e: 'show', i: 0, n: 2 })]);
  });
  it('a player clearing their drawing (or someone new joining) holds the start', () => {
    const sim = show(1);
    submit(sim, 'p0', heart, START + 5000);
    step(sim, START + 5100);
    addSparker(sim, 'p9', 'Late');
    step(sim, START + 7000);
    expect(sim.phase).toBe('draw');
    submit(sim, 'p9', heart, START + 8000);
    submit(sim, 'p0', [], START + 8100);
    step(sim, START + 8200); step(sim, START + 9900);
    expect(sim.phase).toBe('draw');
  });
});

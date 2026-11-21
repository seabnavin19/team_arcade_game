import { describe, it, expect } from 'vitest';
import { crewCount, assignCrews, createRace, addRower, paddle, step, standings, snapshot, raceStats, raceSummary, quality,
  COURSE, BEAT_MS, LEAD_IN_MS, MAX_SECONDS } from '../src/party/boat.js';

const party = (n, prefs = {}) => ({ startAt: 0, players: Object.fromEntries(Array.from({ length: n }, (_, i) => [`p${i}`, { name: `P${i}`, joinedAt: i, crew: prefs[`p${i}`] }])) });
function race(n, prefs) {
  const p = party(n, prefs);
  const sim = createRace('s', p);
  Object.keys(p.players).forEach(k => addRower(sim, k, p.players[k].name));
  return sim;
}
// Run the race; `tapper(key, beatTime)` returns the offset (ms) at which that player taps each beat, or null to skip.
function run(sim, tapper, maxMs = MAX_SECONDS * 1000 + 1000) {
  const tapped = new Set();
  for (let now = 0; now <= maxMs && !sim.over; now += 10) {
    for (const beat of sim.beats) for (const k of Object.keys(sim.players)) {
      const off = tapper(k, beat.t); const id = `${k}@${beat.t}`;
      if (off !== null && !tapped.has(id) && now >= beat.t + off) { tapped.add(id); paddle(sim, k, now, now); }
    }
    step(sim, now);
  }
  return sim;
}

describe('water festival boat race', () => {
  it('solo under 4 players, crews from 4', () => {
    expect([1, 2, 3, 4, 7, 8, 11, 12, 16].map(crewCount)).toEqual([0, 0, 0, 2, 2, 3, 3, 4, 4]);
    expect(race(3).mode).toBe('solo'); expect(race(3).boats).toHaveLength(3);
    expect(race(5).mode).toBe('crews'); expect(race(5).boats.map(b => b.name)).toEqual(['Naga', 'Hanuman']);
  });
  it('crew picks are honoured but crews stay even', () => {
    const all = assignCrews(['a', 'b', 'c', 'd', 'e', 'f'], { a: 0, b: 0, c: 0, d: 0, e: 1 });
    const sizes = [0, 0]; Object.values(all).forEach(c => sizes[c]++);
    expect(sizes).toEqual([3, 3]);
    expect([all.a, all.b, all.c, all.e]).toEqual([0, 0, 0, 1]);
  });
  it('judges strokes by distance from the beat; one stroke per beat', () => {
    expect([0, 80, 150, 250, 400].map(quality)).toEqual([1, 1, 0.75, 0.4, 0]);
    const sim = race(2); step(sim, LEAD_IN_MS); // first beat scheduled
    const t = sim.beats[0].t;
    expect(paddle(sim, 'p0', t + 30, t + 30)).toMatchObject({ q: 1 });
    expect(paddle(sim, 'p0', t + 40, t + 40)).toEqual({ q: 0 }); // second tap on the same beat doesn't count
    expect(paddle(sim, 'p1', t + 200, t + 200)).toMatchObject({ q: 0.4 });
    expect(paddle(sim, 'p1', t - 450, t - 450)).toEqual({ q: 0 });
    expect(sim.players.p1.miss).toBe(1);
  });
  it('a perfect solo paddler finishes in about 45–60 s; a sloppy one is slower; doing nothing never finishes', () => {
    const fast = run(race(1), () => 20);
    expect(fast.boats[0].finish / 1000).toBeGreaterThan(40); expect(fast.boats[0].finish / 1000).toBeLessThan(62);
    const sloppy = run(race(1), () => 170);
    expect(sloppy.boats[0].finish).toBeGreaterThan(fast.boats[0].finish);
    const idle = run(race(1), () => null);
    expect(idle.boats[0].finish).toBe(0); expect(idle.over).toBe(true);
  });
  it('a crew in sync beats an equally good crew out of sync', () => {
    // 4 players → 2 crews; crew 0 always taps together, crew 1 has one member skipping every other beat
    const sim = race(4, { p0: 0, p1: 0, p2: 1, p3: 1 });
    let n = 0;
    run(sim, (k, t) => (k === 'p3' && Math.round(t / BEAT_MS) % 2 ? null : 30));
    const [first] = standings(sim);
    expect(first.name).toBe('Naga');
    expect(sim.boats[0].bestSync).toBeGreaterThan(5);
    n++;
  });
  it('catch-up keeps races close: a decent paddler still finishes behind a perfect one', () => {
    const decent = run(race(2), k => (k === 'p0' ? 20 : 150));
    expect(decent.boats.every(b => b.finish)).toBe(true);
    expect(standings(decent)[0].name).toBe('P0');
    expect(decent.boats[1].finish - decent.boats[0].finish).toBeLessThan(10000);
    const sloppy = run(race(2), k => (k === 'p0' ? 20 : 250));
    expect(sloppy.boats[1].x).toBeGreaterThan(COURSE * 0.45);
    expect(standings(sloppy)[0].name).toBe('P0');
  });
  it('the drum speeds up on the final stretch', () => {
    const sim = run(race(1), () => 20);
    expect(sim.stretch).toBe(true);
  });
  it('race ends a few seconds after the first boat finishes', () => {
    const sim = race(2);
    run(sim, k => (k === 'p0' ? 20 : null));
    expect(sim.over).toBe(true);
    expect(sim.boats[0].finish).toBeGreaterThan(0); expect(sim.boats[1].finish).toBe(0);
    const st = raceStats(sim);
    expect(st.p0.score).toBeGreaterThan(st.p1.score);
    const sum = raceSummary(sim);
    expect(sum.boats[0]).toMatchObject({ name: 'P0', place: 1 });
    expect(sum.best).toMatchObject({ name: 'P0' });
    expect(sum.best.pct).toBeGreaterThan(90);
  });
  it('late joiners slot into the smallest crew; snapshot is small', () => {
    const sim = race(5);
    addRower(sim, 'late', 'Late');
    expect(sim.boats.map(b => b.members.length)).toEqual([3, 3]);
    step(sim, 2000);
    expect(JSON.stringify(snapshot(sim)).length).toBeLessThan(1500);
  });
});

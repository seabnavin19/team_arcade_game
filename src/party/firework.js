// Water Festival Firework Show (Bon Om Touk night): the rules the party room runs.
//
// 1. Draw: everyone draws their own firework at the same time (a lotus, a
//    naga, a heart, their initials… anything). Lines become sparks.
// 2. Show: the drawings are launched one by one over the Royal Palace, in a
//    random order and without names. Each rocket bursts into the drawing.
// 3. Rate: while a firework glows, everyone else gives it 1–5 stars.
//    The artist is revealed when the next one launches.
// Highest average rating wins. You can't rate your own.

import { createRng } from '../core/rng.js';

export const DRAW_SECONDS = 50, SUBMIT_GRACE_MS = 1500, SHOW_MS = 9000;
export const MAX_PLAYERS = 10, MAX_POINTS = 1600, MAX_STROKES = 120;
export const SHOW_SECONDS = DRAW_SECONDS + Math.ceil((SUBMIT_GRACE_MS + MAX_PLAYERS * SHOW_MS) / 1000) + 5;
export const TICK_MS = 250;
export const W = 800, H = 480, LAUNCH_Y = 418, SKY_TOP = 62, SKY_BOTTOM = 400;
export const COLORS = ['#ff4d5e', '#ffd23f', '#7dff6b', '#4dc3ff', '#ff6bd6', '#ff9f3f', '#b48bff', '#ffffff'];
export const IDEAS = ['a lotus', 'a naga', 'a heart', 'a dragon boat', 'Angkor Wat', 'a star', 'your initials', 'a smiley', 'a fish', 'a cat', 'a coconut tree', 'a rocket', 'a flower', 'the moon', 'a crown'];

/** Keep only a sane drawing: palette colours, points inside the sky, size limits. */
export function cleanArt(strokes) {
  if (!Array.isArray(strokes)) return [];
  const out = [];
  let used = 0;
  for (const s of strokes.slice(0, MAX_STROKES)) {
    if (!s || !Array.isArray(s.pts)) continue;
    const c = COLORS.includes(s.c) ? s.c : COLORS[0];
    const room = (MAX_POINTS - used) * 2;
    if (room < 2) break;
    const pts = [];
    for (let i = 0; i + 1 < s.pts.length && pts.length < room; i += 2) {
      const x = Number(s.pts[i]), y = Number(s.pts[i + 1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      pts.push(Math.round(Math.max(0, Math.min(W, x))), Math.round(Math.max(SKY_TOP, Math.min(SKY_BOTTOM, y))));
    }
    if (pts.length < 2) continue;
    used += pts.length / 2;
    out.push({ c, pts });
  }
  return out;
}

export function createShow(seed, p) {
  return {
    seed: String(seed), startAt: p.startAt, drawEnd: p.startAt + DRAW_SECONDS * 1000, lastNow: p.startAt,
    phase: 'draw', art: {}, order: [], i: -1, showAt: 0, ratings: {}, results: [],
    players: {}, names: {}, pending: [], events: [], over: false,
  };
}

export function addSparker(sim, key, name) {
  if (sim.players[key]) return sim.players[key];
  if (Object.keys(sim.players).length >= MAX_PLAYERS) return null;
  sim.names[key] = name;
  sim.players[key] = { given: 0 };
  return sim.players[key];
}

/** A player sends (or re-sends) their drawing. */
export function submit(sim, key, strokes, now) {
  if (!sim.players[key] || sim.phase !== 'draw' || now > sim.drawEnd + SUBMIT_GRACE_MS) return { kind: 'invalid' };
  const art = cleanArt(strokes);
  if (!art.length) { delete sim.art[key]; return { kind: 'saved', points: 0 }; }
  sim.art[key] = art;
  return { kind: 'saved', points: art.reduce((n, s) => n + s.pts.length / 2, 0) };
}

/** A star rating (1–5) for the firework in the sky now. You can change it until the next launch. */
export function rate(sim, key, i, stars) {
  if (!sim.players[key] || sim.phase !== 'show' || i !== sim.i) return { kind: 'invalid' };
  if (sim.order[i] === key) return { kind: 'own' };
  const s = Math.round(Number(stars));
  if (!(s >= 1 && s <= 5)) return { kind: 'invalid' };
  const box = (sim.ratings[i] ||= {});
  if (box[key] === undefined) sim.players[key].given++;
  box[key] = s;
  return { kind: 'rated', i, stars: s };
}

const average = box => { const v = Object.values(box || {}); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; };

function launch(sim, now) {
  sim.showAt = now;
  sim.events.push({ e: 'show', i: sim.i, n: sim.order.length, at: now });
}

export function step(sim, now) {
  sim.lastNow = now;
  sim.events = sim.pending; sim.pending = [];
  if (sim.over) return;
  if (sim.phase === 'draw' && now >= sim.drawEnd + SUBMIT_GRACE_MS) {
    const rng = createRng(`show:${sim.seed}`);
    const keys = Object.keys(sim.art).sort();
    for (let i = keys.length - 1; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); [keys[i], keys[j]] = [keys[j], keys[i]]; }
    sim.order = keys;
    if (!keys.length) { sim.phase = 'done'; sim.over = true; sim.events.push({ e: 'empty' }); return; }
    sim.phase = 'show'; sim.i = 0;
    launch(sim, now);
    return;
  }
  if (sim.phase === 'show' && now >= sim.showAt + SHOW_MS) {
    const box = sim.ratings[sim.i] || {};
    const res = { i: sim.i, key: sim.order[sim.i], name: sim.names[sim.order[sim.i]], avg: Math.round(average(box) * 10) / 10, n: Object.keys(box).length };
    sim.results.push(res);
    sim.events.push({ e: 'rated', ...res });
    if (++sim.i >= sim.order.length) { sim.phase = 'done'; sim.over = true; return; }
    launch(sim, now);
  }
}

export const isOver = sim => !!sim.over;
export const artFor = (sim, i) => sim.art[sim.order[i]] || null;

export function snapshot(sim) {
  return {
    phase: sim.phase, drawEnd: sim.drawEnd, i: sim.i, n: sim.order.length, showAt: sim.showAt, showMs: SHOW_MS,
    artist: sim.phase === 'show' ? sim.order[sim.i] : null, // used only so you can't rate your own; names stay hidden
    ready: Object.keys(sim.art), of: Object.keys(sim.players).length,
    votes: sim.phase === 'show' ? Object.keys(sim.ratings[sim.i] || {}).length : 0,
    events: sim.events,
  };
}

/** Party scores: average stars × 100 (4.3 ★ = 430); hits = how many people rated you. */
export function showStats(sim) {
  const byKey = Object.fromEntries(sim.results.map(r => [r.key, r]));
  return Object.fromEntries(Object.keys(sim.players).map(k => {
    const r = byKey[k];
    return [k, { score: r ? Math.round(r.avg * 100) : 0, kos: 0, downs: 0, hits: r ? r.n : 0 }];
  }));
}

export function showSummary(sim) {
  const ranked = [...sim.results].sort((a, b) => b.avg - a.avg || b.n - a.n).map(({ name, avg, n }) => ({ name, avg, n }));
  const fans = Object.entries(sim.players).sort((a, b) => b[1].given - a[1].given);
  return {
    ranked,
    drew: sim.order.length,
    noArt: Object.keys(sim.players).filter(k => !sim.order.includes(k)).map(k => sim.names[k]),
    fan: fans[0] && fans[0][1].given >= 2 ? { name: sim.names[fans[0][0]], given: fans[0][1].given } : null,
  };
}

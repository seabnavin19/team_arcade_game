// Reaction Tap: hit shrinking targets as fast as you can for 30 seconds.
// Red "fake" targets cost points. Same targets for everyone on the same day.

import { createRng } from '../core/rng.js';
import { createLoop } from '../core/loop.js';
import { C, glowCircle, drawHud, Particles, FloatText } from './draw.js';

export const W = 800, H = 480, DURATION = 30;
const HUD = 56;
const lerp = (a, b, t) => a + (b - a) * t;

export const scoreHit = (age, life) => 50 + Math.round(250 * Math.max(0, 1 - age / life));
export const FAKE_PENALTY = 150;
export const MISS_PENALTY = 25;

export function buildTimeline(seed) {
  const rng = createRng(`${seed}:reaction`);
  const out = [];
  let t = 0.6;
  while (t < DURATION - 0.4) {
    const p = t / DURATION;
    const life = lerp(1.5, 0.85, p);
    const r = lerp(44, 32, p);
    const fake = t > 3 && rng.chance(0.22);
    let x = 0, y = 0;
    for (let tries = 0; tries < 15; tries++) {
      x = rng.range(r + 20, W - r - 20);
      y = rng.range(HUD + r + 14, H - r - 16);
      const clash = out.slice(-4).some(o => o.t + o.life > t && Math.hypot(o.x - x, o.y - y) < o.r + r + 16);
      if (!clash) break;
    }
    out.push({ t: +t.toFixed(3), life: +life.toFixed(3), r: +r.toFixed(1), x: Math.round(x), y: Math.round(y), fake });
    t += lerp(0.85, 0.38, p) * rng.range(0.8, 1.2);
  }
  return out;
}

// current drawn radius: shrinks to 40% over its life
export const radiusAt = (tg, age) => tg.r * (1 - 0.6 * Math.min(1, age / tg.life));

export function createReactionState(seed) {
  return { time: 0, score: 0, hits: 0, fakes: 0, misses: 0, ages: [], timeline: buildTimeline(seed), done: new Set(), over: false };
}

/** Pure click handling, used by the game and the tests. */
export function handleClick(s, x, y) {
  if (s.over) return { kind: 'none' };
  let found = -1;
  for (let i = s.timeline.length - 1; i >= 0; i--) {
    const tg = s.timeline[i];
    const age = s.time - tg.t;
    if (age < 0 || age > tg.life || s.done.has(i)) continue;
    if (Math.hypot(x - tg.x, y - tg.y) <= radiusAt(tg, age) + 4) { found = i; break; }
  }
  if (found < 0) {
    s.misses++; s.score = Math.max(0, s.score - MISS_PENALTY);
    return { kind: 'miss', points: -MISS_PENALTY };
  }
  const tg = s.timeline[found];
  s.done.add(found);
  if (tg.fake) {
    s.fakes++; s.score = Math.max(0, s.score - FAKE_PENALTY);
    return { kind: 'fake', points: -FAKE_PENALTY, tg };
  }
  const age = s.time - tg.t;
  const pts = scoreHit(age, tg.life);
  s.hits++; s.score += pts; s.ages.push(age);
  return { kind: 'hit', points: pts, tg };
}

export const resultMeta = s => ({
  hits: s.hits, fakes: s.fakes, misses: s.misses,
  avgMs: s.ages.length ? Math.round((s.ages.reduce((a, b) => a + b, 0) / s.ages.length) * 1000) : null,
});

export default {
  id: 'reaction',
  title: 'Reaction Tap',
  blurb: 'Hit targets before they shrink away. Avoid the red fakes.',
  controls: 'Click the targets · avoid red ones',
  length: '30 sec',
  better: 'higher',
  plausible: (score, seconds) => (score <= 25000 && seconds >= DURATION - 1 ? { ok: true } : { ok: false }),
  describe: m => `${m.hits} hits · ${m.fakes} fakes · ${m.avgMs ? `${m.avgMs} ms avg` : 'no hits'}`,
  width: W, height: H,
  format: s => Math.round(s).toLocaleString('en-US'),
  start(ctx, { seed, input, sound, onEnd }) {
    const s = createReactionState(seed);
    const parts = new Particles();
    const floats = new FloatText();
    let shake = 0;

    input.on('pointerdown', p => {
      const r = handleClick(s, p.x, p.y);
      if (r.kind === 'hit') { sound.hit(); parts.burst(r.tg.x, r.tg.y, C.cyan, 18); floats.add(r.tg.x, r.tg.y - 10, `+${r.points}`, C.lime); }
      else if (r.kind === 'fake') { sound.bad(); shake = 8; parts.burst(r.tg.x, r.tg.y, C.red, 22); floats.add(r.tg.x, r.tg.y - 10, `−${FAKE_PENALTY}`, C.red); }
      else if (r.kind === 'miss') { sound.miss(); floats.add(p.x, p.y, `−${MISS_PENALTY}`, C.muted); }
    });

    const loop = createLoop({
      update(dt) {
        s.time += dt;
        parts.update(dt); floats.update(dt);
        shake = Math.max(0, shake - dt * 40);
        if (s.time >= DURATION && !s.over) {
          s.over = true; loop.stop(); sound.end();
          onEnd(s.score, resultMeta(s));
        }
      },
      render() {
        ctx.save();
        if (shake) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
        ctx.fillStyle = C.bg; ctx.fillRect(-10, -10, W + 20, H + 20);
        // faint grid
        ctx.strokeStyle = 'rgba(141,136,179,0.07)'; ctx.lineWidth = 1;
        for (let x = 0; x <= W; x += 40) { ctx.beginPath(); ctx.moveTo(x, HUD); ctx.lineTo(x, H); ctx.stroke(); }
        for (let y = HUD; y <= H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

        s.timeline.forEach((tg, i) => {
          const age = s.time - tg.t;
          if (age < 0 || age > tg.life || s.done.has(i)) return;
          const r = radiusAt(tg, age);
          const appear = Math.min(1, age / 0.08);
          glowCircle(ctx, tg.x, tg.y, r * appear, tg.fake ? C.red : C.cyan, tg.fake);
        });
        parts.draw(ctx); floats.draw(ctx);
        ctx.restore();
        drawHud(ctx, W, {
          left: `SCORE ${Math.round(s.score).toLocaleString('en-US')}`,
          right: `${Math.max(0, Math.ceil(DURATION - s.time))}s`,
          progress: Math.min(1, s.time / DURATION),
        });
      },
    });
    loop.start();
    return { stop: () => loop.stop() };
  },
};

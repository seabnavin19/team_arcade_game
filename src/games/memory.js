// Memory Match: find all 8 pairs on a 4x4 grid. Score = seconds taken plus
// 2 seconds for every move beyond the perfect 8. Lower is better.

import { createRng } from '../core/rng.js';
import { createLoop } from '../core/loop.js';
import { C, drawHud, Particles, FloatText, MONO } from './draw.js';

export const W = 800, H = 480;
const HUD = 56, COLS = 4, ROWS = 4, CW = 148, CH = 92, GAP = 12;
const GX = (W - (COLS * CW + (COLS - 1) * GAP)) / 2;
const GY = HUD + (H - HUD - (ROWS * CH + (ROWS - 1) * GAP)) / 2;
export const PAIRS = 8, PENALTY = 2, MISMATCH_SHOW = 0.75;
const SYMBOLS = [
  ['circle', C.cyan], ['triangle', C.magenta], ['star', C.yellow], ['diamond', C.lime],
  ['hexagon', '#a98bff'], ['heart', '#ff7a59'], ['bolt', '#59c3ff'], ['moon', '#f0e6c8'],
];

export const memoryScore = (seconds, moves) => Math.round((seconds + PENALTY * Math.max(0, moves - PAIRS)) * 10) / 10;

export function buildLayout(seed) {
  const rng = createRng(`${seed}:memory`);
  const deck = [...Array(PAIRS).keys()].flatMap(i => [i, i]);
  for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  return deck;
}

export const cardRect = i => ({ x: GX + (i % COLS) * (CW + GAP), y: GY + Math.floor(i / COLS) * (CH + GAP), w: CW, h: CH });
export function cardAt(x, y) {
  for (let i = 0; i < COLS * ROWS; i++) { const r = cardRect(i); if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return i; }
  return -1;
}

/** Pure game state; time is passed in so tests can drive it. */
export function createMemoryState(seed) {
  return { deck: buildLayout(seed), matched: new Set(), open: [], moves: 0, time: 0, hideAt: 0, over: false };
}

export function flip(s, i) {
  if (s.over || i < 0 || s.matched.has(i) || s.open.includes(i)) return { kind: 'none' };
  if (s.open.length === 2) s.open = []; // clicking during a mismatch closes it straight away
  s.open.push(i);
  if (s.open.length < 2) return { kind: 'open' };
  s.moves++;
  const [a, b] = s.open;
  if (s.deck[a] === s.deck[b]) {
    s.matched.add(a); s.matched.add(b); s.open = [];
    if (s.matched.size === PAIRS * 2) s.over = true;
    return { kind: 'match', a, b };
  }
  s.hideAt = s.time + MISMATCH_SHOW;
  return { kind: 'mismatch' };
}

export function tick(s, dt) {
  s.time += dt;
  if (s.open.length === 2 && s.time >= s.hideAt) s.open = [];
}

function drawSymbol(ctx, kind, x, y, r, color) {
  ctx.save();
  ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineWidth = 4; ctx.lineJoin = 'round';
  ctx.shadowColor = color; ctx.shadowBlur = 14;
  ctx.beginPath();
  const poly = (n, rot = -Math.PI / 2, rr = r) => { for (let k = 0; k < n; k++) { const a = rot + (k * 2 * Math.PI) / n; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } ctx.closePath(); };
  switch (kind) {
    case 'circle': ctx.arc(x, y, r * 0.85, 0, Math.PI * 2); break;
    case 'triangle': poly(3, -Math.PI / 2, r); break;
    case 'diamond': poly(4, -Math.PI / 2, r); break;
    case 'hexagon': poly(6, 0, r * 0.9); break;
    case 'star': for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + (k * Math.PI) / 5, rr = k % 2 ? r * 0.42 : r; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } ctx.closePath(); break;
    case 'heart':
      ctx.moveTo(x, y + r * 0.8);
      ctx.bezierCurveTo(x - r * 1.3, y - r * 0.1, x - r * 0.55, y - r * 1.05, x, y - r * 0.35);
      ctx.bezierCurveTo(x + r * 0.55, y - r * 1.05, x + r * 1.3, y - r * 0.1, x, y + r * 0.8); break;
    case 'bolt':
      [[0.15, -1], [-0.55, 0.12], [-0.02, 0.12], [-0.2, 1], [0.55, -0.15], [0.02, -0.15]].forEach(([px, py]) => ctx.lineTo(x + px * r, y + py * r)); ctx.closePath(); break;
    case 'moon': ctx.arc(x, y, r * 0.85, Math.PI * 0.35, Math.PI * 1.65); ctx.arc(x + r * 0.35, y, r * 0.62, Math.PI * 1.5, Math.PI * 0.5, true); ctx.closePath(); break;
  }
  ctx.globalAlpha = 0.25; ctx.fill(); ctx.globalAlpha = 1; ctx.stroke();
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

const fmt = s => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

export default {
  id: 'memory',
  title: 'Memory Match',
  blurb: 'Flip cards and find all 8 pairs in as few moves as you can.',
  controls: 'Click cards · or arrow keys + Enter',
  length: '~1 min',
  better: 'lower',
  width: W, height: H,
  format: fmt,
  // A perfect game is 8 moves; nobody does that in under ~4 seconds.
  plausible: (score, seconds, meta) => (score >= 4 && meta?.moves >= PAIRS ? { ok: true } : { ok: false }),
  describe: m => `${m.moves} moves · ${fmt(m.seconds)} on the clock · +${(m.moves - PAIRS) * PENALTY}s for extra moves`,
  start(ctx, { seed, input, sound, onEnd }) {
    const s = createMemoryState(seed);
    const flipAnim = new Array(16).fill(0); // 0 = face down, 1 = face up
    const parts = new Particles(), floats = new FloatText();
    let cursor = 0, usingKeys = false, endAt = null;

    const doFlip = i => {
      const r = flip(s, i);
      if (r.kind === 'open' || r.kind === 'mismatch') sound.tick();
      if (r.kind === 'mismatch') setTimeout(() => sound.miss(), 250);
      if (r.kind === 'match') {
        sound.hit();
        for (const k of [r.a, r.b]) { const c = cardRect(k); parts.burst(c.x + c.w / 2, c.y + c.h / 2, SYMBOLS[s.deck[k]][1], 14); }
        if (s.over) endAt = s.time + 0.6; // let the last flip land before the results
      }
    };
    input.on('pointerdown', p => { usingKeys = false; doFlip(cardAt(p.x, p.y)); });
    input.on('keydown', e => {
      const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -COLS, ArrowDown: COLS };
      if (e.key in moves) { usingKeys = true; cursor = (cursor + moves[e.key] + 16) % 16; }
      else if (e.key === 'Enter' || e.key === ' ') { usingKeys = true; doFlip(cursor); }
    });

    const loop = createLoop({
      update(dt) {
        if (!s.over) tick(s, dt); else s.time += dt;
        parts.update(dt); floats.update(dt);
        for (let i = 0; i < 16; i++) {
          const up = s.matched.has(i) || s.open.includes(i);
          flipAnim[i] += ((up ? 1 : 0) - flipAnim[i]) * Math.min(1, dt * 14);
        }
        if (endAt !== null && s.time >= endAt) {
          loop.stop(); sound.end();
          const seconds = Math.round((endAt - 0.6) * 10) / 10;
          onEnd(memoryScore(seconds, s.moves), { moves: s.moves, seconds });
          endAt = null;
        }
      },
      render() {
        ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
        for (let i = 0; i < 16; i++) {
          const r = cardRect(i), t = flipAnim[i];
          const face = t > 0.5, sx = Math.abs(Math.cos(t * Math.PI));
          const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
          ctx.save(); ctx.translate(cx, cy); ctx.scale(Math.max(0.02, sx), 1);
          roundRect(ctx, -r.w / 2, -r.h / 2, r.w, r.h, 10);
          if (face) {
            ctx.fillStyle = s.matched.has(i) ? '#14112b' : C.panel; ctx.fill();
            ctx.strokeStyle = s.matched.has(i) ? 'rgba(156,255,87,.45)' : 'rgba(236,233,255,.35)'; ctx.lineWidth = 2; ctx.stroke();
            const [kind, color] = SYMBOLS[s.deck[i]];
            drawSymbol(ctx, kind, 0, 0, 26, s.matched.has(i) ? color : color);
            if (s.matched.has(i)) { ctx.fillStyle = 'rgba(12,10,29,.35)'; roundRect(ctx, -r.w / 2, -r.h / 2, r.w, r.h, 10); ctx.fill(); }
          } else {
            const g = ctx.createLinearGradient(-r.w / 2, -r.h / 2, r.w / 2, r.h / 2);
            g.addColorStop(0, '#2a2361'); g.addColorStop(1, '#1a1640'); ctx.fillStyle = g; ctx.fill();
            ctx.strokeStyle = 'rgba(45,226,230,.35)'; ctx.lineWidth = 1.5; ctx.stroke();
            ctx.strokeStyle = 'rgba(255,61,154,.35)'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(0, 0, 14, 0, Math.PI * 2); ctx.stroke();
          }
          ctx.restore();
          if (usingKeys && cursor === i) {
            ctx.save(); ctx.strokeStyle = C.yellow; ctx.lineWidth = 3; roundRect(ctx, r.x - 4, r.y - 4, r.w + 8, r.h + 8, 13); ctx.stroke(); ctx.restore();
          }
        }
        parts.draw(ctx); floats.draw(ctx);
        const penalty = PENALTY * Math.max(0, s.moves - PAIRS);
        drawHud(ctx, W, {
          left: `PAIRS ${s.matched.size / 2}/8   MOVES ${s.moves}`,
          right: `${fmt(Math.min(s.time, endAt !== null ? endAt - 0.6 : s.time))}${penalty ? ` +${penalty}s` : ''}`,
          progress: 1 - s.matched.size / 16,
        });
      },
    });
    loop.start();
    return { stop: () => loop.stop() };
  },
};

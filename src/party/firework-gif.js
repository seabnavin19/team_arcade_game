// Turns one Firework Show drawing into an animated GIF for the Telegram group:
// the rocket rises over the Royal Palace, bursts, the sparks fly out into the
// drawing, glitter, then fall and fade (with a reflection in the river).
//
// Pure JavaScript with a fixed palette, so it is fast and runs in the browser
// (a player's screen renders it) or in Node for tests. No canvas needed.

import { GIFEncoder } from 'gifenc/dist/gifenc.esm.js';
import { createRng } from '../core/rng.js';
import { COLORS, W as SRC_W, LAUNCH_Y } from './firework.js';

export const GW = 400, GH = 240;
const S = GW / SRC_W;                       // 800×480 drawing → 400×240 GIF
const RIVER = Math.round(404 * S);
const RISE = 1200, FORM = 900, HOLD_END = 4600, END = 7400;

// ---------- palette ----------
const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
const SKY = 0, SKY_N = 24, RIVER_I = 24, WAVE = 25, PALACE = 26, LAMP = 27, CROWD = 28, TRAIL = 29, WHITE = 30, STAR = 31;
const FW = 32, LEVELS = 24;                 // 8 colours × 24 brightness levels
const CLEAR = 255;                          // "unchanged since the last frame"
export const PALETTE = (() => {
  const p = Array.from({ length: 256 }, () => [0, 0, 0]);
  const top = hex('#05061a'), mid = hex('#141038'), low = hex('#2a1a4a');
  for (let i = 0; i < SKY_N; i++) { const k = i / (SKY_N - 1); p[SKY + i] = k < 0.7 ? mix(top, mid, k / 0.7) : mix(mid, low, (k - 0.7) / 0.3); }
  p[RIVER_I] = hex('#081a33'); p[WAVE] = hex('#16304f'); p[PALACE] = hex('#1a1433'); p[LAMP] = hex('#ffc86e');
  p[CROWD] = hex('#04040c'); p[TRAIL] = hex('#ffcf8a'); p[WHITE] = [255, 255, 255]; p[STAR] = hex('#9a96c0');
  const night = hex('#141038');
  COLORS.forEach((c, ci) => {
    for (let l = 0; l < LEVELS; l++) p[FW + ci * LEVELS + l] = l < 18 ? mix(night, hex(c), (l + 1) / 18) : mix(hex(c), [255, 255, 255], (l - 17) / 8);
  });
  return p;
})();

// ---------- background (drawn once) ----------
function background() {
  const b = new Uint8Array(GW * GH);
  for (let y = 0; y < GH; y++) {
    const row = y < RIVER ? SKY + Math.min(SKY_N - 1, Math.floor((y / RIVER) * SKY_N)) : RIVER_I;
    b.fill(row, y * GW, (y + 1) * GW);
  }
  const rect = (x, y, w, h, c) => { for (let j = Math.max(0, y); j < Math.min(GH, y + h); j++) for (let i = Math.max(0, x); i < Math.min(GW, x + w); i++) b[j * GW + i] = c; };
  const tri = (x0, x1, base, apex, ax, c) => { for (let y = apex; y < base; y++) { const k = (y - apex) / (base - apex); rect(Math.round(ax - (ax - x0) * k), y, Math.round((x1 - x0) * k) + 1, 1, c); } };
  for (let i = 0; i < 45; i++) { const x = (i * 211) % GW, y = 30 + ((i * 53) % 130); b[y * GW + x] = i % 3 ? STAR : WHITE; }
  const cx = GW / 2, base = RIVER;
  rect(cx - 75, base - 13, 150, 13, PALACE);
  [[55, 20], [38, 32], [23, 42]].forEach(([w, h]) => tri(cx - w, cx + w, base - 13, base - 13 - h, cx, PALACE));
  rect(cx - 1, base - 70, 2, 17, PALACE);
  for (const sx of [-125, 125]) tri(cx + sx - 25, cx + sx + 25, base, base - 22, cx + sx, PALACE);
  for (let i = -6; i <= 6; i++) rect(Math.round(cx + i * 11 - 1), base - 9, 2, 3, LAMP);
  for (let y = RIVER + 5; y < GH; y += 7) for (let x = 0; x < GW; x++) if (Math.sin(x / 17 + y) > 0.55) b[y * GW + x] = WAVE;
  for (let i = 0; i < 9; i++) { const x = (i * 47 + 13) % GW, y = RIVER + 14 + (i * 17) % 18; b[y * GW + x] = LAMP; }
  for (let i = 0; i < 40; i++) { const x = Math.round(i * 10.5 + (i % 3) * 2), h = 5 + (i * 7) % 4; for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) if (dx * dx + dy * dy <= 12) { const yy = GH - h + dy, xx = x + dx; if (yy >= 0 && yy < GH && xx >= 0 && xx < GW) b[yy * GW + xx] = CROWD; } rect(x - 4, GH - h, 9, h, CROWD); }
  return b;
}

// ---------- the drawing as sparks ----------
function targets(art, rng) {
  let total = 0;
  for (const s of art) for (let i = 2; i < s.pts.length; i += 2) total += Math.hypot(s.pts[i] - s.pts[i - 2], s.pts[i + 1] - s.pts[i - 1]);
  const gap = Math.max(7, total / 650);
  const out = [];
  for (const s of art) {
    const ci = Math.max(0, COLORS.indexOf(s.c));
    out.push([s.pts[0], s.pts[1], ci]);
    let carry = 0;
    for (let i = 2; i < s.pts.length; i += 2) {
      const x0 = s.pts[i - 2], y0 = s.pts[i - 1], x1 = s.pts[i], y1 = s.pts[i + 1], d = Math.hypot(x1 - x0, y1 - y0);
      for (carry += d; carry >= gap; carry -= gap) { const k = 1 - (carry - gap) / (d || 1); out.push([x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, ci]); }
    }
  }
  return out.map(([x, y, c]) => ({ x: x * S, y: y * S, c, d: rng.next() * 120, tw: rng.next() * 6 }));
}

/** Frame times (ms) and how long each frame shows. */
function timeline() {
  const t = [];
  for (let ms = 0; ms < RISE; ms += 120) t.push([ms, 120]);
  for (let ms = RISE; ms < RISE + FORM; ms += 90) t.push([ms, 90]);
  for (let ms = RISE + FORM; ms < HOLD_END; ms += 110) t.push([ms, 110]);
  for (let ms = HOLD_END; ms < END; ms += 140) t.push([ms, 140]);
  t.push([END, 900]); // a dark pause before it loops
  return t;
}

const ease = u => 1 - Math.pow(1 - Math.max(0, Math.min(1, u)), 3);

/**
 * Render a drawing (the cleaned strokes from the show) to GIF bytes.
 * Pass `yieldEvery` > 0 to get a Promise and give the page a breather between frames.
 */
export function renderFireworkGif(art, { seed = 'gif', yieldEvery = 0 } = {}) {
  const rng = createRng(`gif:${seed}`);
  const bg = background();
  const dots = targets(art, rng);
  if (!dots.length) return null;
  const xs = dots.map(d => d.x), ys = dots.map(d => d.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const mainC = dots[0].c;
  const burst = Array.from({ length: 56 }, (_, i) => ({ a: (i / 56) * Math.PI * 2 + rng.next() * 0.1, v: (200 + rng.next() * 160) * S, life: 900 + rng.next() * 500 }));

  const frame = new Uint8Array(GW * GH), level = new Int8Array(GW * GH), prev = new Uint8Array(GW * GH), out = new Uint8Array(GW * GH);
  const plot = (x, y, ci, l, r = 1.6) => {
    if (l <= 0) return;
    const R = Math.ceil(r + 1.5);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const px = Math.round(x) + dx, py = Math.round(y) + dy;
      if (px < 0 || py < 0 || px >= GW || py >= GH) continue;
      const dist = Math.hypot(dx, dy), ll = Math.round(dist <= r ? l : l - (dist - r) * 7);
      if (ll <= 0) continue;
      const k = py * GW + px, v = Math.min(LEVELS - 1, ll);
      if (v > level[k]) { level[k] = v; frame[k] = FW + ci * LEVELS + v; }
    }
  };
  const spark = (x, y, ci, l, r) => {
    plot(x, y, ci, l, r);
    if (y < RIVER) { const my = 2 * RIVER - y; if (my < GH) plot(x, my, ci, Math.round(l * 0.3), r); }
  };

  const gif = GIFEncoder();
  const frames = timeline();
  let n = 0;
  const drawFrame = ([ms, delay]) => {
    frame.set(bg); level.fill(0);
    if (ms < RISE) {
      const u = ease(ms / RISE);
      const x = GW / 2 + (cx - GW / 2) * u, y = LAUNCH_Y * S + (cy - LAUNCH_Y * S) * u;
      for (let k = 1; k <= 8; k++) { const yy = Math.round(y + k * 3); if (yy < RIVER) frame[yy * GW + Math.round(x - (cx - GW / 2) * 0.01 * k)] = TRAIL; }
      spark(x, y, mainC, 22, 1.4);
    } else {
      const e = ms - RISE;
      // the opening flash and the round burst
      if (e < 240) { const r = 10 + e / 12; spark(cx, cy, mainC, Math.round(23 - e / 20), r); }
      for (const b of burst) {
        const t = e / 1000, kdrag = 2.2;
        if (e > b.life) continue;
        const f = (1 - Math.exp(-kdrag * t)) / kdrag;
        spark(cx + Math.cos(b.a) * b.v * f, cy + Math.sin(b.a) * b.v * f + 30 * S * t * t, mainC, Math.round(20 * (1 - e / b.life)), 0.8);
      }
      // the drawing
      for (const d of dots) {
        let x, y, l;
        if (ms < RISE + FORM) { const u = ease((e - d.d * 0.6) / FORM); x = cx + (d.x - cx) * u; y = cy + (d.y - cy) * u; l = 21; }
        else if (ms < HOLD_END) { x = d.x; y = d.y + (ms - RISE - FORM) * 0.001; l = Math.round(15 + 7 * Math.sin(ms / 90 + d.tw)); }
        else { const f = (ms - HOLD_END) / 1000; x = d.x + Math.sin(d.tw) * 3 * f; y = d.y + 5 + 19 * f * f; l = Math.round(21 * Math.max(0, 1 - f / 2.6)); }
        spark(x, y, d.c, l, 1.1);
      }
    }
    // only what changed since the last frame is stored (much smaller GIF)
    if (n === 0) out.set(frame); else for (let k = 0; k < frame.length; k++) out[k] = frame[k] === prev[k] ? CLEAR : frame[k];
    gif.writeFrame(out, GW, GH, n === 0 ? { palette: PALETTE, delay, repeat: 0 } : { delay, transparent: true, transparentIndex: CLEAR, dispose: 1 });
    prev.set(frame);
    n++;
  };

  if (!yieldEvery) { frames.forEach(drawFrame); gif.finish(); return gif.bytes(); }
  return (async () => {
    for (let i = 0; i < frames.length; i++) {
      drawFrame(frames[i]);
      if ((i + 1) % yieldEvery === 0) await new Promise(r => setTimeout(r, 0));
    }
    gif.finish();
    return gif.bytes();
  })();
}

export const isGif = bytes => bytes && bytes.length > 6 && String.fromCharCode(...bytes.slice(0, 6)) === 'GIF89a';

export function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromBase64(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

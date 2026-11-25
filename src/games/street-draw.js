// Street Heat drawing and controls, shared by the solo game and the party view.
// Night-time neon city seen from above. Only what's on screen is drawn.

import { TILE, COLS, ROWS, WW, WH, BUILDING, PARK, HIDEOUT, WASH, MAX_STARS } from './street.js';
import { C } from './draw.js';

export const CAR_COLORS = ['#ff3d9a', '#2de2e6', '#ffd23f', '#9cff57', '#b18cff', '#ff8a3d', '#5aa9ff', '#ff6b6b'];
const ROOFS = ['#2a2550', '#33285a', '#1f2f4f', '#3a2447', '#26364a', '#3b2d52'];
const NEON = ['#ff3d9a', '#2de2e6', '#b18cff', '#ffd23f'];
const hash = (a, b) => { let h = (a * 73856093) ^ (b * 19349663); h = (h ^ (h >>> 13)) * 1274126177; return (h ^ (h >>> 16)) >>> 0; };

/** Camera: centre on the car, look ahead a little, stay inside the city. */
export function cameraFor(car, vw, vh, prev) {
  const ahead = 0.35;
  let x = car.x + Math.cos(car.a) * car.v * ahead - vw / 2, y = car.y + Math.sin(car.a) * car.v * ahead - vh / 2;
  if (prev) { x = prev.x + (x - prev.x) * 0.15; y = prev.y + (y - prev.y) * 0.15; }
  x = Math.max(-40, Math.min(WW - vw + 40, x)); y = Math.max(-40, Math.min(WH - vh + 40, y));
  if (vw > WW) x = (WW - vw) / 2;
  if (vh > WH) y = (WH - vh) / 2;
  return { x, y, w: vw, h: vh };
}

/** The city under the camera (call with the context already offset by -cam.x, -cam.y). */
export function drawCity(ctx, city, cam, t) {
  const c0 = Math.max(0, Math.floor(cam.x / TILE)), c1 = Math.min(COLS - 1, Math.floor((cam.x + cam.w) / TILE));
  const r0 = Math.max(0, Math.floor(cam.y / TILE)), r1 = Math.min(ROWS - 1, Math.floor((cam.y + cam.h) / TILE));
  ctx.fillStyle = '#07061a';
  ctx.fillRect(cam.x, cam.y, cam.w, cam.h);
  ctx.fillStyle = '#1b1934';
  ctx.fillRect(Math.max(0, cam.x), Math.max(0, cam.y), Math.min(WW, cam.x + cam.w) - Math.max(0, cam.x), Math.min(WH, cam.y + cam.h) - Math.max(0, cam.y));
  // ground tiles
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    const k = city.tiles[r * COLS + c], x = c * TILE, y = r * TILE;
    if (k === PARK) { ctx.fillStyle = (c + r) % 2 ? '#123a2c' : '#143f30'; ctx.fillRect(x, y, TILE, TILE); }
    else if (k === HIDEOUT) { ctx.fillStyle = '#2a1840'; ctx.fillRect(x, y, TILE, TILE); }
    else if (k === WASH) { ctx.fillStyle = '#10304a'; ctx.fillRect(x, y, TILE, TILE); }
  }
  // lane markings down the middle of each 2-tile road
  ctx.strokeStyle = 'rgba(255,210,63,.35)'; ctx.lineWidth = 2; ctx.setLineDash([14, 16]);
  ctx.beginPath();
  for (let c = 0; c < COLS; c += 6) { const x = (c + 1) * TILE; if (x < cam.x - 2 || x > cam.x + cam.w + 2) continue; ctx.moveTo(x, Math.max(0, cam.y)); ctx.lineTo(x, Math.min(WH, cam.y + cam.h)); }
  for (let r = 0; r < ROWS; r += 6) { const y = (r + 1) * TILE; if (y < cam.y - 2 || y > cam.y + cam.h + 2) continue; ctx.moveTo(Math.max(0, cam.x), y); ctx.lineTo(Math.min(WW, cam.x + cam.w), y); }
  { const x = (COLS - 1) * TILE, y = (ROWS - 1) * TILE; ctx.moveTo(x, Math.max(0, cam.y)); ctx.lineTo(x, Math.min(WH, cam.y + cam.h)); ctx.moveTo(Math.max(0, cam.x), y); ctx.lineTo(Math.min(WW, cam.x + cam.w), y); }
  ctx.stroke(); ctx.setLineDash([]);
  // buildings: merge each block's building tiles into one rooftop
  const seen = new Set();
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    if (city.tiles[r * COLS + c] !== BUILDING) continue;
    let bc = c, br = r;
    while (bc > 0 && city.tiles[r * COLS + bc - 1] === BUILDING) bc--;
    while (br > 0 && city.tiles[(br - 1) * COLS + c] === BUILDING) br--;
    const id = br * COLS + bc;
    if (seen.has(id)) continue;
    seen.add(id);
    let w = 0, h = 0;
    while (bc + w < COLS && city.tiles[br * COLS + bc + w] === BUILDING) w++;
    while (br + h < ROWS && city.tiles[(br + h) * COLS + bc] === BUILDING) h++;
    drawRoof(ctx, bc * TILE, br * TILE, w * TILE, h * TILE, hash(bc, br), t);
  }
  // hideout and car washes: signs
  const sign = (p, text, col) => {
    if (p.x < cam.x - 200 || p.x > cam.x + cam.w + 200 || p.y < cam.y - 200 || p.y > cam.y + cam.h + 200) return;
    ctx.save(); ctx.font = '900 13px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = col; ctx.shadowBlur = 12; ctx.fillStyle = col; ctx.fillText(text, p.x, p.y); ctx.restore();
    ctx.save(); ctx.strokeStyle = col; ctx.globalAlpha = 0.5 + 0.3 * Math.sin(t * 3); ctx.lineWidth = 2; ctx.setLineDash([8, 8]);
    ctx.strokeRect(p.c * TILE + 3, p.r * TILE + 3, 4 * TILE - 6, 4 * TILE - 6); ctx.restore();
  };
  sign(city.hideout, 'HIDEOUT', C.magenta);
  for (const w of city.washes) sign(w, 'CAR WASH', C.cyan);
}

function drawRoof(ctx, x, y, w, h, seed, t) {
  ctx.fillStyle = '#0f0d22'; ctx.fillRect(x, y, w, h); // shadow edge
  const roof = ROOFS[seed % ROOFS.length];
  ctx.fillStyle = roof; ctx.fillRect(x + 4, y + 4, w - 8, h - 8);
  ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.lineWidth = 2; ctx.strokeRect(x + 10, y + 10, w - 20, h - 20);
  // rooftop bits: AC boxes, a skylight, a neon edge on some
  ctx.fillStyle = 'rgba(255,255,255,.08)';
  for (let i = 0; i < 3; i++) { const s = (seed >>> (i * 5)) & 31; ctx.fillRect(x + 16 + (s % 7) * ((w - 44) / 7), y + 16 + ((s >> 3) % 4) * ((h - 44) / 4), 12, 10); }
  if (seed % 3 === 0) {
    const col = NEON[(seed >> 4) % NEON.length];
    ctx.save(); ctx.strokeStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 10; ctx.lineWidth = 2;
    ctx.globalAlpha = 0.65 + 0.2 * Math.sin(t * 2 + seed);
    ctx.strokeRect(x + 4, y + 4, w - 8, h - 8); ctx.restore();
  }
}

/** A car from above. */
export function drawCar(ctx, x, y, a, color, { police = false, t = 0, glow = false, ghost = false } = {}) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(a);
  if (ghost) ctx.globalAlpha = 0.5;
  ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(-15, -7, 32, 17); // shadow
  if (glow) { ctx.shadowColor = color; ctx.shadowBlur = 14; }
  ctx.fillStyle = police ? '#e8ecff' : color;
  roundRect(ctx, -16, -9, 32, 18, 5); ctx.fill();
  ctx.shadowBlur = 0;
  if (police) { ctx.fillStyle = '#16183a'; ctx.fillRect(-16, -9, 9, 18); ctx.fillRect(9, -9, 7, 18); }
  ctx.fillStyle = 'rgba(10,12,30,.85)'; roundRect(ctx, 2, -7, 8, 14, 3); ctx.fill(); // windscreen
  ctx.fillStyle = 'rgba(10,12,30,.6)'; roundRect(ctx, -11, -7, 6, 14, 2); ctx.fill();
  ctx.fillStyle = '#fff8c4'; ctx.fillRect(14, -7, 2, 4); ctx.fillRect(14, 3, 2, 4); // headlights
  if (police) {
    const on = Math.floor(t * 8) % 2;
    ctx.fillStyle = on ? '#ff3b3b' : '#3b7bff'; ctx.fillRect(-3, -8, 4, 7);
    ctx.fillStyle = on ? '#3b7bff' : '#ff3b3b'; ctx.fillRect(-3, 1, 4, 7);
    ctx.globalAlpha = 0.25; ctx.fillStyle = on ? '#ff3b3b' : '#3b7bff';
    ctx.beginPath(); ctx.arc(0, 0, 30, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}
function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

/** Loot: a glowing money marker (bags dropped in a ram are smaller). */
export function drawLoot(ctx, l, t) {
  const big = l.kind === 'bank' || l.kind === 'jewel';
  const r = (big ? 14 : l.kind === 'bag' ? 9 : 11) + Math.sin(t * 5 + l.id) * 1.5;
  ctx.save();
  ctx.shadowColor = C.yellow; ctx.shadowBlur = 16;
  ctx.fillStyle = l.kind === 'jewel' ? '#7ff3ff' : C.yellow;
  ctx.beginPath(); ctx.arc(l.x, l.y, r, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0; ctx.fillStyle = '#2a2000'; ctx.font = `900 ${big ? 15 : 12}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(l.kind === 'jewel' ? '◆' : '$', l.x, l.y + 1);
  ctx.restore();
}

/** Wanted stars, like a crime game's HUD: filled ones glow. */
export function drawStars(ctx, x, y, n, t, size = 11) {
  ctx.save();
  for (let i = 0; i < MAX_STARS; i++) {
    const on = i < n;
    ctx.fillStyle = on ? (Math.floor(t * 4) % 2 && n >= 4 ? '#ff6b6b' : C.yellow) : 'rgba(141,136,179,.3)';
    star(ctx, x + i * (size * 2.1), y, size, size * 0.45);
  }
  ctx.restore();
}
function star(ctx, cx, cy, R, r) { ctx.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r : R; ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } ctx.closePath(); ctx.fill(); }

/** A small map in a corner: roads, hideout, washes, loot, police, you. */
export function drawMinimap(ctx, city, x, y, w, { me, others = [], cops = [], loot = [] }, t) {
  const s = w / WW, h = WH * s;
  ctx.save();
  ctx.globalAlpha = 0.9; ctx.fillStyle = 'rgba(7,6,26,.85)'; ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
  ctx.globalAlpha = 1;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const k = city.tiles[r * COLS + c];
    if (k === BUILDING) continue;
    ctx.fillStyle = k === HIDEOUT ? C.magenta : k === WASH ? C.cyan : k === PARK ? '#1d5a43' : '#3a3666';
    ctx.fillRect(x + c * TILE * s, y + r * TILE * s, TILE * s + 0.5, TILE * s + 0.5);
  }
  const dot = (px, py, col, r) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x + px * s, y + py * s, r, 0, Math.PI * 2); ctx.fill(); };
  for (const l of loot) dot(l.x, l.y, C.yellow, 2.2);
  for (const c of cops) dot(c.x, c.y, Math.floor(t * 6) % 2 ? '#ff3b3b' : '#3b7bff', 2.4);
  for (const o of others) dot(o.x, o.y, o.color, 2.4);
  if (me) dot(me.x, me.y, '#fff', 3.2);
  ctx.restore();
}

/** An arrow at the screen edge pointing to where to go next. */
export function drawPointer(ctx, cam, from, to, color, label) {
  const dx = to.x - from.x, dy = to.y - from.y, d = Math.hypot(dx, dy);
  if (d < 90) return;
  const a = Math.atan2(dy, dx);
  const onScreen = to.x > cam.x + 30 && to.x < cam.x + cam.w - 30 && to.y > cam.y + 70 && to.y < cam.y + cam.h - 30;
  const r = Math.min(cam.w, cam.h) * 0.36;
  const px = onScreen ? to.x : from.x + Math.cos(a) * r, py = onScreen ? to.y - 34 : from.y + Math.sin(a) * r;
  ctx.save(); ctx.translate(px, py); ctx.rotate(onScreen ? Math.PI / 2 : a);
  ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 10;
  ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-7, -9); ctx.lineTo(-3, 0); ctx.lineTo(-7, 9); ctx.closePath(); ctx.fill();
  ctx.restore();
  if (label && !onScreen) { ctx.save(); ctx.font = '800 11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = color; ctx.fillText(label, px, py + 22); ctx.restore(); }
}

// ---------------------------------------------------------------- controls
/**
 * Driving controls for keyboard, touch and mouse → [throttle, steer].
 * Keys: ↑/W go, ↓/S brake & reverse, ←→/AD steer.
 * Touch: put a thumb down anywhere and drag: the car drives the way you point.
 * Mouse: hold the button and the car drives toward the pointer.
 * `toWorld(x, y)` turns a pointer position into city coordinates; `cssScale()`
 * is screen pixels per game unit (for the joystick size).
 */
export function createDriveControls(input, { toWorld, cssScale = () => 1 }) {
  let joy = null, mouseDown = false;
  input.on('pointerdown', pt => {
    if (pt.type === 'mouse') { mouseDown = true; joy = null; return; }
    joy = { ox: pt.x, oy: pt.y, cx: pt.x, cy: pt.y };
  });
  input.on('pointermove', pt => {
    if (!joy || !pt.down) return;
    joy.cx = pt.x; joy.cy = pt.y;
    const R = 46 / cssScale(), dx = joy.cx - joy.ox, dy = joy.cy - joy.oy, d = Math.hypot(dx, dy);
    if (d > R) { joy.ox = joy.cx - (dx / d) * R; joy.oy = joy.cy - (dy / d) * R; }
  });
  input.on('pointerup', () => { joy = null; mouseDown = false; });
  const towards = (car, ang, mag) => {
    let diff = ang - car.a;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    // pointing backwards: reverse (steering flips when reversing)
    if (Math.abs(diff) > 2.5 && car.v < 80) return [-0.85 * mag, -Math.sign(diff) * Math.min(1, (Math.PI - Math.abs(diff)) * 2.5)];
    return [mag * (Math.abs(diff) > 1.4 ? 0.45 : 1), Math.max(-1, Math.min(1, diff * 2.6))];
  };
  return {
    read(car) {
      const k = input.keys;
      const up = k.has('ArrowUp') || k.has('w') || k.has('W'), down = k.has('ArrowDown') || k.has('s') || k.has('S');
      const left = k.has('ArrowLeft') || k.has('a') || k.has('A'), right = k.has('ArrowRight') || k.has('d') || k.has('D');
      if (up || down || left || right) return [(up ? 1 : 0) - (down ? 1 : 0), (right ? 1 : 0) - (left ? 1 : 0)];
      if (joy) {
        const R = 46 / cssScale(), dx = joy.cx - joy.ox, dy = joy.cy - joy.oy, d = Math.hypot(dx, dy);
        if (d < R * 0.18) return [0, 0];
        return towards(car, Math.atan2(dy, dx), Math.min(1, d / R));
      }
      if (mouseDown && input.pointer.inside) {
        const w = toWorld(input.pointer.x, input.pointer.y);
        const d = Math.hypot(w.x - car.x, w.y - car.y);
        if (d < 18) return [0, 0];
        return towards(car, Math.atan2(w.y - car.y, w.x - car.x), Math.min(1, d / 120));
      }
      return [0, 0];
    },
    /** draw the thumb joystick (screen coordinates) */
    draw(ctx) {
      if (!joy) return;
      const R = 46 / cssScale(), dx = joy.cx - joy.ox, dy = joy.cy - joy.oy, d = Math.hypot(dx, dy), m = d > R ? R / d : 1;
      ctx.save();
      ctx.strokeStyle = 'rgba(236,233,255,.3)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(joy.ox, joy.oy, R, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(255,61,154,.4)'; ctx.beginPath(); ctx.arc(joy.ox + dx * m, joy.oy + dy * m, R * 0.42, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    },
  };
}

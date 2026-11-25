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
const FULL_LOCK = Math.sin((32 * Math.PI) / 180); // tilting the phone ~32° is full steering

/**
 * Steering from the phone's tilt, like a steering wheel: −1 (full left) … 1 (full right).
 * ax, ay, az: accelerationIncludingGravity (m/s²) in the phone's own axes; angle:
 * screen rotation (0 upright, 90 or −90 sideways). Phones disagree on the sign
 * (iPhones report the opposite of Android), so it's worked out from gravity
 * itself: held normally, "down" reads positive on one and negative on the other.
 */
export function tiltSteer(ax, ay, az, angle) {
  if (!Number.isFinite(ax) || !Number.isFinite(ay)) return 0;
  const a = ((Math.round(angle / 90) * 90) % 360 + 360) % 360;
  // gravity along the screen's left–right and bottom–top axes, whichever way the phone is held
  const sx = a === 0 ? ax : a === 90 ? -ay : a === 180 ? -ax : ay;
  const sy = a === 0 ? ay : a === 90 ? ax : a === 180 ? -ay : -ax;
  const sign = sy + (Number.isFinite(az) ? az : 0) >= 0 ? -1 : 1;
  const g = Math.max(-1, Math.min(1, (sign * sx) / 9.81 / FULL_LOCK));
  return Math.abs(g) < 0.08 ? 0 : g; // small dead zone so a level phone drives straight
}

/** Where the on-screen wheel and brake pedal sit, for a screen of w × h game units. */
export function padLayout(w, h) {
  const r = Math.max(52, Math.min(82, Math.min(w, h) * 0.17));
  return {
    wheel: { x: r + 22, y: h - r - 22, r },
    brake: { x: w - 22 - r * 1.1, y: h - 22 - r * 1.5, w: r * 1.1, h: r * 1.5 },
    button: { x: 12, y: 112, w: 84, h: 30 },
  };
}
const MAX_TURN = (110 * Math.PI) / 180; // the wheel turns up to 110° each way
const wrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

/**
 * Driving controls → [throttle, steer].
 * Phone (default "wheel"): the car drives forward by itself; turn the steering
 * wheel at the bottom left with your thumb (it springs back when you let go)
 * and hold BRAKE at the bottom right to brake, or to reverse once stopped.
 * The mode button switches to TILT (tilt the phone like a wheel; hold the
 * screen to brake) or DRAG (a thumb joystick).
 * Computer: ↑/W go, ↓/S brake & reverse, ←→/AD steer; or hold the mouse
 * button and the car drives toward the pointer.
 * `toWorld(x, y)` turns a screen position into city coordinates, `screen()`
 * gives the screen size in game units, `cssScale()` is screen pixels per unit.
 */
export function createDriveControls(input, { toWorld, screen = () => ({ w: 800, h: 480 }), cssScale = () => 1 }) {
  const touch = typeof window !== 'undefined' && (window.matchMedia?.('(hover: none) and (pointer: coarse)').matches || navigator.maxTouchPoints > 0);
  const MODES = ['wheel', 'tilt', 'drag'];
  const st = { mode: 'wheel', angle: 0, wheelId: null, grab: 0, start: 0, brakeIds: new Set(), joy: null, mouseDown: false };
  const tilt = { live: false, steer: 0, asked: false };
  const pads = () => { const { w, h } = screen(); return padLayout(w, h); };
  const screenAngle = () => (typeof window !== 'undefined' && window.screen?.orientation ? window.screen.orientation.angle : Number(window.orientation) || 0);
  const onMotion = e => {
    const g = e.accelerationIncludingGravity;
    if (!g || g.x == null) return;
    tilt.live = true;
    tilt.steer += (tiltSteer(g.x, g.y, g.z, screenAngle()) - tilt.steer) * 0.35;
  };
  if (typeof window !== 'undefined') window.addEventListener('devicemotion', onMotion);
  const askMotion = () => {
    if (tilt.asked) return;
    tilt.asked = true;
    const D = typeof DeviceMotionEvent !== 'undefined' ? DeviceMotionEvent : null;
    if (D && typeof D.requestPermission === 'function') D.requestPermission().catch(() => {});
  };
  const inRect = (p, r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  const angleAt = (p, c) => Math.atan2(p.y - c.y, p.x - c.x);

  input.on('pointerdown', (pt, e) => {
    if (pt.type === 'mouse') { st.mouseDown = true; return; }
    const id = e?.pointerId ?? 0, L = pads();
    if (touch && inRect(pt, L.button)) {
      st.mode = MODES[(MODES.indexOf(st.mode) + 1) % MODES.length];
      if (st.mode === 'tilt') askMotion();
      st.joy = null; st.wheelId = null; st.brakeIds.clear();
      return;
    }
    if (st.mode === 'wheel') {
      const w = L.wheel;
      if (inRect(pt, L.brake) || (pt.x > screen().w / 2 && Math.hypot(pt.x - w.x, pt.y - w.y) > w.r * 1.6)) { st.brakeIds.add(id); return; }
      st.wheelId = id; st.grab = angleAt(pt, w); st.start = st.angle; // grab the wheel anywhere on the left
      return;
    }
    if (st.mode === 'tilt') { askMotion(); st.brakeIds.add(id); return; }
    st.joy = { id, ox: pt.x, oy: pt.y, cx: pt.x, cy: pt.y };
  });
  input.on('pointermove', (pt, e) => {
    const id = e?.pointerId ?? 0;
    if (st.mode === 'wheel' && id === st.wheelId) {
      const w = pads().wheel;
      if (Math.hypot(pt.x - w.x, pt.y - w.y) < w.r * 0.18) return; // too close to the middle to read an angle
      const a = angleAt(pt, w);
      st.start += wrap(a - st.grab); st.grab = a; // follow the thumb round the wheel
      st.angle = Math.max(-MAX_TURN, Math.min(MAX_TURN, st.start));
      return;
    }
    if (st.joy && id === st.joy.id && pt.down) {
      const j = st.joy; j.cx = pt.x; j.cy = pt.y;
      const R = 46 / cssScale(), dx = j.cx - j.ox, dy = j.cy - j.oy, d = Math.hypot(dx, dy);
      if (d > R) { j.ox = j.cx - (dx / d) * R; j.oy = j.cy - (dy / d) * R; }
    }
  });
  input.on('pointerup', (pt, e) => {
    const id = e?.pointerId ?? 0;
    if (pt.type === 'mouse') st.mouseDown = false;
    if (id === st.wheelId) st.wheelId = null;
    st.brakeIds.delete(id);
    if (st.joy?.id === id) st.joy = null;
  });
  const towards = (car, ang, mag) => {
    const diff = wrap(ang - car.a);
    if (Math.abs(diff) > 2.5 && car.v < 80) return [-0.85 * mag, -Math.sign(diff) * Math.min(1, (Math.PI - Math.abs(diff)) * 2.5)];
    return [mag * (Math.abs(diff) > 1.4 ? 0.45 : 1), Math.max(-1, Math.min(1, diff * 2.6))];
  };
  let last = performance.now();
  return {
    get mode() { return st.mode; },
    read(car) {
      const now = performance.now(), dt = Math.min(1, (now - last) / 1000); last = now;
      // the wheel springs back to straight when you let go
      if (st.wheelId === null && st.angle) st.angle = Math.abs(st.angle) < 0.03 ? 0 : st.angle * Math.pow(0.0005, dt);
      const k = input.keys;
      const up = k.has('ArrowUp') || k.has('w') || k.has('W'), down = k.has('ArrowDown') || k.has('s') || k.has('S');
      const left = k.has('ArrowLeft') || k.has('a') || k.has('A'), right = k.has('ArrowRight') || k.has('d') || k.has('D');
      if (up || down || left || right) return [(up ? 1 : 0) - (down ? 1 : 0), (right ? 1 : 0) - (left ? 1 : 0)];
      if (st.mouseDown && input.pointer.inside) {
        const w = toWorld(input.pointer.x, input.pointer.y), d = Math.hypot(w.x - car.x, w.y - car.y);
        return d < 18 ? [0, 0] : towards(car, Math.atan2(w.y - car.y, w.x - car.x), Math.min(1, d / 120));
      }
      if (!touch) return [0, 0];
      const brake = st.brakeIds.size > 0;
      if (st.mode === 'wheel') return [brake ? -1 : 1, Math.max(-1, Math.min(1, st.angle / (MAX_TURN * 0.8)))];
      if (st.mode === 'tilt') return [brake ? -1 : 1, tilt.live ? tilt.steer : 0];
      if (st.joy) {
        const R = 46 / cssScale(), dx = st.joy.cx - st.joy.ox, dy = st.joy.cy - st.joy.oy, d = Math.hypot(dx, dy);
        return d < R * 0.18 ? [0, 0] : towards(car, Math.atan2(dy, dx), Math.min(1, d / R));
      }
      return [0, 0];
    },
    /** the wheel, pedal, mode button and joystick (screen coordinates) */
    draw(ctx) {
      if (!touch) return;
      const L = pads();
      ctx.save();
      // mode button
      ctx.fillStyle = 'rgba(21,18,46,.85)'; ctx.strokeStyle = 'rgba(236,233,255,.4)'; ctx.lineWidth = 1.5;
      roundRect(ctx, L.button.x, L.button.y, L.button.w, L.button.h, 15); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = '800 12px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(st.mode === 'wheel' ? '🛞 WHEEL' : st.mode === 'tilt' ? '📱 TILT' : '👆 DRAG', L.button.x + L.button.w / 2, L.button.y + L.button.h / 2 + 1);
      if (st.mode !== 'drag') {
        // brake pedal
        const b = L.brake, on = st.brakeIds.size > 0;
        ctx.globalAlpha = on ? 0.95 : 0.6;
        ctx.fillStyle = on ? '#ff4d4d' : 'rgba(21,18,46,.8)'; ctx.strokeStyle = '#ff4d4d'; ctx.lineWidth = 2;
        roundRect(ctx, b.x, b.y, b.w, b.h, 12); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = on ? 'rgba(255,255,255,.5)' : 'rgba(255,77,77,.5)'; ctx.lineWidth = 3;
        for (let i = 1; i <= 3; i++) { const yy = b.y + (b.h * i) / 4; ctx.beginPath(); ctx.moveTo(b.x + 12, yy); ctx.lineTo(b.x + b.w - 12, yy); ctx.stroke(); }
        ctx.globalAlpha = 1; ctx.fillStyle = '#fff'; ctx.font = '900 12px system-ui, sans-serif';
        ctx.fillText('BRAKE', b.x + b.w / 2, b.y + b.h + 12);
      }
      if (st.mode === 'wheel') {
        // the steering wheel, turned as far as the thumb turned it
        const w = L.wheel;
        ctx.save(); ctx.translate(w.x, w.y); ctx.rotate(st.angle);
        ctx.globalAlpha = st.wheelId !== null ? 0.95 : 0.7;
        ctx.strokeStyle = 'rgba(12,10,29,.7)'; ctx.lineWidth = w.r * 0.3; ctx.beginPath(); ctx.arc(0, 0, w.r * 0.86, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = '#ece9ff'; ctx.lineWidth = w.r * 0.2; ctx.beginPath(); ctx.arc(0, 0, w.r * 0.86, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = '#ff3d9a'; ctx.lineWidth = w.r * 0.2; ctx.beginPath(); ctx.arc(0, 0, w.r * 0.86, -Math.PI / 2 - 0.22, -Math.PI / 2 + 0.22); ctx.stroke(); // top mark
        ctx.strokeStyle = '#ece9ff'; ctx.lineWidth = w.r * 0.13; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(-w.r * 0.78, 0); ctx.lineTo(w.r * 0.78, 0); ctx.moveTo(0, 0); ctx.lineTo(0, w.r * 0.78); ctx.stroke();
        ctx.fillStyle = '#15122e'; ctx.beginPath(); ctx.arc(0, 0, w.r * 0.26, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#ece9ff'; ctx.lineWidth = 3; ctx.stroke();
        ctx.restore();
      }
      ctx.restore();
      if (st.mode === 'drag' && st.joy) {
        ctx.save();
        const R = 46 / cssScale(), j = st.joy, dx = j.cx - j.ox, dy = j.cy - j.oy, d = Math.hypot(dx, dy), m = d > R ? R / d : 1;
        ctx.strokeStyle = 'rgba(236,233,255,.3)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(j.ox, j.oy, R, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = 'rgba(255,61,154,.4)'; ctx.beginPath(); ctx.arc(j.ox + dx * m, j.oy + dy * m, R * 0.42, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    },
    destroy() { if (typeof window !== 'undefined') window.removeEventListener('devicemotion', onMotion); },
  };
}

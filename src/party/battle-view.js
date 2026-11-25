// Ship Battle in the browser: smooth drawing of the server's arena.
//
// Your own ship moves instantly (predicted locally). When a server update
// arrives, it is compared with where *we* were one round-trip ago (the moment
// the server's copy is really from), and only that difference is corrected,
// gently. This stops the old "rubber band" pull backwards while moving.
// Other ships are drawn ~110 ms in the past and blended between server
// updates so they glide instead of jumping.
//
// The arena fills the screen. On a phone held upright it is turned sideways
// (the HUD and all text stay upright), so the arena uses the tall screen.
// Touch: drag anywhere for a floating joystick.

import { W, H, TOP, SHIP_R, MAX_HP, DURATION, buildArena, moveShip } from './battle.js';
import { C, MONO, drawHud } from '../games/draw.js';
import { fitLayout, toScreen, fromScreen, createSpace } from './screen-fit.js';

export { toScreen, fromScreen };

const RENDER_DELAY = 110;
const JOY_CSS = 46;                // joystick radius in screen pixels
const lerp = (a, b, t) => a + (b - a) * t;
const lerpAngle = (a, b, t) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * t; };

/** Screen layout for the arena. Portrait screens get the arena turned sideways. */
export const battleLayout = (boxW, boxH) => fitLayout(boxW, boxH, { rotate: true });

export function createBattleView({ ctx, input, send, serverNow, getParty, getMe, color, sound, parts, view, rtt = () => 150 }) {
  let blocks = [], seed = null;
  const snaps = [];                  // last few server updates
  let mine = null;                   // my predicted ship { x, y, a, alive }
  let srvMine = null;                // my ship in the latest server update
  const hist = [];                   // my predicted positions { t, x, y } for the last second
  let lastSent = { mx: 9, my: 9, at: 0 };
  let joy = null, mode = 'mouse';
  const feed = [];                   // "Dara ✕ Sokha" lines
  const floats = [];                 // "KO!" etc., drawn upright
  const seen = new Map();            // bullet id → first time seen (to blend my new shots onto my ship)
  let myDownAt = null;

  input.setMap((u, v) => fromScreen(view, u, v));

  // ---- controls ----
  const joyR = () => JOY_CSS / (view.css || 1);
  input.on('pointerdown', pt => {
    mode = pt.type === 'mouse' ? 'mouse' : 'touch';
    joy = mode === 'touch' ? { ox: pt.x, oy: pt.y, cx: pt.x, cy: pt.y } : null;
  });
  input.on('pointermove', pt => {
    if (!joy || !pt.down) return;
    joy.cx = pt.x; joy.cy = pt.y;
    // floating stick: if the finger goes past the rim, drag the base along
    const R = joyR(), dx = joy.cx - joy.ox, dy = joy.cy - joy.oy, d = Math.hypot(dx, dy);
    if (d > R) { joy.ox = joy.cx - (dx / d) * R; joy.oy = joy.cy - (dy / d) * R; }
  });
  input.on('pointerup', () => { joy = null; });
  input.on('keydown', () => { mode = 'keys'; });

  const keyOf = idx => snaps.at(-1)?.who?.[idx];
  const nameOf = key => getParty()?.players.find(p => p.key === key)?.name || '?';

  function myInput() {
    const k = input.keys;
    const kx = (k.has('ArrowRight') || k.has('d') || k.has('D') ? 1 : 0) - (k.has('ArrowLeft') || k.has('a') || k.has('A') ? 1 : 0);
    const ky = (k.has('ArrowDown') || k.has('s') || k.has('S') ? 1 : 0) - (k.has('ArrowUp') || k.has('w') || k.has('W') ? 1 : 0);
    if (kx || ky) return [kx, ky];
    if (!mine) return [0, 0];
    if (joy) {
      const R = joyR(), dx = joy.cx - joy.ox, dy = joy.cy - joy.oy, d = Math.hypot(dx, dy);
      if (d < R * 0.15) return [0, 0];
      const m = Math.min(1, d / R);
      return [(dx / d) * m, (dy / d) * m];
    }
    if (mode === 'mouse' && input.pointer.inside && input.pointer.type === 'mouse') {
      const dx = input.pointer.x - mine.x, dy = input.pointer.y - mine.y, d = Math.hypot(dx, dy);
      if (d < 10) return [0, 0];
      const m = Math.min(1, d / 60); // ease in near the cursor so the ship settles instead of wobbling
      return [(dx / d) * m, (dy / d) * m];
    }
    return [0, 0];
  }

  // ---- server updates ----
  function onSnap(m) {
    const party = getParty();
    if (party && party.seed !== seed) { seed = party.seed; blocks = buildArena(seed); }
    snaps.push(m);
    if (snaps.length > 8) snaps.shift();
    const me = getMe();
    const myIdx = m.who.indexOf(me);
    const srv = m.ships.find(s => s[0] === myIdx);
    if (srv) {
      const [, x, y, a, , alive] = srv;
      srvMine = { x, y };
      if (!mine || !alive || !mine.alive) { mine = { x, y, a }; hist.length = 0; }
      else {
        // Where was I when the server made this update? About one round-trip
        // (plus half a server tick) ago. Correct only the difference from then.
        const r = Number.isFinite(rtt()) ? Math.min(600, rtt()) : 150;
        const at = performance.now() - r - 25;
        let past = null;
        for (let i = hist.length - 1; i >= 0; i--) { past = hist[i]; if (hist[i].t <= at) break; }
        const ex = x - (past ? past.x : mine.x), ey = y - (past ? past.y : mine.y);
        if (Math.hypot(ex, ey) > 90) { mine.x = x; mine.y = y; hist.length = 0; }
        else if (Math.hypot(ex, ey) > 1.5) {
          const cx = ex * 0.3, cy = ey * 0.3;
          mine.x += cx; mine.y += cy;
          for (const h of hist) { h.x += cx; h.y += cy; } // history moves with the fix, so it isn't counted twice
        }
      }
      mine.alive = !!alive;
      if (alive) myDownAt = null;
    }
    const ids = new Set();
    for (const bl of m.bullets) { ids.add(bl[0]); if (!seen.has(bl[0])) seen.set(bl[0], performance.now()); }
    for (const id of seen.keys()) if (!ids.has(id)) seen.delete(id);

    for (const e of m.events || []) {
      const key = m.who[e.k], by = m.who[e.by];
      const ship = m.ships.find(s => s[0] === e.k);
      if (e.e === 'hit' && ship) { parts.burst(ship[1], ship[2], color(key), 6); if (key === me) sound.miss(); }
      if (e.e === 'ko') {
        parts.burst(e.x, e.y, color(key), 30); parts.burst(e.x, e.y, C.yellow, 14);
        feed.push({ text: `${nameOf(by)} ✕ ${nameOf(key)}`, mine: by === me || key === me, until: performance.now() + 3500 });
        if (feed.length > 4) feed.shift();
        if (by === me) { sound.hit(); floats.push({ x: e.x, y: e.y, text: 'KO!', color: C.yellow, at: performance.now() }); }
        if (key === me) { sound.bad(); myDownAt = performance.now(); }
      }
      if (e.e === 'pickup' && ship) {
        floats.push({ x: ship[1], y: ship[2], text: e.kind === 'heal' ? 'SHIELDS FULL' : 'RAPID FIRE', color: e.kind === 'heal' ? C.lime : C.cyan, at: performance.now() });
        if (key === me) sound.go();
      }
    }
  }

  function update(dt) {
    const [mx, my] = myInput();
    if (mine?.alive) {
      moveShip(mine, mx, my, dt, blocks);
      const t = performance.now();
      hist.push({ t, x: mine.x, y: mine.y });
      while (hist.length && hist[0].t < t - 1000) hist.shift();
    }
    const nowMs = performance.now();
    const changed = Math.abs(mx - lastSent.mx) > 0.05 || Math.abs(my - lastSent.my) > 0.05;
    const stopped = mx === 0 && my === 0 && (lastSent.mx !== 0 || lastSent.my !== 0);
    if (stopped || (changed && nowMs - lastSent.at > 33) || nowMs - lastSent.at > 400) {
      lastSent = { mx, my, at: nowMs };
      send({ type: 'input', mx: Math.round(mx * 100) / 100, my: Math.round(my * 100) / 100 });
    }
  }

  // ---- drawing helpers ----
  const space = createSpace(ctx, view);
  const worldSpace = space.world, screenSpace = space.screen, off = space.off, upright = space.upright;

  function drawShip(x, y, a, col, { me = false, inv = false, rapid = false, hp = MAX_HP, name = '' } = {}) {
    if (inv && Math.floor(performance.now() / 90) % 2 === 0) return;
    ctx.save(); ctx.translate(x, y);
    if (me) { ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, 0, SHIP_R + 7, 0, Math.PI * 2); ctx.stroke(); }
    ctx.rotate(a);
    ctx.shadowColor = col; ctx.shadowBlur = rapid ? 22 : 12;
    ctx.fillStyle = '#121029'; ctx.strokeStyle = col; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(SHIP_R + 4, 0); ctx.lineTo(-SHIP_R + 2, SHIP_R - 3); ctx.lineTo(-SHIP_R + 6, 0); ctx.lineTo(-SHIP_R + 2, -SHIP_R + 3); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
    // keep the label out from under the score bar
    const nearTop = view.portrait ? x - SHIP_R - 22 < 0 : y - SHIP_R - 10 < TOP + 12;
    const [lx, ly] = off(x, y, 0, nearTop ? SHIP_R + 24 : -SHIP_R - 10);
    upright(lx, ly, () => { ctx.font = '700 11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = me ? C.text : col; ctx.fillText(name.slice(0, 12), 0, 0); });
    const [bx, by] = off(x, y, 0, SHIP_R + 6);
    upright(bx, by, () => { for (let i = 0; i < MAX_HP; i++) { ctx.fillStyle = i < hp ? col : 'rgba(141,136,179,.3)'; ctx.fillRect(-13 + i * 9, 0, 7, 3); } });
  }

  function render() {
    const party = getParty(), me = getMe();
    if (!party) return;
    const now = serverNow(), t = performance.now();
    screenSpace();
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, view.sw, view.sh);
    worldSpace();
    ctx.strokeStyle = 'rgba(141,136,179,0.07)'; ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += 40) { ctx.beginPath(); ctx.moveTo(x, TOP); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = TOP; y <= H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(141,136,179,0.22)'; ctx.strokeRect(1, TOP + 1, W - 2, H - TOP - 2);
    // cover
    for (const b of blocks) {
      ctx.save(); ctx.fillStyle = '#16142c'; ctx.strokeStyle = 'rgba(141,136,179,.55)'; ctx.lineWidth = 2; ctx.shadowColor = 'rgba(141,136,179,.5)'; ctx.shadowBlur = 8;
      ctx.fillRect(b.x, b.y, b.w, b.h); ctx.strokeRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2); ctx.restore();
    }
    const last = snaps.at(-1);
    if (!last) { screenSpace(); drawHud(ctx, view.sw, { left: 'GET READY', right: '', progress: 0 }); return; }
    // pickups
    for (const [x, y, kind] of last.pickups) {
      const col = kind === 0 ? C.lime : C.cyan;
      ctx.save(); ctx.strokeStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 14; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(x, y, 12 + Math.sin(now / 160) * 1.5, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      upright(x, y, () => { ctx.fillStyle = col; ctx.font = '900 13px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(kind === 0 ? '+' : 'R', 0, 1); });
    }
    // bullets: moved forward from the last update; my fresh shots start from where I see my ship
    const myIdx = last.who.indexOf(me);
    const lagX = mine && srvMine ? mine.x - srvMine.x : 0, lagY = mine && srvMine ? mine.y - srvMine.y : 0;
    const dtB = Math.min(0.15, Math.max(0, (now - last.t) / 1000));
    for (const [id, x, y, vx, vy, o] of last.bullets) {
      let bx = x + vx * dtB, by = y + vy * dtB;
      if (o === myIdx) { const f = Math.max(0, 1 - (t - (seen.get(id) || 0)) / 300); bx += lagX * f; by += lagY * f; }
      if (blocks.some(r => bx > r.x && bx < r.x + r.w && by > r.y && by < r.y + r.h)) continue;
      ctx.fillStyle = color(last.who[o]); ctx.beginPath(); ctx.arc(bx, by, 3.5, 0, Math.PI * 2); ctx.fill();
    }
    // ships: blend the two updates around (now - delay)
    const rt = now - RENDER_DELAY;
    let older = snaps[0], newer = last;
    for (let i = snaps.length - 1; i > 0; i--) if (snaps[i - 1].t <= rt) { older = snaps[i - 1]; newer = snaps[i]; break; }
    const kk = newer.t > older.t ? Math.max(0, Math.min(1, (rt - older.t) / (newer.t - older.t))) : 1;
    for (const s of last.ships) {
      const [idx, , , , hp, alive, inv, rapid] = s;
      const key = last.who[idx];
      if (!alive) continue;
      if (key === me && mine) { drawShip(mine.x, mine.y, mine.a, color(key), { me: true, inv: !!inv, rapid: !!rapid, hp, name: 'You' }); continue; }
      const a0 = older.ships.find(x => x[0] === idx) || s, a1 = newer.ships.find(x => x[0] === idx) || s;
      drawShip(lerp(a0[1], a1[1], kk), lerp(a0[2], a1[2], kk), lerpAngle(a0[3], a1[3], kk), color(key), { inv: !!inv, rapid: !!rapid, hp, name: nameOf(key) });
    }
    parts.draw(ctx);
    for (let i = floats.length - 1; i >= 0; i--) {
      const f = floats[i], age = (t - f.at) / 1000;
      if (age > 0.9) { floats.splice(i, 1); continue; }
      const [fx, fy] = off(f.x, f.y, 0, -18 - age * 40);
      upright(fx, fy, () => { ctx.globalAlpha = 1 - age / 0.9; ctx.font = MONO; ctx.textAlign = 'center'; ctx.fillStyle = f.color; ctx.fillText(f.text, 0, 0); });
    }
    // touch joystick
    if (joy) {
      const R = joyR(), dx = joy.cx - joy.ox, dy = joy.cy - joy.oy, d = Math.hypot(dx, dy), m = d > R ? R / d : 1;
      ctx.save();
      ctx.strokeStyle = 'rgba(236,233,255,.25)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(joy.ox, joy.oy, R, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(45,226,230,.35)'; ctx.beginPath(); ctx.arc(joy.ox + dx * m, joy.oy + dy * m, R * 0.42, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    // ---- screen-space overlays (always upright) ----
    screenSpace();
    ctx.save(); ctx.font = '700 12px system-ui, sans-serif'; ctx.textAlign = 'right';
    feed.filter(f => f.until > t).forEach((f, i) => { ctx.fillStyle = f.mine ? C.yellow : 'rgba(236,233,255,.75)'; ctx.fillText(f.text, view.sw - 12, TOP + 20 + i * 18); });
    ctx.restore();
    if (myDownAt) {
      const left = Math.max(0, 2 - (t - myDownAt) / 1000);
      ctx.save(); ctx.font = '900 italic 34px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = C.red; ctx.shadowColor = C.red; ctx.shadowBlur = 18;
      ctx.fillText('KNOCKED OUT', view.sw / 2, view.sh / 2 - 6); ctx.font = MONO; ctx.shadowBlur = 0; ctx.fillStyle = C.text;
      ctx.fillText(`back in ${left.toFixed(1)}s`, view.sw / 2, view.sh / 2 + 26); ctx.restore();
    }
    const my = last.ships.find(x => last.who[x[0]] === me);
    const lead = party.players[0];
    const secs = Math.max(0, Math.ceil((party.endAt - now) / 1000));
    const narrow = view.sw < 600;
    drawHud(ctx, view.sw, {
      left: `${narrow ? '' : 'KOs '}${my ? my[8] : 0}${narrow ? ' KO' : ''}  ${'♥'.repeat(my?.[5] ? my[4] : 0)}${'♡'.repeat(my?.[5] ? MAX_HP - my[4] : MAX_HP)}`,
      right: `${!narrow && lead && lead.key !== me && lead.score > 0 ? `LEAD ${lead.name.slice(0, 10)} ` : ''}${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`,
      progress: Math.min(1, Math.max(0, 1 - (party.endAt - now) / (DURATION * 1000))),
    });
  }

  return { onSnap, update, render, keyOf };
}

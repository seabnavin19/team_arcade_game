// Ship Battle in the browser: smooth drawing of the server's arena.
// Your own ship moves instantly (predicted locally, gently corrected by the
// server); other ships are drawn 100 ms in the past and blended between
// server updates so they glide instead of jumping.

import { W, H, TOP, SHIP_R, MAX_HP, DURATION, buildArena, moveShip } from './battle.js';
import { C, MONO, drawHud } from '../games/draw.js';

const RENDER_DELAY = 100;
const lerp = (a, b, t) => a + (b - a) * t;
const lerpAngle = (a, b, t) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * t; };

export function createBattleView({ ctx, input, send, serverNow, getParty, getMe, color, sound, parts, floats }) {
  let blocks = [], seed = null;
  const snaps = [];                  // last few server updates
  let mine = null;                   // my predicted ship { x, y, a }
  let lastSent = { mx: 9, my: 9, at: 0 };
  let drag = null, mode = 'mouse';
  const feed = [];                   // "Dara ✕ Sokha" lines
  let myDownAt = null;

  input.on('pointerdown', pt => {
    mode = pt.type === 'mouse' ? 'mouse' : 'touch';
    drag = mode === 'touch' && mine ? { fx: pt.x, fy: pt.y, sx: mine.x, sy: mine.y, tx: mine.x, ty: mine.y } : null;
  });
  input.on('pointermove', pt => { if (drag && pt.down) { drag.tx = drag.sx + (pt.x - drag.fx) * 1.4; drag.ty = drag.sy + (pt.y - drag.fy) * 1.4; } });
  input.on('pointerup', () => { drag = null; });
  input.on('keydown', () => { mode = 'keys'; });

  const keyOf = idx => snaps.at(-1)?.who?.[idx];
  const nameOf = key => getParty()?.players.find(p => p.key === key)?.name || '?';

  function myInput() {
    const k = input.keys;
    const kx = (k.has('ArrowRight') || k.has('d') || k.has('D') ? 1 : 0) - (k.has('ArrowLeft') || k.has('a') || k.has('A') ? 1 : 0);
    const ky = (k.has('ArrowDown') || k.has('s') || k.has('S') ? 1 : 0) - (k.has('ArrowUp') || k.has('w') || k.has('W') ? 1 : 0);
    if (kx || ky) return [kx, ky];
    if (!mine) return [0, 0];
    let tx = null, ty = null;
    if (drag) { tx = drag.tx; ty = drag.ty; }
    else if (mode === 'mouse' && input.pointer.inside && input.pointer.type === 'mouse') { tx = input.pointer.x; ty = input.pointer.y; }
    if (tx === null) return [0, 0];
    const dx = tx - mine.x, dy = ty - mine.y, d = Math.hypot(dx, dy);
    if (d < 6) return [0, 0];
    const k2 = Math.min(1, d / 40); // slow down near the target point
    return [(dx / d) * k2, (dy / d) * k2];
  }

  function onSnap(m) {
    const party = getParty();
    if (party && party.seed !== seed) { seed = party.seed; blocks = buildArena(seed); }
    snaps.push(m);
    if (snaps.length > 4) snaps.shift();
    const me = getMe();
    const myIdx = m.who.indexOf(me);
    const srv = m.ships.find(s => s[0] === myIdx);
    if (srv) {
      const [, x, y, a, , alive] = srv;
      if (!mine || !alive || Math.hypot(mine.x - x, mine.y - y) > 70) mine = { x, y, a };
      else { mine.x = lerp(mine.x, x, 0.12); mine.y = lerp(mine.y, y, 0.12); }
      mine.alive = !!alive;
      if (alive) myDownAt = null;
    }
    for (const e of m.events || []) {
      const key = m.who[e.k], by = m.who[e.by];
      const ship = m.ships.find(s => s[0] === e.k);
      if (e.e === 'hit' && ship) { parts.burst(ship[1], ship[2], color(key), 6); if (key === me) sound.miss(); }
      if (e.e === 'ko') {
        parts.burst(e.x, e.y, color(key), 30); parts.burst(e.x, e.y, C.yellow, 14);
        feed.push({ text: `${nameOf(by)} ✕ ${nameOf(key)}`, mine: by === me || key === me, until: performance.now() + 3500 });
        if (feed.length > 4) feed.shift();
        if (by === me) { sound.hit(); floats.add(e.x, e.y - 18, 'KO!', C.yellow); }
        if (key === me) { sound.bad(); myDownAt = performance.now(); }
      }
      if (e.e === 'pickup' && ship) { floats.add(ship[1], ship[2] - 20, e.kind === 'heal' ? 'SHIELDS FULL' : 'RAPID FIRE', e.kind === 'heal' ? C.lime : C.cyan); if (key === me) sound.go(); }
    }
  }

  function update(dt) {
    const [mx, my] = myInput();
    if (mine?.alive) moveShip(mine, mx, my, dt, blocks);
    const nowMs = performance.now();
    const changed = Math.abs(mx - lastSent.mx) > 0.08 || Math.abs(my - lastSent.my) > 0.08;
    if ((changed && nowMs - lastSent.at > 45) || nowMs - lastSent.at > 400) {
      lastSent = { mx, my, at: nowMs };
      send({ type: 'input', mx: Math.round(mx * 100) / 100, my: Math.round(my * 100) / 100 });
    }
  }

  // ---- drawing ----
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
    ctx.save();
    ctx.font = '700 13px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = me ? C.text : col;
    const nearTop = y - SHIP_R - 10 < TOP + 12; // keep the label out from under the score bar
    ctx.fillText(name.slice(0, 12), x, nearTop ? y + SHIP_R + 26 : y - SHIP_R - 10);
    for (let i = 0; i < MAX_HP; i++) { ctx.fillStyle = i < hp ? col : 'rgba(141,136,179,.3)'; ctx.fillRect(x - 16 + i * 11, y + SHIP_R + 6, 9, 4); }
    ctx.restore();
  }

  function render() {
    const party = getParty(), me = getMe();
    if (!party) return;
    const now = serverNow();
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(141,136,179,0.07)'; ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += 40) { ctx.beginPath(); ctx.moveTo(x, TOP); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = TOP; y <= H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    // cover
    for (const b of blocks) {
      ctx.save(); ctx.fillStyle = '#16142c'; ctx.strokeStyle = 'rgba(141,136,179,.55)'; ctx.lineWidth = 2; ctx.shadowColor = 'rgba(141,136,179,.5)'; ctx.shadowBlur = 8;
      ctx.fillRect(b.x, b.y, b.w, b.h); ctx.strokeRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2); ctx.restore();
    }
    const last = snaps.at(-1);
    if (!last) { drawHud(ctx, W, { left: 'GET READY', right: '', progress: 0 }); return; }
    // pickups
    for (const [x, y, kind] of last.pickups) {
      const col = kind === 0 ? C.lime : C.cyan;
      ctx.save(); ctx.strokeStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 14; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(x, y, 12 + Math.sin(now / 160) * 1.5, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = col; ctx.font = '900 13px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(kind === 0 ? '+' : 'R', x, y + 1); ctx.restore();
    }
    // bullets: moved forward from the last update
    const dtB = Math.min(0.15, Math.max(0, (now - last.t) / 1000));
    for (const [, x, y, vx, vy, o] of last.bullets) {
      const bx = x + vx * dtB, by = y + vy * dtB;
      if (blocks.some(r => bx > r.x && bx < r.x + r.w && by > r.y && by < r.y + r.h)) continue;
      ctx.fillStyle = color(last.who[o]); ctx.beginPath(); ctx.arc(bx, by, 3.5, 0, Math.PI * 2); ctx.fill();
    }
    // ships: blend the two updates around (now - 100 ms)
    const rt = now - RENDER_DELAY;
    let older = snaps[0], newer = last;
    for (let i = snaps.length - 1; i > 0; i--) if (snaps[i - 1].t <= rt) { older = snaps[i - 1]; newer = snaps[i]; break; }
    const k = newer.t > older.t ? Math.max(0, Math.min(1, (rt - older.t) / (newer.t - older.t))) : 1;
    for (const s of last.ships) {
      const [idx, , , , hp, alive, inv, rapid] = s;
      const key = last.who[idx];
      if (!alive) continue;
      if (key === me && mine) { drawShip(mine.x, mine.y, mine.a, color(key), { me: true, inv: !!inv, rapid: !!rapid, hp, name: 'You' }); continue; }
      const a0 = older.ships.find(x => x[0] === idx) || s, a1 = newer.ships.find(x => x[0] === idx) || s;
      drawShip(lerp(a0[1], a1[1], k), lerp(a0[2], a1[2], k), lerpAngle(a0[3], a1[3], k), color(key), { inv: !!inv, rapid: !!rapid, hp, name: nameOf(key) });
    }
    parts.draw(ctx); floats.draw(ctx);
    // KO feed
    const t = performance.now();
    ctx.save(); ctx.font = '700 12px system-ui, sans-serif'; ctx.textAlign = 'right';
    feed.filter(f => f.until > t).forEach((f, i) => { ctx.fillStyle = f.mine ? C.yellow : 'rgba(236,233,255,.75)'; ctx.fillText(f.text, W - 12, TOP + 20 + i * 18); });
    ctx.restore();
    if (myDownAt) {
      const left = Math.max(0, 2 - (t - myDownAt) / 1000);
      ctx.save(); ctx.font = '900 italic 34px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = C.red; ctx.shadowColor = C.red; ctx.shadowBlur = 18;
      ctx.fillText('KNOCKED OUT', W / 2, H / 2 - 6); ctx.font = MONO; ctx.shadowBlur = 0; ctx.fillStyle = C.text;
      ctx.fillText(`back in ${left.toFixed(1)}s`, W / 2, H / 2 + 26); ctx.restore();
    }
    // HUD
    const my = last.ships.find(x => last.who[x[0]] === me);
    const lead = party.players[0];
    const secs = Math.max(0, Math.ceil((party.endAt - now) / 1000));
    drawHud(ctx, W, {
      left: `KOs ${my ? my[8] : 0}  ${'♥'.repeat(my?.[5] ? my[4] : 0)}${'♡'.repeat(my?.[5] ? MAX_HP - my[4] : MAX_HP)}`,
      right: `${lead && lead.key !== me && lead.score > 0 ? `LEAD ${lead.name.slice(0, 10)} ` : ''}${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`,
      progress: Math.min(1, Math.max(0, 1 - (party.endAt - now) / (DURATION * 1000))),
    });
  }

  return { onSnap, update, render };
}

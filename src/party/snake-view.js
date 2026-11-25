// Snake Arena in the browser. The server moves the snakes 8 times a second;
// we slide each segment smoothly between those moves. Steer with arrow keys /
// WASD, by swiping on the board, or with the on-screen arrows on phones.
// On an upright phone the board is turned sideways to fill the screen; the
// arrows and keys always mean "that way on screen".

import { COLS, ROWS, CELL, TOP, TICK_MS, RESPAWN_TICKS } from './snake.js';
import { C, MONO, drawHud } from '../games/draw.js';
import { fromScreen, screenDir, createSpace } from './screen-fit.js';

const W = COLS * CELL, H = TOP + ROWS * CELL;
const KEYMAP = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right' };

export function createSnakeView({ ctx, input, send, serverNow, getParty, getMe, color, sound, parts, floats, dpad, view = { portrait: false, sw: W, sh: H, css: 1 } }) {
  const space = createSpace(ctx, view);
  input.setMap((u, v) => fromScreen(view, u, v));
  let prev = null, cur = null, curAt = 0;
  let swipe = null, myDownAt = null;
  const feed = [];

  const turn = d => { send({ type: 'dir', d }); };
  input.on('keydown', e => { if (KEYMAP[e.key]) { e.preventDefault?.(); turn(screenDir(view, KEYMAP[e.key])); } });
  input.on('pointerdown', pt => { swipe = { x: pt.x, y: pt.y, done: false }; });
  input.on('pointermove', pt => {
    if (!swipe || swipe.done || !pt.down) return;
    const dx = pt.x - swipe.x, dy = pt.y - swipe.y;
    if (Math.hypot(dx, dy) < 24) return;
    turn(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
    swipe = { x: pt.x, y: pt.y, done: false }; // keep swiping to chain turns
  });
  input.on('pointerup', () => { swipe = null; });
  dpad?.addEventListener('pointerdown', e => { const b = e.target.closest('[data-d]'); if (b) { e.preventDefault(); turn(screenDir(view, b.dataset.d)); } });

  const nameOf = key => getParty()?.players.find(p => p.key === key)?.name || '?';
  const bodyOf = arr => { const out = []; for (let i = 3; i < arr.length; i += 2) out.push([arr[i], arr[i + 1]]); return out; };

  function onSnap(m) {
    prev = cur; cur = m; curAt = performance.now();
    const me = getMe();
    for (const e of m.events || []) {
      const key = m.who[e.k], by = e.by >= 0 ? m.who[e.by] : null;
      const px = e.x * CELL + CELL / 2, py = TOP + e.y * CELL + CELL / 2;
      if (e.e === 'eat') { parts.burst(px, py, e.gold ? C.yellow : color(key), e.gold ? 14 : 6); if (key === me) { sound.tick(); if (e.gold) floats.add(px, py - 10, '+3', C.yellow); } }
      if (e.e === 'ko') {
        parts.burst(px, py, color(key), 26);
        feed.push({ text: by ? `${nameOf(key)} crashed into ${nameOf(by)}` : `${nameOf(key)} crashed`, mine: key === me || by === me, until: performance.now() + 3500 });
        if (feed.length > 4) feed.shift();
        if (by === me) { sound.hit(); floats.add(px, py - 12, '+5', C.yellow); }
        if (key === me) { sound.bad(); myDownAt = performance.now(); }
      }
      if (e.e === 'spawn' && key === me) myDownAt = null;
    }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function render() {
    const party = getParty(), me = getMe();
    if (!party) return;
    space.screen();
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, view.sw, view.sh);
    space.world();
    // board
    ctx.fillStyle = '#100d24'; ctx.fillRect(0, TOP, W, ROWS * CELL);
    ctx.fillStyle = 'rgba(141,136,179,0.10)';
    for (let x = 0; x < COLS; x++) for (let y = 0; y < ROWS; y++) if ((x + y) % 2 === 0) ctx.fillRect(x * CELL, TOP + y * CELL, CELL, CELL);
    ctx.strokeStyle = 'rgba(255,61,154,.6)'; ctx.lineWidth = 2; ctx.strokeRect(1, TOP + 1, W - 2, ROWS * CELL - 2);
    if (!cur) { space.screen(); drawHud(ctx, view.sw, { left: 'GET READY', right: '', progress: 0 }); return; }

    // food
    const pulse = 1 + Math.sin(performance.now() / 180) * 0.12;
    for (const [x, y, gold] of cur.food) {
      const cx = x * CELL + CELL / 2, cy = TOP + y * CELL + CELL / 2;
      ctx.save(); ctx.fillStyle = gold ? C.yellow : '#ff7a59'; ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = gold ? 16 : 8;
      ctx.beginPath(); ctx.arc(cx, cy, (gold ? 6.5 : 4.5) * pulse, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    // snakes, slid smoothly from the previous move to this one
    const k = Math.min(1, (performance.now() - curAt) / TICK_MS);
    for (const arr of cur.snakes) {
      const [idx, alive] = arr;
      if (!alive) continue;
      const key = cur.who[idx], col = color(key), body = bodyOf(arr);
      const before = prev?.snakes.find(s => s[0] === idx);
      const old = before && before[1] ? bodyOf(before) : null;
      const pos = body.map(([x, y], i) => {
        const o = old?.[i] || old?.at(-1);
        const ok = o && Math.abs(o[0] - x) + Math.abs(o[1] - y) === 1;
        const fx = ok ? o[0] + (x - o[0]) * k : x, fy = ok ? o[1] + (y - o[1]) * k : y;
        return [fx * CELL, TOP + fy * CELL];
      });
      ctx.save();
      ctx.shadowColor = col; ctx.shadowBlur = key === me ? 14 : 6;
      for (let i = pos.length - 1; i >= 0; i--) {
        const [px, py] = pos[i];
        ctx.globalAlpha = 0.55 + 0.45 * (1 - i / Math.max(1, pos.length));
        ctx.fillStyle = col; roundRect(px + 2, py + 2, CELL - 4, CELL - 4, i === 0 ? 7 : 5); ctx.fill();
      }
      ctx.globalAlpha = 1; ctx.shadowBlur = 0;
      // eyes
      const [hx, hy] = pos[0];
      ctx.fillStyle = '#0c0a1d';
      ctx.beginPath(); ctx.arc(hx + 7, hy + 8, 2.3, 0, Math.PI * 2); ctx.arc(hx + 13, hy + 8, 2.3, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      // name over the head (on screen), the right way up
      const label = key === me ? 'You' : nameOf(key).slice(0, 10);
      const cx = hx + CELL / 2, cy = hy + CELL / 2;
      const nearTop = view.portrait ? cx - 15 < 10 : cy - 15 < TOP + 10;
      const [lx, ly] = space.off(cx, cy, 0, nearTop ? 22 : -15);
      space.upright(lx, ly, () => { ctx.font = '700 11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = key === me ? C.text : col; ctx.fillText(label, 0, 0); });
    }
    parts.draw(ctx); space.floats(floats.list, MONO);
    // crash feed and messages, drawn on the screen (never sideways)
    space.screen();
    const t = performance.now();
    ctx.save(); ctx.font = '700 12px system-ui, sans-serif'; ctx.textAlign = 'right';
    feed.filter(f => f.until > t).forEach((f, i) => { ctx.fillStyle = f.mine ? C.yellow : 'rgba(236,233,255,.75)'; ctx.fillText(f.text, view.sw - 10, TOP + 18 + i * 17); });
    ctx.restore();
    if (myDownAt) {
      const left = Math.max(0, (RESPAWN_TICKS * TICK_MS) / 1000 - (t - myDownAt) / 1000);
      ctx.save(); ctx.font = '900 italic 34px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = C.red; ctx.shadowColor = C.red; ctx.shadowBlur = 18;
      ctx.fillText('CRASHED!', view.sw / 2, view.sh / 2 - 6); ctx.font = MONO; ctx.shadowBlur = 0; ctx.fillStyle = C.text;
      ctx.fillText(`back in ${left.toFixed(1)}s`, view.sw / 2, view.sh / 2 + 26); ctx.restore();
    }
    // HUD
    const mine = cur.snakes.find(s => cur.who[s[0]] === me);
    const myLen = mine && mine[1] ? (mine.length - 3) / 2 : 0;
    const lead = party.players[0];
    const secs = Math.max(0, Math.ceil((party.endAt - serverNow()) / 1000));
    const narrow = view.sw < 600;
    drawHud(ctx, view.sw, {
      left: narrow ? `${mine ? mine[2] : 0} PTS  LEN ${myLen}` : `POINTS ${mine ? mine[2] : 0}   LENGTH ${myLen}`,
      right: `${!narrow && lead && lead.key !== me && lead.score > 0 ? `LEAD ${lead.name.slice(0, 10)} ` : ''}${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`,
      progress: Math.min(1, Math.max(0, 1 - (party.endAt - serverNow()) / ((party.endAt - party.startAt) || 1))),
    });
  }

  return { onSnap, update() {}, render };
}

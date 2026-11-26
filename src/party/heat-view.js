// GTP6 party view: everyone's car in one city, seen from above, with
// a camera that follows your car. The screen shape decides how much of the
// street you see (an upright phone sees more road ahead and behind).
//
// Your phone drives your own car, exactly as in the solo game, and tells the
// server where it is ~20 times a second; the server checks it's believable and
// does the rest (loot, police, rams, busts). So your car never gets pulled
// back and forth. Other cars and the police glide between server updates.

import { buildCity, driveCar, MAX_STARS } from '../games/street.js';
import { cameraFor, drawCity, drawCar, drawLoot, drawStars, drawMinimap, drawPointer, createDriveControls } from '../games/street-draw.js';
import { C, drawHud } from '../games/draw.js';

const RENDER_DELAY = 110;
const lerp = (a, b, t) => a + (b - a) * t;
const lerpAngle = (a, b, t) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * t; };

/** How much street to show: the short side of the screen is 480 game units. */
export function heatLayout(boxW, boxH) {
  const css = Math.max(0.1, Math.min(boxW, boxH) / 480);
  return { portrait: false, sw: boxW / css, sh: boxH / css, css };
}

export function createHeatView({ ctx, input, send, serverNow, getParty, getMe, color, sound, parts, floats, view }) {
  let city = null, seed = null;
  const snaps = [];
  let mine = null;
  let cam = null, banner = null, lastSent = { at: 0 };
  const controls = createDriveControls(input, {
    toWorld: (x, y) => ({ x: x + (cam?.x || 0), y: y + (cam?.y || 0) }),
    screen: () => ({ w: view.sw, h: view.sh }),
    city: () => city,
    cssScale: () => view.css || 1,
  });
  const say = (text, col, ms = 1600) => { banner = { text, col, until: performance.now() + ms }; };
  const nameOf = key => getParty()?.players.find(p => p.key === key)?.name || '?';

  function onSnap(m) {
    const party = getParty();
    if (party && party.seed !== seed) { seed = party.seed; city = buildCity(seed); }
    snaps.push(m);
    if (snaps.length > 8) snaps.shift();
    const me = getMe(), myIdx = m.who.indexOf(me);
    const srv = m.cars.find(c => c[0] === myIdx);
    if (srv) {
      const [, x, y, a, v, , , , , stun] = srv;
      // the first update places the car; after that it's ours, except when busted (the server holds it)
      if (!mine) mine = { x, y, a, v, assist: true };
      if (stun) { mine.v = 0; if (Math.hypot(x - mine.x, y - mine.y) > 60) Object.assign(mine, { x, y }); }
      mine.stun = !!stun;
    }
    for (const e of m.events || []) {
      const mineEv = m.who[e.k] === me || e.k === me;
      if (e.e === 'grab') { parts.burst(e.x, e.y, C.yellow, 14); if (e.k === me) { sound.hit(); floats.add(e.x, e.y - 14, `+$${e.v}`, C.yellow); } }
      if (e.e === 'bank' && mineEv) { sound.go(); say(e.bonus ? `BANKED $${e.v} · ${e.n}-grab haul +$${e.bonus}` : `BANKED $${e.v}`, C.lime, 2000); }
      if (e.e === 'hot' && mineEv) { sound.miss(); say('Lose the cops first!', C.red); }
      if (e.e === 'wash' && mineEv) { sound.go(); say('Fresh paint, no heat', C.cyan); }
      if (e.e === 'lost' && mineEv) say('LOST THEM', C.lime);
      if (e.e === 'stars' && mineEv && e.n > 0) say(`WANTED ${'★'.repeat(e.n)}`, C.red, 1100);
      if (e.e === 'busted') { if (mineEv) { sound.bad(); say(e.v ? `BUSTED · lost $${e.v}` : 'BUSTED', C.red, 2000); } else say(`${nameOf(e.k)} got busted!`, C.cyan, 1400); }
      if (e.e === 'ram') {
        parts.burst(e.x, e.y, C.yellow, 20);
        if (e.to === me) { sound.bad(); say(`${nameOf(e.by)} knocked $${e.v} loose!`, C.red); }
        else if (e.by === me) { sound.hit(); say(`Rammed ${nameOf(e.to)}: $${e.v} dropped`, C.yellow); }
      }
    }
  }

  function update(dt) {
    if (!city || !mine) return;
    const [th, st] = mine.stun ? [0, 0] : controls.read(mine);
    driveCar(mine, th, st, Math.min(dt, 0.05), city);
    // tell the server where we are, 20 times a second
    const t = performance.now();
    if (t - lastSent.at >= 50) {
      lastSent = { at: t };
      send({ type: 'drive', x: Math.round(mine.x * 10) / 10, y: Math.round(mine.y * 10) / 10, a: Math.round(mine.a * 1000) / 1000, v: Math.round(mine.v) });
    }
  }

  function render() {
    const party = getParty(), me = getMe();
    const k = ctx.canvas.width / view.sw;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, view.sw, view.sh);
    const last = snaps.at(-1);
    if (!party || !city || !last || !mine) { drawHud(ctx, view.sw, { left: 'GET READY', right: '', progress: 0 }); return; }
    const now = serverNow(), t = now / 1000;
    cam = cameraFor(mine, view.sw, view.sh, cam);
    ctx.save(); ctx.translate(-cam.x, -cam.y);
    drawCity(ctx, city, cam, t);
    const loot = last.loot.map(([id, x, y, value, kind]) => ({ id, x, y, value, kind }));
    for (const l of loot) drawLoot(ctx, l, t);
    // others and police: blend the two updates around (now - delay)
    const rt = now - RENDER_DELAY;
    let older = snaps[0], newer = last;
    for (let i = snaps.length - 1; i > 0; i--) if (snaps[i - 1].t <= rt) { older = snaps[i - 1]; newer = snaps[i]; break; }
    const kk = newer.t > older.t ? Math.max(0, Math.min(1, (rt - older.t) / (newer.t - older.t))) : 1;
    const cops = newer.cops.map(c => { const o = older.cops.find(x => x[0] === c[0]) || c; return { x: lerp(o[1], c[1], kk), y: lerp(o[2], c[2], kk), a: lerpAngle(o[3], c[3], kk) }; });
    const others = [];
    const myIdx = last.who.indexOf(me);
    for (const c of newer.cars) {
      if (c[0] === myIdx) continue;
      const o = older.cars.find(x => x[0] === c[0]) || c, key = last.who[c[0]];
      const car = { x: lerp(o[1], c[1], kk), y: lerp(o[2], c[2], kk), a: lerpAngle(o[3], c[3], kk), color: color(key), carry: c[5], stars: c[7], stun: c[9], key };
      others.push(car);
      drawCar(ctx, car.x, car.y, car.a, car.color, { glow: car.stars > 0, ghost: !!car.stun });
      ctx.save(); ctx.font = '700 11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = car.color;
      ctx.fillText(`${nameOf(key).slice(0, 12)}${car.carry ? ` $${car.carry}` : ''}`, car.x, car.y - 22);
      if (car.stars) { ctx.fillStyle = C.yellow; ctx.fillText('★'.repeat(car.stars), car.x, car.y + 30); }
      ctx.restore();
    }
    for (const c of cops) drawCar(ctx, c.x, c.y, c.a, '#fff', { police: true, t });
    const my = last.cars.find(c => c[0] === myIdx);
    drawCar(ctx, mine.x, mine.y, mine.a, color(me), { glow: (my?.[7] || 0) > 0, ghost: mine.stun });
    controls.drawIntent(ctx, mine, t);
    if (my?.[8] > 0) { ctx.save(); ctx.strokeStyle = C.red; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(mine.x, mine.y, 26, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, my[8] / 1.1)); ctx.stroke(); ctx.restore(); }
    parts.draw(ctx); floats.draw(ctx);
    // where to go next
    if (my) {
      const carry = my[5], stars = my[7];
      const near = list => list.reduce((a, b) => (!a || Math.hypot(b.x - mine.x, b.y - mine.y) < Math.hypot(a.x - mine.x, a.y - mine.y) ? b : a), null);
      const goal = stars > 0 && carry > 0 ? { ...near(city.washes), color: C.cyan, label: 'WASH' } : carry > 0 ? { ...city.hideout, color: C.magenta, label: 'BANK IT' } : (() => { const l = near(loot); return l && { ...l, color: C.yellow, label: '$' }; })();
      if (goal) drawPointer(ctx, cam, mine, goal, goal.color, goal.label);
    }
    ctx.restore();

    // HUD (screen)
    const narrow = view.sw < 600, secs = Math.max(0, Math.ceil((party.endAt - now) / 1000));
    const lead = party.players[0];
    drawHud(ctx, view.sw, {
      left: `$${(my?.[6] || 0).toLocaleString('en-US')}${my?.[5] ? `  +${my[5]}` : ''}`,
      right: `${!narrow && lead && lead.key !== me && lead.score > 0 ? `LEAD ${lead.name.slice(0, 10)} ` : ''}${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`,
      progress: Math.min(1, Math.max(0, 1 - (party.endAt - now) / ((party.endAt - party.startAt) || 1))),
    });
    drawStars(ctx, 16, 72, Math.min(MAX_STARS, my?.[7] || 0), t, narrow ? 9 : 10);
    if ((my?.[7] || 0) > 0 && my[10] > 0.5) { ctx.save(); ctx.font = '700 11px system-ui, sans-serif'; ctx.fillStyle = C.lime; ctx.fillText('losing them…', 16, 96); ctx.restore(); }
    const mw = narrow ? 120 : 150;
    drawMinimap(ctx, city, view.sw - mw - 10, 66, mw, { me: mine, others, cops, loot }, t);
    if (banner && banner.until > performance.now()) {
      ctx.save(); let fs = narrow ? 17 : 22; ctx.font = `900 ${fs}px system-ui, sans-serif`; while (ctx.measureText(banner.text).width > view.sw - 40 && fs > 11) { fs--; ctx.font = `900 ${fs}px system-ui, sans-serif`; } ctx.textAlign = 'center';
      const tw = ctx.measureText(banner.text).width, by = Math.round(view.sh * 0.62);
      ctx.fillStyle = 'rgba(7,6,26,.6)'; ctx.fillRect(view.sw / 2 - tw / 2 - 14, by - 26, tw + 28, 38);
      ctx.fillStyle = banner.col; ctx.shadowColor = banner.col; ctx.shadowBlur = 10; ctx.fillText(banner.text, view.sw / 2, by); ctx.restore();
    }
    controls.draw(ctx);
  }

  return { onSnap, update, render };
}

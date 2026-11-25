// Street Heat (solo): 90 seconds in a neon city. Grab loot, shake off the
// police, bank it at the hideout. Same city and loot for everyone each day.
// The rules live in street.js (shared with the party mode).

import { createLoop } from '../core/loop.js';
import { C, MONO, drawHud, Particles, FloatText } from './draw.js';
import { createStreet, addDriver, setControls, step, SOLO_SECONDS, atHideout } from './street.js';
import { cameraFor, drawCity, drawCar, drawLoot, drawStars, drawMinimap, drawPointer, createDriveControls, CAR_COLORS } from './street-draw.js';

export const W = 800, H = 480, TALL = { width: 480, height: 860 };
const HUD = 56;

export const resultMeta = d => ({ grabs: d.grabs, busts: d.busts, banked: d.banked });

/** Where to go next: loot, a car wash (when wanted), or the hideout (to bank). */
export function objective(sim, d) {
  const near = list => list.reduce((a, b) => (!a || Math.hypot(b.x - d.x, b.y - d.y) < Math.hypot(a.x - d.x, a.y - d.y) ? b : a), null);
  if (d.stars > 0 && d.carry > 0) return { ...near(sim.city.washes), color: C.cyan, label: 'WASH' };
  if (d.carry > 0) return { ...sim.city.hideout, color: C.magenta, label: 'BANK IT' };
  const l = near(sim.loot);
  return l ? { x: l.x, y: l.y, color: C.yellow, label: '$' } : null;
}

export default {
  id: 'heat',
  title: 'Street Heat',
  blurb: 'Grab the loot, lose the cops, bank it at the hideout. 90 seconds in a neon city.',
  controls: 'Phone: tilt to steer, hold to brake · Arrows/WASD · mouse: hold to drive',
  length: '90 sec',
  better: 'higher',
  plausible: (score, seconds) => (score <= 30000 && seconds >= SOLO_SECONDS - 2 ? { ok: true } : { ok: false }),
  describe: m => `${m.grabs} grabs · busted ${m.busts}×`,
  width: W, height: H,
  tall: TALL, // used on a phone held upright: you see more of the street ahead
  format: s => `$${Math.round(s).toLocaleString('en-US')}`,
  start(ctx, { seed, input, sound, onEnd, width = W, height = H }) {
    const sim = createStreet(`${seed}:solo`);
    const me = addDriver(sim, 'you', 'You');
    const parts = new Particles(), floats = new FloatText();
    let cam = null, banner = null, shake = 0;
    const say = (text, color, secs = 1.6) => { banner = { text, color, until: sim.time + secs }; };
    const controls = createDriveControls(input, {
      toWorld: (x, y) => ({ x: x + (cam?.x || 0), y: y + (cam?.y || 0) }),
      cssScale: () => ctx.canvas.getBoundingClientRect().width / width || 1,
    });
    say('Grab the $ · lose the cops · bank it at the HIDEOUT', C.text, 4);

    const loop = createLoop({
      update(dt) {
        dt = Math.min(dt, 0.05);
        setControls(sim, 'you', ...controls.read(me));
        step(sim, dt);
        for (const e of sim.events) {
          if (e.e === 'grab') { sound.hit(); parts.burst(e.x, e.y, C.yellow, 16); floats.add(e.x, e.y - 14, `+$${e.v}`, C.yellow); }
          if (e.e === 'stars' && e.n > 0) say(`WANTED ${'★'.repeat(e.n)}`, C.red, 1.2);
          if (e.e === 'bank') { sound.go(); parts.burst(me.x, me.y, C.magenta, 26); say(e.bonus ? `BANKED $${e.v} · ${e.n}-grab haul +$${e.bonus}` : `BANKED $${e.v}`, C.lime, 2); }
          if (e.e === 'hot') { sound.miss(); say('Lose the cops first!', C.red); }
          if (e.e === 'wash') { sound.go(); parts.burst(me.x, me.y, C.cyan, 30); say('Fresh paint, no heat', C.cyan); }
          if (e.e === 'lost') say('LOST THEM', C.lime);
          if (e.e === 'busted') { sound.bad(); shake = 10; say(e.v ? `BUSTED · lost $${e.v}` : 'BUSTED', C.red, 2); }
          if (e.e === 'crash') { shake = Math.max(shake, 5); }
        }
        parts.update(dt); floats.update(dt);
        shake = Math.max(0, shake - dt * 30);
        if (sim.over) { loop.stop(); controls.destroy(); sound.end(); onEnd(me.banked, resultMeta(me)); }
      },
      render() {
        const t = sim.time;
        cam = cameraFor(me, width, height + 0, cam);
        ctx.save();
        if (shake) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
        ctx.translate(-cam.x, -cam.y);
        drawCity(ctx, sim.city, cam, t);
        for (const l of sim.loot) drawLoot(ctx, l, t);
        for (const c of sim.cops) drawCar(ctx, c.x, c.y, c.a, '#fff', { police: true, t });
        drawCar(ctx, me.x, me.y, me.a, CAR_COLORS[0], { glow: me.stars > 0, ghost: me.stun > 0 });
        if (me.bust > 0) { ctx.save(); ctx.strokeStyle = C.red; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(me.x, me.y, 26, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, me.bust / 1.1)); ctx.stroke(); ctx.restore(); }
        parts.draw(ctx); floats.draw(ctx);
        const goal = objective(sim, me);
        if (goal) drawPointer(ctx, cam, me, goal, goal.color, goal.label);
        ctx.restore();

        // screen overlays
        const narrow = width < 600;
        drawHud(ctx, width, {
          left: `$${me.banked.toLocaleString('en-US')}${me.carry ? `  +${me.carry}` : ''}`,
          right: `${Math.max(0, Math.ceil(sim.duration - t))}s`,
          progress: Math.min(1, t / sim.duration),
        });
        drawStars(ctx, narrow ? 16 : width / 2 - 52, HUD + 16, me.stars, t, narrow ? 9 : 10);
        if (me.stars > 0 && me.calm > 0.5) { ctx.save(); ctx.font = '700 11px system-ui, sans-serif'; ctx.fillStyle = C.lime; ctx.fillText('losing them…', narrow ? 16 : width / 2 - 52, HUD + 40); ctx.restore(); }
        const mw = narrow ? 120 : 150;
        drawMinimap(ctx, sim.city, width - mw - 10, HUD + 10, mw, { me, cops: sim.cops, loot: sim.loot }, t);
        if (banner && banner.until > t) {
          ctx.save(); ctx.font = `900 ${narrow ? 18 : 24}px system-ui, sans-serif`; ctx.textAlign = 'center';
          ctx.fillStyle = 'rgba(7,6,26,.6)'; const tw = ctx.measureText(banner.text).width; ctx.fillRect(width / 2 - tw / 2 - 14, height - 70, tw + 28, 40);
          ctx.fillStyle = banner.color; ctx.shadowColor = banner.color; ctx.shadowBlur = 10; ctx.fillText(banner.text, width / 2, height - 42); ctx.restore();
        }
        if (atHideout(sim.city, me.x, me.y) && me.carry > 0 && me.stars > 0) { ctx.save(); ctx.font = MONO; ctx.textAlign = 'center'; ctx.fillStyle = C.red; ctx.fillText('HIDEOUT LOCKED', width / 2, HUD + 70); ctx.restore(); }
        controls.draw(ctx);
      },
    });
    loop.start();
    return { stop: () => { loop.stop(); controls.destroy(); } };
  },
};

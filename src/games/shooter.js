// Drone Shooter: drawing, sound and controls around shooter-engine.js.

import { createLoop } from '../core/loop.js';
import { createRng } from '../core/rng.js';
import { C, MONO, drawHud, Particles, FloatText } from './draw.js';
import { W, H, HUD, TALL, WAVES, BOSS_HP, createShooter, step } from './shooter-engine.js';

const ENEMY_COLOR = { scout: C.magenta, striker: C.yellow, gunner: C.lime };
const POWER = { spread: { color: C.yellow, label: 'S' }, rapid: { color: C.cyan, label: 'R' }, shield: { color: C.lime, label: '◯' } };

export function drawShip(ctx, x, y, t, blink) {
  if (blink) return;
  ctx.save(); ctx.translate(x, y);
  // engine flame
  const f = 8 + Math.sin(t * 40) * 3;
  ctx.fillStyle = C.yellow; ctx.globalAlpha = 0.8;
  ctx.beginPath(); ctx.moveTo(-5, 10); ctx.lineTo(0, 10 + f); ctx.lineTo(5, 10); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.shadowColor = C.cyan; ctx.shadowBlur = 16;
  ctx.fillStyle = '#0f2a3a'; ctx.strokeStyle = C.cyan; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(0, -16); ctx.lineTo(13, 11); ctx.lineTo(0, 6); ctx.lineTo(-13, 11); ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.restore();
}

export function drawDrone(ctx, x, y, r, color, t, flash) {
  ctx.save(); ctx.translate(x, y);
  ctx.strokeStyle = flash ? '#fff' : color; ctx.fillStyle = flash ? '#fff' : color;
  ctx.shadowColor = color; ctx.shadowBlur = 12; ctx.lineWidth = 2.5;
  const arm = r * 0.95;
  for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(dx * arm, dy * arm * 0.7); ctx.stroke();
    ctx.globalAlpha = 0.55;
    ctx.beginPath(); ctx.ellipse(dx * arm, dy * arm * 0.7, r * 0.5 * Math.abs(Math.cos(t * 30 + dx)), r * 0.16, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = '#1a1033';
  ctx.beginPath(); ctx.arc(0, 0, r * 0.48, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = flash ? '#fff' : color;
  ctx.beginPath(); ctx.arc(0, r * 0.08, r * 0.18, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

export function drawBoss(ctx, b, t, flash) {
  ctx.save(); ctx.translate(b.x, b.y);
  const enraged = b.hp < BOSS_HP / 2, color = enraged ? C.red : C.magenta;
  ctx.shadowColor = color; ctx.shadowBlur = 24; ctx.lineWidth = 3;
  ctx.strokeStyle = flash ? '#fff' : color;
  for (const dx of [-1, 1]) for (const dy of [-1, 1]) {
    ctx.beginPath(); ctx.moveTo(dx * 30, dy * 14); ctx.lineTo(dx * 70, dy * 34); ctx.stroke();
    ctx.globalAlpha = 0.5; ctx.fillStyle = color;
    ctx.beginPath(); ctx.ellipse(dx * 70, dy * 34, 26 * Math.abs(Math.cos(t * 26 + dx + dy)), 6, 0, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
  }
  ctx.fillStyle = '#1d0f2e';
  ctx.beginPath();
  for (let k = 0; k < 6; k++) { const a = Math.PI / 6 + (k * Math.PI) / 3; ctx.lineTo(Math.cos(a) * 46, Math.sin(a) * 34); }
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = flash ? '#fff' : C.yellow;
  ctx.beginPath(); ctx.arc(0, 4, 10 + Math.sin(t * 6) * 2, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

export default {
  id: 'shooter',
  title: 'Drone Shooter',
  blurb: 'Dodge and blast six waves of drones, then take down the boss.',
  controls: 'Move with the mouse, arrow keys / WASD, or drag on a touch screen · you fire automatically',
  length: '2–3 min',
  better: 'higher',
  width: W, height: H,
  tall: { width: TALL.w, height: TALL.h }, // used on a phone held upright
  format: s => Math.round(s).toLocaleString('en-US'),
  plausible: (score, seconds) => (score <= 400000 && seconds >= 15 ? { ok: true } : { ok: false }),
  describe: m => (m.won ? `Boss defeated! · ${m.kills} drones · ${m.lives} ${m.lives === 1 ? 'life' : 'lives'} left`
    : `Reached wave ${Math.min(m.wave + 1, WAVES)}${m.wave >= WAVES ? ' (boss)' : ''} · ${m.kills} drones`),
  start(ctx, { seed, input, sound, onEnd, width = W, height = H }) {
    const s = createShooter(seed, { w: width, h: height });
    const FW = s.W, FH = s.H; // field size: 800 × 480, or tall on an upright phone
    const parts = new Particles(), floats = new FloatText();
    const starRng = createRng('stars');
    const stars = Array.from({ length: 90 }, () => ({ x: starRng.range(0, FW), y: starRng.range(HUD, FH), z: starRng.range(0.2, 1) }));
    let mode = 'mouse', shake = 0, bossFlash = 0, banner = { text: 'WAVE 1', until: 1.8 }, endAt = null;
    const hitFlash = new Map();

    input.on('keydown', e => { if (/^(Arrow|w|a|s|d|W|A|S|D)/.test(e.key) && e.key.length <= 10) mode = 'keys'; });
    // Mouse: the ship follows the cursor. Touch/pen: drag anywhere and the ship
    // moves by the same amount, so your finger never covers it.
    let drag = null;
    input.on('pointerdown', pt => {
      mode = 'mouse';
      drag = pt.type === 'mouse' ? null : { fx: pt.x, fy: pt.y, sx: s.player.x, sy: s.player.y, tx: s.player.x, ty: s.player.y };
    });
    input.on('pointermove', pt => { if (drag && pt.down) { drag.tx = drag.sx + (pt.x - drag.fx) * 1.4; drag.ty = drag.sy + (pt.y - drag.fy) * 1.4; } });
    input.on('pointerup', () => { drag = null; });

    const controls = () => {
      const k = input.keys;
      const dx = (k.has('ArrowRight') || k.has('d') || k.has('D') ? 1 : 0) - (k.has('ArrowLeft') || k.has('a') || k.has('A') ? 1 : 0);
      const dy = (k.has('ArrowDown') || k.has('s') || k.has('S') ? 1 : 0) - (k.has('ArrowUp') || k.has('w') || k.has('W') ? 1 : 0);
      if (dx || dy) return { dx, dy };
      if (drag) return { pointer: { x: drag.tx, y: drag.ty } };
      if (mode === 'mouse' && input.pointer.inside && input.pointer.type !== 'touch' && input.pointer.type !== 'pen') return { pointer: input.pointer };
      return {};
    };

    const loop = createLoop({
      update(dt) {
        for (const st of stars) { st.y += 40 * st.z * dt; if (st.y > FH) { st.y = HUD; st.x = Math.random() * FW; } }
        parts.update(dt); floats.update(dt);
        shake = Math.max(0, shake - dt * 30); bossFlash = Math.max(0, bossFlash - dt);
        for (const [id, v] of hitFlash) { if (v - dt <= 0) hitFlash.delete(id); else hitFlash.set(id, v - dt); }
        if (endAt !== null) {
          if (s.time >= endAt) {
            loop.stop(); endAt = null;
            onEnd(s.score, { won: s.won, wave: s.wave, kills: s.kills, lives: s.lives });
          } else s.time += dt;
          return;
        }
        step(s, dt, controls());
        for (const e of s.events) {
          switch (e.type) {
            case 'kill': sound.hit(); parts.burst(e.x, e.y, ENEMY_COLOR[e.kind], 16); floats.add(e.x, e.y - 12, `+${e.points}`, e.mult > 1 ? C.yellow : C.text); break;
            case 'damage': break;
            case 'bossHit': bossFlash = 0.05; if (Math.random() < 0.3) parts.burst(e.x, e.y, C.magenta, 3); break;
            case 'playerHit': sound.bad(); shake = 10; parts.burst(e.x, e.y, C.cyan, 30); break;
            case 'shieldBreak': sound.bad(); shake = 5; parts.burst(e.x, e.y, C.lime, 20); break;
            case 'crash': parts.burst(e.x, e.y, C.red, 12); break;
            case 'pickup': sound.go(); floats.add(e.x, e.y - 14, { spread: 'SPREAD SHOT', rapid: 'RAPID FIRE', shield: 'SHIELD' }[e.kind], POWER[e.kind].color); break;
            case 'waveClear': banner = { text: e.wave < WAVES ? `WAVE ${e.wave + 1}` : 'BOSS INCOMING', until: s.time + 1.8 }; sound.tick(); break;
            case 'bossDown': sound.end(); shake = 14; for (let i = 0; i < 5; i++) parts.burst(e.x + (Math.random() - 0.5) * 80, e.y + (Math.random() - 0.5) * 50, i % 2 ? C.yellow : C.magenta, 26); break;
            default: break;
          }
        }
        s.events.length = 0;
        if (s.over && endAt === null) { endAt = s.time + (s.won ? 1.6 : 1.1); if (!s.won) sound.end(); }
      },
      render() {
        const t = s.time;
        ctx.save();
        if (shake) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
        ctx.fillStyle = C.bg; ctx.fillRect(-12, -12, FW + 24, FH + 24);
        for (const st of stars) { ctx.globalAlpha = 0.25 + st.z * 0.5; ctx.fillStyle = C.text; ctx.fillRect(st.x, st.y, st.z * 2, st.z * 2); }
        ctx.globalAlpha = 1;

        for (const u of s.powerups) {
          const pw = POWER[u.kind];
          ctx.save(); ctx.shadowColor = pw.color; ctx.shadowBlur = 14; ctx.strokeStyle = pw.color; ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.arc(u.x, u.y, u.r + Math.sin(t * 8) * 1.5, 0, Math.PI * 2); ctx.stroke();
          ctx.fillStyle = pw.color; ctx.font = '800 14px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(pw.label, u.x, u.y + 1); ctx.restore();
        }
        for (const e of s.enemies) drawDrone(ctx, e.x, e.y, e.r, ENEMY_COLOR[e.type], t + e.id, false);
        if (s.boss && s.boss.hp > 0) drawBoss(ctx, s.boss, t, bossFlash > 0);

        ctx.fillStyle = C.cyan; ctx.shadowColor = C.cyan; ctx.shadowBlur = 8;
        for (const b of s.bullets) ctx.fillRect(b.x - 2, b.y - 7, 4, 12);
        ctx.shadowColor = C.red; ctx.fillStyle = '#ff7a7a';
        for (const b of s.enemyBullets) { ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill(); }
        ctx.shadowBlur = 0;

        const p = s.player;
        if (s.lives > 0) {
          drawShip(ctx, p.x, p.y, t, p.inv > 0 && Math.floor(t * 14) % 2 === 0);
          if (p.shield) { ctx.save(); ctx.strokeStyle = C.lime; ctx.globalAlpha = 0.7 + Math.sin(t * 6) * 0.2; ctx.lineWidth = 2; ctx.shadowColor = C.lime; ctx.shadowBlur = 12; ctx.beginPath(); ctx.arc(p.x, p.y, 24, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); }
        }
        parts.draw(ctx); floats.draw(ctx);

        if (t < banner.until) {
          ctx.save(); ctx.globalAlpha = Math.min(1, (banner.until - t) * 2);
          ctx.font = '900 italic 44px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillStyle = banner.text.startsWith('BOSS') ? C.red : C.cyan; ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 20;
          ctx.fillText(banner.text, FW / 2, FH / 2 - 20); ctx.restore();
        }
        if (s.over && s.won) {
          ctx.save(); ctx.font = '900 italic 48px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = C.yellow; ctx.shadowColor = C.yellow; ctx.shadowBlur = 24;
          ctx.fillText('BOSS DOWN!', FW / 2, FH / 2); ctx.restore();
        }
        ctx.restore();

        const mult = s.time - s.lastKill <= 2 ? Math.min(5, 1 + Math.floor(s.streak / 3)) : 1;
        const stage = s.phase === 'boss' || s.wave >= WAVES ? 'BOSS' : `WAVE ${s.wave + 1}/${WAVES}`;
        drawHud(ctx, FW, {
          left: `SCORE ${Math.round(s.score).toLocaleString('en-US')}${mult > 1 ? `  x${mult}` : ''}`,
          right: `${stage}   ${'▲'.repeat(Math.max(0, s.lives))}`,
          progress: s.boss ? s.boss.hp / BOSS_HP : 1 - Math.min(1, s.wave / WAVES),
        });
        const pu = [];
        if (s.time < p.spreadUntil) pu.push(['SPREAD', C.yellow, p.spreadUntil - s.time]);
        if (s.time < p.rapidUntil) pu.push(['RAPID', C.cyan, p.rapidUntil - s.time]);
        if (pu.length) {
          ctx.save(); ctx.font = MONO; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          pu.forEach(([label, color, left], i) => { ctx.fillStyle = color; ctx.fillText(`${label} ${Math.ceil(left)}s`, FW / 2 + (i - (pu.length - 1) / 2) * 150, 26); });
          ctx.restore();
        }
      },
    });
    loop.start();
    return { stop: () => loop.stop() };
  },
};

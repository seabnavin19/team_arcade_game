// Drone Shooter game logic, with no drawing, so it can be tested and replayed.
// Enemy waves, enemy timing and power-up drops all come from the day's seed:
// everyone faces the same fight on the same day.

import { createRng } from '../core/rng.js';

export const W = 800, H = 480, HUD = 56;
export const MAX_TIME = 240; // safety cap: the boss leaves after 4 minutes
export const LIVES = 3;
export const WAVES = 6;
const PLAYER_Y_MIN = 250, PLAYER_Y_MAX = H - 24;

export const ENEMY = {
  scout: { hp: 1, r: 14, points: 100 },
  striker: { hp: 2, r: 16, points: 200 },
  gunner: { hp: 4, r: 18, points: 300 },
};
export const BOSS_HP = 160;
export const BOSS_BONUS = 5000, LIFE_BONUS = 1000;
export const POWERUPS = ['spread', 'rapid', 'shield'];
export const DROP_CHANCE = 0.12;

export function buildWaves(seed) {
  const rng = createRng(`${seed}:waves`);
  const waves = [];
  for (let w = 0; w < WAVES; w++) {
    const spawns = [];
    const types = w === 0 ? ['scout'] : w === 1 ? ['scout', 'scout', 'striker'] : ['scout', 'striker', 'striker', 'gunner'];
    let t = 1.2;
    const groups = 5 + w;
    for (let g = 0; g < groups; g++) {
      const type = rng.pick(types);
      if (type === 'scout') {
        // a little formation of scouts
        const n = rng.int(3, 4 + Math.min(w, 2));
        const x0 = rng.range(140, W - 140);
        const amp = rng.range(40, 110), freq = rng.range(1.2, 2.4), phase = rng.range(0, Math.PI * 2);
        for (let k = 0; k < n; k++) spawns.push({ t: +(t + k * 0.32).toFixed(2), type, x: Math.round(x0), amp: Math.round(amp), freq: +freq.toFixed(2), phase: +(phase - k * 0.5).toFixed(2) });
        t += n * 0.32 + rng.range(0.6, 1.4);
      } else if (type === 'striker') {
        const n = rng.int(1, 2 + (w > 3 ? 1 : 0));
        for (let k = 0; k < n; k++) spawns.push({ t: +(t + k * 0.45).toFixed(2), type, x: Math.round(rng.range(80, W - 80)), hover: +rng.range(0.4, 0.9).toFixed(2) });
        t += n * 0.45 + rng.range(0.8, 1.6);
      } else {
        spawns.push({ t: +t.toFixed(2), type, x: Math.round(rng.range(120, W - 120)), stopY: Math.round(rng.range(90, 170)), fireEvery: +rng.range(1.5, 2.2).toFixed(2) });
        t += rng.range(1.2, 2);
      }
    }
    waves.push({ spawns, speed: 1 + w * 0.09 });
  }
  return waves;
}

export function dropFor(seed, enemyId) {
  const rng = createRng(`${seed}:drop:${enemyId}`);
  return rng.chance(DROP_CHANCE) ? rng.pick(POWERUPS) : null;
}

export const multiplierFor = streak => Math.min(5, 1 + Math.floor(streak / 3));

export function createShooter(seed) {
  const s = {
    seed, waves: buildWaves(seed), time: 0, score: 0, lives: LIVES, streak: 0, lastKill: -99,
    player: { x: W / 2, y: H - 50, r: 11, inv: 0, shield: false, spreadUntil: 0, rapidUntil: 0, fireCd: 0.5 },
    bullets: [], enemyBullets: [], enemies: [], powerups: [],
    phase: 'banner', wave: 0, waveTime: 0, spawnIdx: 0, bannerUntil: 1.8, nextId: 1,
    boss: null, kills: 0, over: false, won: false, events: [],
  };
  return s;
}

const ev = (s, type, data = {}) => s.events.push({ type, ...data });

function hitPlayer(s) {
  const p = s.player;
  if (p.inv > 0 || s.over) return;
  s.streak = 0;
  if (p.shield) { p.shield = false; p.inv = 1; ev(s, 'shieldBreak', { x: p.x, y: p.y }); return; }
  s.lives--; p.inv = 1.8;
  ev(s, 'playerHit', { x: p.x, y: p.y });
  s.enemyBullets = s.enemyBullets.filter(b => Math.hypot(b.x - p.x, b.y - p.y) > 140); // a moment to breathe
  if (s.lives <= 0) endGame(s, false);
}

function endGame(s, won) {
  if (s.over) return;
  s.over = true; s.won = won;
  if (won) s.score += BOSS_BONUS + s.lives * LIFE_BONUS;
  ev(s, won ? 'win' : 'lose');
}

function killEnemy(s, e) {
  s.streak = s.time - s.lastKill <= 2 ? s.streak + 1 : 1;
  s.lastKill = s.time;
  const mult = multiplierFor(s.streak);
  const pts = ENEMY[e.type].points * mult;
  s.score += pts; s.kills++;
  ev(s, 'kill', { x: e.x, y: e.y, kind: e.type, points: pts, mult });
  const drop = dropFor(s.seed, e.id);
  if (drop) s.powerups.push({ x: e.x, y: e.y, kind: drop, r: 13 });
}

function spawnEnemy(s, sp, speed) {
  const base = ENEMY[sp.type];
  s.enemies.push({ id: s.nextId++, ...sp, x: sp.x, y: -24, x0: sp.x, age: 0, hp: base.hp, r: base.r, speed, fireCd: sp.fireEvery || 0, state: 'enter' });
}

function aimed(s, x, y, speed, spread = 0) {
  const a = Math.atan2(s.player.y - y, s.player.x - x) + spread;
  return { x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, r: 5 };
}

function updateEnemy(s, e, dt) {
  e.age += dt;
  const k = e.speed;
  if (e.type === 'scout') {
    e.y += 95 * k * dt;
    e.x = e.x0 + Math.sin(e.age * e.freq + e.phase) * e.amp;
  } else if (e.type === 'striker') {
    if (e.state === 'enter') { e.y += 170 * k * dt; if (e.y >= 120) { e.state = 'hover'; e.hoverLeft = e.hover; } }
    else if (e.state === 'hover') {
      e.hoverLeft -= dt;
      if (e.hoverLeft <= 0) { e.state = 'dive'; const a = Math.atan2(s.player.y - e.y, s.player.x - e.x); e.vx = Math.cos(a) * 330 * k; e.vy = Math.max(160, Math.sin(a) * 330 * k); }
    } else { e.x += e.vx * dt; e.y += e.vy * dt; }
  } else if (e.type === 'gunner') {
    if (e.state === 'enter') { e.y += 120 * k * dt; if (e.y >= e.stopY) { e.state = 'strafe'; e.strafeAge = 0; } }
    else if (e.state === 'strafe') {
      e.strafeAge += dt;
      e.x = e.x0 + Math.sin(e.strafeAge * 0.9) * 90;
      e.fireCd -= dt;
      if (e.fireCd <= 0) { e.fireCd = e.fireEvery / k; s.enemyBullets.push(aimed(s, e.x, e.y + 10, 210 * k)); ev(s, 'enemyShot'); }
      if (e.strafeAge > 11) e.state = 'leave';
    } else e.y += 140 * dt;
  }
}

function updateBoss(s, dt) {
  const b = s.boss;
  b.age += dt;
  if (b.y < 110) { b.y += 60 * dt; return; }
  const enraged = b.hp < BOSS_HP / 2;
  b.x = W / 2 + Math.sin(b.age * (enraged ? 0.9 : 0.6)) * 250;
  b.fireCd -= dt;
  if (b.fireCd <= 0) {
    b.fireCd = enraged ? 0.85 : 1.25;
    const n = enraged ? 7 : 5;
    for (let i = 0; i < n; i++) s.enemyBullets.push(aimed(s, b.x, b.y + 30, enraged ? 230 : 200, (i - (n - 1) / 2) * 0.17));
    ev(s, 'enemyShot');
  }
  if (enraged) {
    b.minionCd -= dt;
    if (b.minionCd <= 0) {
      b.minionCd = 4.5;
      for (const dx of [-60, 60]) spawnEnemy(s, { type: 'scout', x: Math.round(b.x + dx), amp: 50, freq: 1.8, phase: dx > 0 ? 0 : Math.PI }, 1.3);
    }
  }
}

/**
 * Advance the game by dt seconds.
 * controls: { pointer: {x, y} | null, dx: -1..1, dy: -1..1 } (keys win over the mouse)
 */
export function step(s, dt, controls = {}) {
  if (s.over) return;
  s.time += dt;
  const p = s.player;

  // --- player movement
  if (controls.dx || controls.dy) {
    const len = Math.hypot(controls.dx || 0, controls.dy || 0) || 1;
    p.x += ((controls.dx || 0) / len) * 360 * dt;
    p.y += ((controls.dy || 0) / len) * 360 * dt;
  } else if (controls.pointer) {
    const tx = controls.pointer.x, ty = Math.max(PLAYER_Y_MIN, controls.pointer.y);
    const d = Math.hypot(tx - p.x, ty - p.y), max = 560 * dt;
    if (d > 0.5) { const m = Math.min(1, max / d); p.x += (tx - p.x) * m; p.y += (ty - p.y) * m; }
  }
  p.x = Math.max(18, Math.min(W - 18, p.x));
  p.y = Math.max(PLAYER_Y_MIN, Math.min(PLAYER_Y_MAX, p.y));
  p.inv = Math.max(0, p.inv - dt);

  // --- auto-fire
  p.fireCd -= dt;
  if (p.fireCd <= 0) {
    p.fireCd = s.time < p.rapidUntil ? 0.085 : 0.16;
    const angles = s.time < p.spreadUntil ? [-0.2, 0, 0.2] : [0];
    for (const a of angles) s.bullets.push({ x: p.x, y: p.y - 14, vx: Math.sin(a) * 640, vy: -Math.cos(a) * 640, r: 4 });
    ev(s, 'shot');
  }

  // --- waves and boss
  if (s.phase === 'banner') {
    if (s.time >= s.bannerUntil) {
      if (s.wave < WAVES) { s.phase = 'wave'; s.waveTime = 0; s.spawnIdx = 0; }
      else { s.phase = 'boss'; s.boss = { x: W / 2, y: -60, r: 46, hp: BOSS_HP, age: 0, fireCd: 1.5, minionCd: 2 }; ev(s, 'bossIn'); }
    }
  } else if (s.phase === 'wave') {
    const wave = s.waves[s.wave];
    s.waveTime += dt;
    while (s.spawnIdx < wave.spawns.length && wave.spawns[s.spawnIdx].t <= s.waveTime) spawnEnemy(s, wave.spawns[s.spawnIdx++], wave.speed);
    const allOut = s.spawnIdx >= wave.spawns.length;
    if (allOut && (s.enemies.length === 0 || s.waveTime > wave.spawns.at(-1).t + 14)) {
      s.wave++; s.phase = 'banner'; s.bannerUntil = s.time + 1.8;
      ev(s, 'waveClear', { wave: s.wave });
    }
  } else if (s.phase === 'boss') {
    updateBoss(s, dt);
  }

  // --- movement
  for (const b of s.bullets) { b.x += b.vx * dt; b.y += b.vy * dt; }
  for (const b of s.enemyBullets) { b.x += b.vx * dt; b.y += b.vy * dt; }
  for (const e of s.enemies) updateEnemy(s, e, dt);
  for (const u of s.powerups) u.y += 85 * dt;

  // --- player bullets vs enemies / boss
  for (const b of s.bullets) {
    if (b.dead) continue;
    for (const e of s.enemies) {
      if (e.dead || Math.hypot(b.x - e.x, b.y - e.y) > e.r + b.r) continue;
      b.dead = true; e.hp--;
      if (e.hp <= 0) { e.dead = true; killEnemy(s, e); } else ev(s, 'damage', { x: e.x, y: e.y });
      break;
    }
    const boss = s.boss;
    if (!b.dead && boss && boss.hp > 0 && boss.y > 0 && Math.hypot(b.x - boss.x, b.y - boss.y) < boss.r + b.r) {
      b.dead = true; boss.hp--; s.score += 10;
      ev(s, 'bossHit', { x: b.x, y: b.y });
      if (boss.hp <= 0) { ev(s, 'bossDown', { x: boss.x, y: boss.y }); s.enemies.forEach(e => { e.dead = true; }); s.enemyBullets = []; endGame(s, true); }
    }
  }

  // --- things hitting the player
  for (const e of s.enemies) if (!e.dead && Math.hypot(e.x - p.x, e.y - p.y) < e.r + p.r) { e.dead = true; ev(s, 'crash', { x: e.x, y: e.y }); hitPlayer(s); }
  for (const b of s.enemyBullets) if (!b.dead && Math.hypot(b.x - p.x, b.y - p.y) < b.r + p.r - 2) { b.dead = true; hitPlayer(s); }
  if (s.boss && s.boss.hp > 0 && Math.hypot(s.boss.x - p.x, s.boss.y - p.y) < s.boss.r + p.r) hitPlayer(s);
  for (const u of s.powerups) {
    if (u.dead || Math.hypot(u.x - p.x, u.y - p.y) > u.r + p.r + 6) continue;
    u.dead = true;
    if (u.kind === 'spread') p.spreadUntil = s.time + 9;
    if (u.kind === 'rapid') p.rapidUntil = s.time + 9;
    if (u.kind === 'shield') p.shield = true;
    ev(s, 'pickup', { x: u.x, y: u.y, kind: u.kind });
  }

  // --- clean up
  const inside = o => o.x > -40 && o.x < W + 40 && o.y > -80 && o.y < H + 40;
  s.bullets = s.bullets.filter(b => !b.dead && b.y > HUD - 10 && inside(b));
  s.enemyBullets = s.enemyBullets.filter(b => !b.dead && inside(b));
  s.enemies = s.enemies.filter(e => !e.dead && inside(e));
  s.powerups = s.powerups.filter(u => !u.dead && u.y < H + 20);

  if (s.time >= MAX_TIME) endGame(s, false);
}

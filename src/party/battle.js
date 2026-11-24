// Ship Battle: the simulation. The party server runs it 20 times a second;
// the browser uses the same movement code to keep your own ship responsive.
//
// Every player flies a ship that fires forward automatically. Steer to aim.
// Hits take 1 of 3 shields; at 0 the ship is knocked out (KO) and respawns
// after 2 seconds. Most KOs wins. Cover blocks shots; pickups heal or speed
// up your guns.

import { createRng } from '../core/rng.js';

export const W = 800, H = 480, TOP = 60;   // arena below the HUD bar
export const DURATION = 90;                // seconds
export const MAX_PLAYERS = 8;
export const SHIP_R = 14, SPEED = 210, MAX_HP = 3, TURN_RATE = 14; // radians per second
export const BULLET_SPEED = 430, BULLET_LIFE = 1.15, FIRE_EVERY = 0.38, RAPID_EVERY = 0.17, RAPID_SECONDS = 6;
export const RESPAWN_AFTER = 2, SPAWN_SHIELD = 2;
export const PICKUP_EVERY = 12;

/** Cover blocks for this battle, the same for everyone (from the seed). */
export function buildArena(seed) {
  const rng = createRng(`battle:${seed}`);
  const blocks = [];
  // centre piece, then pairs mirrored left/right so no side is better
  const cw = rng.int(70, 120), ch = rng.int(26, 46);
  blocks.push({ x: W / 2 - cw / 2, y: TOP + (H - TOP) / 2 - ch / 2, w: cw, h: ch });
  for (let k = 0; k < 2; k++) {
    for (let tries = 0; tries < 30; tries++) {
      const w = rng.int(24, 70), h = rng.int(24, 90);
      const x = rng.int(110, W / 2 - w - 60), y = rng.int(TOP + 40, H - h - 40);
      const a = { x, y, w, h }, b = { x: W - x - w, y, w, h };
      if (![a, b].some(r => blocks.some(o => overlap(r, o, 40)))) { blocks.push(a, b); break; }
    }
  }
  return blocks;
}

const overlap = (a, b, pad = 0) => a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;

function circleRect(cx, cy, r, b) {
  const nx = Math.max(b.x, Math.min(cx, b.x + b.w)), ny = Math.max(b.y, Math.min(cy, b.y + b.h));
  return { hit: (cx - nx) ** 2 + (cy - ny) ** 2 < r * r, nx, ny };
}

/** Move a ship by its input for dt seconds, sliding along walls and cover. Shared with the browser. */
export function moveShip(ship, mx, my, dt, blocks) {
  const len = Math.hypot(mx, my);
  if (len > 0.05) {
    const k = Math.min(1, len);
    ship.x += (mx / len) * SPEED * k * dt;
    ship.y += (my / len) * SPEED * k * dt;
    // Turn smoothly toward where you're going instead of snapping, so the nose
    // (and your aim) doesn't jitter when you make tiny corrections.
    if (len > 0.2) {
      let d = Math.atan2(my, mx) - (ship.a || 0);
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      const turn = TURN_RATE * dt;
      ship.a = Math.abs(d) <= turn ? Math.atan2(my, mx) : (ship.a || 0) + Math.sign(d) * turn;
    }
  }
  ship.x = Math.max(SHIP_R, Math.min(W - SHIP_R, ship.x));
  ship.y = Math.max(TOP + SHIP_R, Math.min(H - SHIP_R, ship.y));
  for (const b of blocks) {
    const c = circleRect(ship.x, ship.y, SHIP_R, b);
    if (!c.hit) continue;
    const dx = ship.x - c.nx, dy = ship.y - c.ny, d = Math.hypot(dx, dy);
    if (d > 0.001) { ship.x = c.nx + (dx / d) * SHIP_R; ship.y = c.ny + (dy / d) * SHIP_R; }
    else { ship.y = ship.y < b.y + b.h / 2 ? b.y - SHIP_R : b.y + b.h + SHIP_R; } // centre inside: push out vertically
  }
}

const SPAWNS = [
  [60, TOP + 50], [W - 60, H - 50], [W - 60, TOP + 50], [60, H - 50],
  [W / 2, TOP + 30], [W / 2, H - 30], [40, (TOP + H) / 2], [W - 40, (TOP + H) / 2],
];

export function createBattle(seed) {
  return {
    seed: String(seed), t: 0, blocks: buildArena(seed), ships: {}, order: [], bullets: [], pickups: [],
    rng: createRng(`battle-pickups:${seed}`), nextPickup: PICKUP_EVERY, events: [], nextBullet: 1,
  };
}

function spawnPoint(b, key) {
  // the spawn farthest from every other living ship
  let best = SPAWNS[0], bestD = -1;
  for (const [x, y] of SPAWNS) {
    let d = Infinity;
    for (const k of b.order) { const s = b.ships[k]; if (k !== key && s.alive) d = Math.min(d, Math.hypot(s.x - x, s.y - y)); }
    if (d > bestD) { bestD = d; best = [x, y]; }
  }
  return best;
}

export function addShip(b, key, name) {
  if (b.ships[key]) return b.ships[key];
  if (b.order.length >= MAX_PLAYERS) return null;
  const [x, y] = spawnPoint(b, key);
  const ship = { key, name, idx: b.order.length, x, y, a: Math.atan2((TOP + H) / 2 - y, W / 2 - x), hp: MAX_HP, alive: true, inv: SPAWN_SHIELD,
    respawnIn: 0, fireCd: 0.6, rapid: 0, mx: 0, my: 0, kos: 0, downs: 0, hits: 0 };
  b.ships[key] = ship; b.order.push(key);
  return ship;
}

export function setInput(b, key, mx, my) {
  const s = b.ships[key];
  if (!s || !Number.isFinite(mx) || !Number.isFinite(my)) return;
  const len = Math.hypot(mx, my);
  s.mx = len > 1 ? mx / len : mx; s.my = len > 1 ? my / len : my;
}

export function step(b, dt) {
  b.t += dt;
  b.events = [];
  // ships
  for (const key of b.order) {
    const s = b.ships[key];
    if (!s.alive) {
      s.respawnIn -= dt;
      if (s.respawnIn <= 0) {
        const [x, y] = spawnPoint(b, key);
        Object.assign(s, { x, y, hp: MAX_HP, alive: true, inv: SPAWN_SHIELD, fireCd: 0.5 });
        b.events.push({ e: 'spawn', k: s.idx });
      }
      continue;
    }
    s.inv = Math.max(0, s.inv - dt); s.rapid = Math.max(0, s.rapid - dt);
    moveShip(s, s.mx, s.my, dt, b.blocks);
    s.fireCd -= dt;
    if (s.fireCd <= 0) {
      s.fireCd = s.rapid > 0 ? RAPID_EVERY : FIRE_EVERY;
      b.bullets.push({ id: b.nextBullet++, o: s.idx, x: s.x + Math.cos(s.a) * (SHIP_R + 4), y: s.y + Math.sin(s.a) * (SHIP_R + 4),
        vx: Math.cos(s.a) * BULLET_SPEED, vy: Math.sin(s.a) * BULLET_SPEED, life: BULLET_LIFE });
    }
  }
  // bullets
  for (const bl of b.bullets) {
    bl.x += bl.vx * dt; bl.y += bl.vy * dt; bl.life -= dt;
    if (bl.life <= 0 || bl.x < 0 || bl.x > W || bl.y < TOP || bl.y > H || b.blocks.some(r => circleRect(bl.x, bl.y, 3, r).hit)) { bl.dead = true; continue; }
    for (const key of b.order) {
      const s = b.ships[key];
      if (s.idx === bl.o || !s.alive || Math.hypot(s.x - bl.x, s.y - bl.y) > SHIP_R + 3) continue;
      bl.dead = true;
      if (s.inv > 0) break; // spawn shield soaks it
      const shooter = b.ships[b.order[bl.o]];
      s.hp--; shooter.hits++;
      b.events.push({ e: 'hit', k: s.idx, by: bl.o });
      if (s.hp <= 0) {
        s.alive = false; s.respawnIn = RESPAWN_AFTER; s.downs++; shooter.kos++;
        b.events.push({ e: 'ko', k: s.idx, by: bl.o, x: Math.round(s.x), y: Math.round(s.y) });
      }
      break;
    }
  }
  b.bullets = b.bullets.filter(x => !x.dead);
  // pickups
  if (b.t >= b.nextPickup) {
    b.nextPickup += PICKUP_EVERY;
    for (let tries = 0; tries < 20; tries++) {
      const x = 60 + b.rng.next() * (W - 120), y = TOP + 40 + b.rng.next() * (H - TOP - 80);
      if (!b.blocks.some(r => circleRect(x, y, 22, r).hit)) { b.pickups.push({ x: Math.round(x), y: Math.round(y), kind: b.rng.chance(0.5) ? 'heal' : 'rapid' }); break; }
    }
    if (b.pickups.length > 3) b.pickups.shift();
  }
  for (const p of b.pickups) {
    for (const key of b.order) {
      const s = b.ships[key];
      if (p.taken || !s.alive || Math.hypot(s.x - p.x, s.y - p.y) > SHIP_R + 14) continue;
      p.taken = true;
      if (p.kind === 'heal') s.hp = MAX_HP; else s.rapid = RAPID_SECONDS;
      b.events.push({ e: 'pickup', k: s.idx, kind: p.kind });
    }
  }
  b.pickups = b.pickups.filter(p => !p.taken);
}

/** Compact state sent to every player 20 times a second. */
export function snapshot(b) {
  return {
    who: b.order,
    ships: b.order.map(k => { const s = b.ships[k]; return [s.idx, Math.round(s.x), Math.round(s.y), Math.round(s.a * 100) / 100, s.hp, s.alive ? 1 : 0, s.inv > 0 ? 1 : 0, s.rapid > 0 ? 1 : 0, s.kos, s.downs]; }),
    bullets: b.bullets.map(x => [x.id, Math.round(x.x), Math.round(x.y), Math.round(x.vx), Math.round(x.vy), x.o]),
    pickups: b.pickups.map(p => [p.x, p.y, p.kind === 'heal' ? 0 : 1]),
    events: b.events,
  };
}

/** Scores for the party results: KOs first, then fewer knock-outs taken, then hits. */
export function battleStats(b) {
  return Object.fromEntries(b.order.map(k => { const s = b.ships[k]; return [k, { score: s.kos, kos: s.kos, downs: s.downs, hits: s.hits }]; }));
}

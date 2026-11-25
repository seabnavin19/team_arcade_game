// Street Heat: a top-down neon city. Grab loot, the police come after you,
// lose them (or hit the car wash), then bank the loot at the hideout.
// An original game in the spirit of open-world crime games, kept light:
// driving, chases and bumping only.
//
// This file is the game itself, shared by the solo game (in the browser) and
// the party mode (on the party server). Same seed → same city, same loot.

import { createRng } from '../core/rng.js';

export const TILE = 40, COLS = 54, ROWS = 36;
export const WW = COLS * TILE, WH = ROWS * TILE; // world size
export const SOLO_SECONDS = 90, PARTY_SECONDS = 120;
export const MAX_STARS = 6;
export const CAR_R = 13;

// tile kinds
export const ROAD = 0, BUILDING = 1, PARK = 2, HIDEOUT = 3, WASH = 4;
const drivable = k => k !== BUILDING;

const CAR = { acc: 430, brake: 650, max: 290, rev: 140, drag: 1.1, turn: 4.2, grassMax: 170 };
const COP = { max: 262, perStar: 11, acc: 380, turn: 3.0 };
const BUST_TIME = 1.1, STUN = 1.6, ESCAPE_TIME = 5, ESCAPE_DIST = 380, WASH_COOLDOWN = 12;
const LOOT_LIVE = 6;
const HAUL_BONUS = 0.25; // each extra grab banked in one trip adds 25%

// ---------------------------------------------------------------- the city
/**
 * A grid city: 2-tile roads every 6 tiles, 4×4 blocks between them. Each day
 * some blocks are parks you can cut through, one block in the middle is the
 * hideout, two are car washes, and shops line the roads (loot appears there).
 */
export function buildCity(seed) {
  const rng = createRng(`${seed}:street-city`);
  const tiles = new Uint8Array(COLS * ROWS);
  const isRoadLine = (i, n) => i % 6 < 2 || i >= n - 2;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) tiles[r * COLS + c] = isRoadLine(c, COLS) || isRoadLine(r, ROWS) ? ROAD : BUILDING;
  // blocks: top-left tiles of each 4×4 block
  const blocks = [];
  for (let r = 2; r < ROWS - 2; r += 6) for (let c = 2; c < COLS - 2; c += 6) if (c + 4 <= COLS - 2 && r + 4 <= ROWS - 2) blocks.push({ c, r });
  const fill = (b, kind) => { for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) tiles[(b.r + y) * COLS + b.c + x] = kind; };
  // the hideout: the block nearest the middle
  const mid = blocks.reduce((a, b) => (Math.hypot(b.c - COLS / 2, b.r - ROWS / 2) < Math.hypot(a.c - COLS / 2, a.r - ROWS / 2) ? b : a));
  const rest = blocks.filter(b => b !== mid);
  const shuffled = rest.map(b => [rng.next(), b]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
  const washes = [], parks = [];
  // car washes: two blocks far apart
  washes.push(shuffled.find(b => Math.abs(b.c - mid.c) > 10));
  washes.push(shuffled.find(b => b !== washes[0] && Math.hypot(b.c - washes[0].c, b.r - washes[0].r) > 20));
  for (const b of shuffled) if (!washes.includes(b) && parks.length < 6 && rng.chance(0.3)) parks.push(b);
  // a hideout / wash is a road loop around a small building, so you drive in
  const ring = (b, kind) => { fill(b, kind); for (let y = 1; y < 3; y++) for (let x = 1; x < 3; x++) tiles[(b.r + y) * COLS + b.c + x] = BUILDING; };
  ring(mid, HIDEOUT);
  washes.filter(Boolean).forEach(b => ring(b, WASH));
  parks.forEach(b => fill(b, PARK));
  // shops: spots on the road beside a building, where loot shows up
  const shops = [];
  const buildingBlocks = shuffled.filter(b => !washes.includes(b) && !parks.includes(b));
  for (const b of buildingBlocks) {
    const side = rng.int(0, 3);
    const along = rng.int(0, 3) * TILE + TILE / 2;
    const x = side === 0 ? b.c * TILE + along : side === 1 ? (b.c + 4) * TILE + TILE / 2 : side === 2 ? b.c * TILE + along : b.c * TILE - TILE / 2;
    const y = side === 0 ? b.r * TILE - TILE / 2 : side === 1 ? b.r * TILE + along : side === 2 ? (b.r + 4) * TILE + TILE / 2 : b.r * TILE + along;
    shops.push({ x, y, kind: rng.pick(['bank', 'jewel', 'atm', 'atm']) });
  }
  const center = b => ({ x: (b.c + 2) * TILE, y: (b.r + 2) * TILE });
  return {
    seed, tiles, blocks, shops,
    hideout: { ...center(mid), c: mid.c, r: mid.r },
    washes: washes.filter(Boolean).map(b => ({ ...center(b), c: b.c, r: b.r })),
    parks,
  };
}

export const tileAt = (city, x, y) => {
  const c = Math.floor(x / TILE), r = Math.floor(y / TILE);
  if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return BUILDING;
  return city.tiles[r * COLS + c];
};
const inBlock = (x, y, b) => x >= b.c * TILE && x < (b.c + 4) * TILE && y >= b.r * TILE && y < (b.r + 4) * TILE;
export const atHideout = (city, x, y) => inBlock(x, y, city.hideout);
export const atWash = (city, x, y) => city.washes.some(w => inBlock(x, y, w));

// ---------------------------------------------------------------- driving
/** Move a car one step: throttle −1..1 (minus = brake/reverse), steer −1..1. Returns crash speed (0 if none). */
export function driveCar(car, throttle, steer, dt, city, spec = CAR) {
  throttle = Math.max(-1, Math.min(1, throttle || 0));
  steer = Math.max(-1, Math.min(1, steer || 0));
  // Nose stuck in a wall? Back up for a moment, turning away, then carry on.
  if (car.backup > 0) {
    car.backup -= dt;
    throttle = -0.9;
    steer = car.backupSteer;
  }
  const onGrass = tileAt(city, car.x, car.y) === PARK;
  const max = onGrass ? Math.min(spec.max, CAR.grassMax) : spec.max;
  // the gas sets a speed: half throttle cruises at half speed (it slows down to it too)
  if (throttle > 0 && car.v > max * throttle) car.v = Math.max(max * throttle, car.v - spec.brake * 0.5 * dt);
  else if (throttle > 0) car.v += (car.v < 0 ? spec.brake : spec.acc) * dt;
  else if (throttle < 0) car.v += (car.v > 0 ? spec.brake : spec.acc * 0.6) * throttle * dt;
  else car.v -= car.v * spec.drag * dt;
  car.v = Math.max(-CAR.rev, Math.min(max, car.v));
  if (Math.abs(car.v) < 2 && !throttle) car.v = 0;
  // Turning: about the same tight circle at any speed (so a corner fits in
  // the road), gentler when crawling, and flipped when reversing.
  // (with the gas on, a crawling car can still swing its nose round: arcade handling)
  const going = car.v !== 0 ? Math.sign(car.v) : Math.sign(throttle);
  const rate = Math.max(Math.min(spec.turn, Math.abs(car.v) / 48), throttle ? 2.4 : 0) * going;
  car.a += steer * rate * dt;
  car.bumped = Math.max(0, (car.bumped || 0) - dt);
  if (car.assist) assist(car, steer, dt, car.bumped > 0);
  car.x += Math.cos(car.a) * car.v * dt;
  car.y += Math.sin(car.a) * car.v * dt;
  const hit = collideWalls(car, city);
  // pushing forward into a wall and hardly moving → reverse out of it
  car.pressing = hit > 0 && throttle > 0 && car.v < 60 ? (car.pressing || 0) + dt : 0;
  if (car.pressing > 0.3 && !(car.backup > 0)) {
    car.pressing = 0; car.backup = 0.45;
    car.backupSteer = steer ? -Math.sign(steer) : (car.lastBackup = -(car.lastBackup || 1)); // reversing flips the steering
  }
  return hit;
}

/**
 * Driving help for players (not the police): with the wheel near the middle,
 * the car lines itself up with the street it's on and drifts to the middle of
 * the road, so going straight takes no effort and you only steer for turns.
 */
function assist(car, steer, dt, bumped) {
  if (Math.abs(steer) > 0.15 || Math.abs(car.v) < 40) return;
  const axis = Math.round(car.a / (Math.PI / 2)) * (Math.PI / 2);
  const off = car.a - axis;
  if (Math.abs(off) > 0.5) return; // clearly turning: leave it alone
  if (!bumped) car.a -= off * Math.min(1, 5 * dt); // (just after a bump, don't fight the slide)
  // middle of the road, across the direction of travel
  const along = Math.abs(Math.cos(axis)) > 0.5; // driving left–right
  const across = along ? car.y : car.x, n = along ? ROWS : COLS;
  const t = Math.floor(across / TILE);
  const centers = [(Math.floor(t / 6) * 6 + 1) * TILE, (n - 1) * TILE];
  const c = centers.reduce((a, b) => (Math.abs(b - across) < Math.abs(a - across) ? b : a));
  if (Math.abs(c - across) < TILE * 0.9) {
    const nudge = (c - across) * Math.min(1, 1.6 * dt);
    if (along) car.y += nudge; else car.x += nudge;
  }
}

/** Push a car out of buildings and the city edge. Returns how hard it hit (0 if it didn't). */
const wrapA = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
function collideWalls(car, city) {
  let hit = 0, turned = false;
  const c0 = Math.floor((car.x - CAR_R) / TILE), c1 = Math.floor((car.x + CAR_R) / TILE);
  const r0 = Math.floor((car.y - CAR_R) / TILE), r1 = Math.floor((car.y + CAR_R) / TILE);
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    const solid = c < 0 || r < 0 || c >= COLS || r >= ROWS || !drivable(city.tiles[r * COLS + c]);
    if (!solid) continue;
    const nx = Math.max(c * TILE, Math.min(car.x, (c + 1) * TILE)), ny = Math.max(r * TILE, Math.min(car.y, (r + 1) * TILE));
    let dx = car.x - nx, dy = car.y - ny, d = Math.hypot(dx, dy);
    if (d >= CAR_R) continue;
    if (d < 0.001) { dx = Math.cos(car.a + Math.PI); dy = Math.sin(car.a + Math.PI); d = 1; } else { dx /= d; dy /= d; }
    const push = CAR_R - d;
    car.x += dx * push; car.y += dy * push;
    // how much of the speed went into the wall
    const into = -(Math.cos(car.a) * car.v * dx + Math.sin(car.a) * car.v * dy);
    if (into > 0) {
      hit = Math.max(hit, into);
      const headOn = Math.min(1, into / (Math.abs(car.v) || 1)); // 1 = straight at it, 0 = brushing past
      car.bumped = 0.4;
      if (headOn > 0.85) car.v *= 0.35;
      else {
        car.v *= 1 - headOn * 0.5;
        // glancing at speed: ease the nose along the wall (once per step, gently, so corners don't shake it)
        if (!turned && Math.abs(car.v) > 60) {
          const tang = Math.atan2(dx, -dy), alt = tang + Math.PI;
          const pick = Math.abs(wrapA(tang - car.a)) < Math.abs(wrapA(alt - car.a)) ? tang : alt;
          car.a += wrapA(pick - car.a) * 0.3;
          turned = true;
        }
      }
    }
  }
  return hit;
}

// ---------------------------------------------------------------- finding the way
/** Steps-to-target for every road tile (breadth-first), cached per target tile. */
function flowTo(sim, x, y) {
  const tc = Math.max(0, Math.min(COLS - 1, Math.floor(x / TILE))), tr = Math.max(0, Math.min(ROWS - 1, Math.floor(y / TILE)));
  const key = tr * COLS + tc;
  const hit = sim.flows.get(key);
  if (hit && sim.time - hit.at < 0.6) return hit.d;
  const d = new Int16Array(COLS * ROWS).fill(-1);
  const q = new Int32Array(COLS * ROWS);
  let head = 0, tail = 0;
  // start from the nearest drivable tile to the target
  let start = key;
  if (!drivable(sim.city.tiles[key])) {
    let best = Infinity;
    for (let r = Math.max(0, tr - 3); r <= Math.min(ROWS - 1, tr + 3); r++) for (let c = Math.max(0, tc - 3); c <= Math.min(COLS - 1, tc + 3); c++) {
      const k = r * COLS + c;
      if (drivable(sim.city.tiles[k]) && Math.abs(c - tc) + Math.abs(r - tr) < best) { best = Math.abs(c - tc) + Math.abs(r - tr); start = k; }
    }
  }
  d[start] = 0; q[tail++] = start;
  while (head < tail) {
    const k = q[head++], c = k % COLS, r = (k - c) / COLS;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc, nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
      const nk = nr * COLS + nc;
      if (d[nk] >= 0 || !drivable(sim.city.tiles[nk])) continue;
      d[nk] = d[k] + 1; q[tail++] = nk;
    }
  }
  if (sim.flows.size > 64) sim.flows.clear();
  sim.flows.set(key, { d, at: sim.time });
  return d;
}

/** Throttle and steer to drive `car` toward a point along the roads. */
export function steerToward(sim, car, x, y, { aggressive = false } = {}) {
  let tx = x, ty = y;
  const direct = Math.hypot(x - car.x, y - car.y);
  if (direct > TILE * 2.2 || !clearLine(sim.city, car.x, car.y, x, y)) {
    const d = flowTo(sim, x, y);
    // follow the field a few tiles ahead, aiming at the middle of the road
    let c = Math.floor(car.x / TILE), r = Math.floor(car.y / TILE);
    for (let step = 0; step < 3; step++) {
      const here = d[r * COLS + c];
      let best = null;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = c + dc, nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
        const v = d[nr * COLS + nc];
        if (v >= 0 && (here < 0 || v < here) && (!best || v < best.v)) best = { c: nc, r: nr, v };
      }
      if (!best) break;
      c = best.c; r = best.r;
    }
    tx = (c + 0.5) * TILE; ty = (r + 0.5) * TILE;
  }
  return aimAt(car, tx, ty, aggressive);
}
function aimAt(car, tx, ty, aggressive) {
  let diff = Math.atan2(ty - car.y, tx - car.x) - car.a;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  const steer = Math.max(-1, Math.min(1, diff * 2.6));
  const throttle = Math.abs(diff) > 2.4 && Math.abs(car.v) < 60 ? -0.7 : Math.abs(diff) > 1.1 ? 0.35 : aggressive ? 1 : 0.9;
  return [throttle, throttle < 0 ? -steer : steer];
}
function clearLine(city, x0, y0, x1, y1) {
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 16);
  for (let i = 1; i < n; i++) if (!drivable(tileAt(city, x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n))) return false;
  return true;
}

// ---------------------------------------------------------------- the game
/** A new game. mode 'solo' (one driver, 90 s) or 'party' (everyone, 2 min). */
export function createStreet(seed, { mode = 'solo' } = {}) {
  const city = buildCity(seed);
  return {
    seed, mode, city, time: 0, duration: mode === 'party' ? PARTY_SECONDS : SOLO_SECONDS,
    rng: createRng(`${seed}:street-play`),
    drivers: {}, order: [], cops: [], loot: [], nextId: 1, events: [], flows: new Map(), over: false,
  };
}

const START_SPOTS = [[1, 1], [COLS - 2, 1], [1, ROWS - 2], [COLS - 2, ROWS - 2], [COLS / 2, 1], [COLS / 2, ROWS - 2], [1, ROWS / 2], [COLS - 2, ROWS / 2]];

export function addDriver(sim, key, name) {
  if (sim.drivers[key]) return sim.drivers[key];
  const idx = sim.order.length;
  const [c, r] = START_SPOTS[idx % START_SPOTS.length];
  const d = {
    key, name, idx, x: c * TILE, y: r * TILE, a: c > COLS / 2 ? Math.PI : 0, v: 0, assist: true,
    throttle: 0, steer: 0, carry: 0, banked: 0, stars: 0, bust: 0, stun: 0, calm: 0, washCd: 0,
    grabs: 0, busts: 0, rams: 0, steals: 0,
  };
  sim.drivers[key] = d; sim.order.push(key);
  return d;
}

export function setControls(sim, key, throttle, steer) {
  const d = sim.drivers[key];
  if (!d) return;
  d.throttle = Number.isFinite(throttle) ? Math.max(-1, Math.min(1, throttle)) : 0;
  d.steer = Number.isFinite(steer) ? Math.max(-1, Math.min(1, steer)) : 0;
}

function spawnLoot(sim, near = null) {
  const used = new Set(sim.loot.map(l => `${l.x},${l.y}`));
  const options = sim.city.shops.filter(s => !used.has(`${s.x},${s.y}`) && !atHideout(sim.city, s.x, s.y));
  // spread out: prefer shops away from the drivers
  let best = null;
  for (let i = 0; i < 6; i++) {
    const s = sim.rng.pick(options);
    const far = Math.min(...sim.order.map(k => Math.hypot(sim.drivers[k].x - s.x, sim.drivers[k].y - s.y)), 9999);
    if (!best || far > best.far) best = { s, far };
  }
  const s = near || best.s;
  const value = s.kind === 'bank' ? 400 : s.kind === 'jewel' ? 300 : 150;
  sim.loot.push({ id: sim.nextId++, x: s.x, y: s.y, value, kind: s.kind, hot: true });
}

function addStars(sim, d, n) {
  const before = d.stars;
  d.stars = Math.min(MAX_STARS, d.stars + n);
  d.calm = 0;
  if (d.stars !== before) sim.events.push({ e: 'stars', k: d.key, n: d.stars });
}

/** How many police are out, and who they chase: the most wanted first. */
function placeCops(sim) {
  const wanted = sim.order.map(k => sim.drivers[k]).filter(d => d.stars > 0).sort((a, b) => b.stars - a.stars);
  const want = Math.min(sim.mode === 'party' ? 7 : 6, wanted.reduce((n, d) => n + Math.ceil(d.stars * (sim.mode === 'party' ? 0.6 : 0.85)), 0));
  // remove extra cops (the ones farthest from anyone)
  while (sim.cops.length > want) {
    let far = 0, fi = 0;
    sim.cops.forEach((c, i) => { const t = sim.drivers[c.target]; const dd = t ? Math.hypot(t.x - c.x, t.y - c.y) : 1e9; if (dd > far) { far = dd; fi = i; } });
    sim.cops.splice(fi, 1);
  }
  // add cops at the road nearest a corner away from their target
  while (sim.cops.length < want) {
    const target = wanted[sim.cops.length % wanted.length];
    const spots = START_SPOTS.map(([c, r]) => ({ x: c * TILE, y: r * TILE })).filter(p => Math.hypot(p.x - target.x, p.y - target.y) > 520);
    const p = spots.length ? sim.rng.pick(spots) : { x: WW - target.x, y: WH - target.y };
    sim.cops.push({ id: sim.nextId++, x: p.x, y: p.y, a: Math.atan2(target.y - p.y, target.x - p.x), v: 0, target: target.key, stuck: 0, back: 0 });
  }
  // share them out: most wanted gets most
  sim.cops.forEach((c, i) => {
    const t = sim.drivers[c.target];
    if (!t || t.stars === 0) c.target = wanted[i % Math.max(1, wanted.length)]?.key || null;
  });
}

/** Advance the game by dt seconds. */
export function step(sim, dt) {
  if (sim.over) return;
  sim.time += dt;
  sim.events = [];
  const { city } = sim;
  while (sim.loot.filter(l => l.hot).length < (sim.mode === 'party' ? 4 + Math.floor(sim.order.length / 2) : LOOT_LIVE)) spawnLoot(sim);

  for (const k of sim.order) {
    const d = sim.drivers[k];
    d.washCd = Math.max(0, d.washCd - dt);
    if (d.stun > 0) { d.stun -= dt; d.v *= 0.9; driveCar(d, 0, 0, dt, city); continue; }
    const crash = driveCar(d, d.throttle, d.steer, dt, city);
    if (crash > 200) sim.events.push({ e: 'crash', k });
    // grab loot
    for (const l of sim.loot) {
      if (l.taken || Math.hypot(l.x - d.x, l.y - d.y) > 26) continue;
      l.taken = true; d.carry += l.value; d.grabs++; d.haul = (d.haul || 0) + 1;
      if (l.hot) addStars(sim, d, l.kind === 'bank' ? 2 : 1);
      sim.events.push({ e: 'grab', k, v: l.value, x: l.x, y: l.y });
    }
    // car wash: the heat's gone
    if (d.stars > 0 && d.washCd === 0 && atWash(city, d.x, d.y)) { d.stars = 0; d.washCd = WASH_COOLDOWN; sim.events.push({ e: 'wash', k }); }
    // hideout: bank the loot, but only once you've lost the police
    if (d.carry > 0 && atHideout(city, d.x, d.y)) {
      if (d.stars === 0) {
        // greed pays: banking several grabs in one trip adds a bonus
        const bonus = Math.round((d.carry * HAUL_BONUS * Math.max(0, (d.haul || 1) - 1)) / 10) * 10;
        d.banked += d.carry + bonus;
        sim.events.push({ e: 'bank', k, v: d.carry + bonus, bonus, n: d.haul || 1 });
        d.carry = 0; d.haul = 0;
      }
      else if (!d.toldHot) { d.toldHot = true; sim.events.push({ e: 'hot', k }); }
    } else d.toldHot = false;
  }
  sim.loot = sim.loot.filter(l => !l.taken);

  // cars bumping (party): a hard ram knocks loot loose
  for (let i = 0; i < sim.order.length; i++) for (let j = i + 1; j < sim.order.length; j++) {
    const a = sim.drivers[sim.order[i]], b = sim.drivers[sim.order[j]];
    const dx = b.x - a.x, dy = b.y - a.y, dd = Math.hypot(dx, dy);
    if (dd >= CAR_R * 2 || dd === 0) continue;
    const nx = dx / dd, ny = dy / dd, push = (CAR_R * 2 - dd) / 2;
    a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
    const va = Math.cos(a.a) * a.v * nx + Math.sin(a.a) * a.v * ny, vb = Math.cos(b.a) * b.v * nx + Math.sin(b.a) * b.v * ny;
    const closing = va - vb;
    if (closing < 120) continue;
    const [rammer, victim] = va > -vb ? [a, b] : [b, a];
    rammer.rams++;
    if (victim.carry > 0 && !(victim.shield > sim.time)) {
      const drop = Math.max(50, Math.round(victim.carry / 2 / 50) * 50);
      victim.carry -= Math.min(victim.carry, drop);
      if (!victim.carry) victim.haul = 0;
      victim.shield = sim.time + 2;
      sim.loot.push({ id: sim.nextId++, x: victim.x - nx * 30 * (victim === b ? -1 : 1), y: victim.y - ny * 30 * (victim === b ? -1 : 1), value: drop, kind: 'bag', hot: false });
      sim.events.push({ e: 'ram', k: rammer.key, by: rammer.key, to: victim.key, v: drop, x: victim.x, y: victim.y });
      rammer.steals++;
    }
    a.v *= 0.6; b.v *= 0.6;
  }

  // police
  placeCops(sim);
  for (const c of sim.cops) {
    const t = sim.drivers[c.target];
    const spec = { ...CAR, max: COP.max + COP.perStar * (t?.stars || 0), acc: COP.acc, turn: COP.turn };
    let th = 0, st = 0;
    if (c.back > 0) { c.back -= dt; th = -0.8; st = c.backSteer; }
    else if (t) [th, st] = steerToward(sim, c, t.x + Math.cos(t.a) * t.v * 0.35, t.y + Math.sin(t.a) * t.v * 0.35, { aggressive: true });
    driveCar(c, th, st, dt, city, spec);
    // unstick: reverse a moment if it's not getting anywhere
    c.stuck = Math.abs(c.v) < 25 && c.back <= 0 ? c.stuck + dt : 0;
    if (c.stuck > 0.9) { c.back = 0.7; c.backSteer = sim.rng.chance(0.5) ? 1 : -1; c.stuck = 0; }
  }
  // police vs drivers: touching a wanted driver busts them after a moment
  for (const k of sim.order) {
    const d = sim.drivers[k];
    let touching = false, near = false;
    for (const c of sim.cops) {
      const dist = Math.hypot(c.x - d.x, c.y - d.y);
      if (dist < ESCAPE_DIST) near = true;
      if (dist < CAR_R * 2 + 4) {
        touching = true;
        const nx = (d.x - c.x) / (dist || 1), ny = (d.y - c.y) / (dist || 1), push = Math.max(0, CAR_R * 2 - dist) / 2;
        d.x += nx * push; d.y += ny * push; c.x -= nx * push; c.y -= ny * push;
        // ramming a police car makes it worse
        const into = Math.cos(d.a) * d.v * -nx + Math.sin(d.a) * d.v * -ny;
        if (into > 160 && !(d.copRam > sim.time)) { d.copRam = sim.time + 1.5; addStars(sim, d, 1); }
      }
    }
    if (d.stars > 0 && touching && d.stun <= 0) {
      d.bust += dt * (Math.abs(d.v) < 90 ? 1.6 : 0.6);
      if (d.bust >= BUST_TIME) {
        sim.events.push({ e: 'busted', k, v: d.carry });
        d.busts++; d.carry = 0; d.haul = 0; d.stars = 0; d.bust = 0; d.stun = STUN; d.v = 0;
        sim.cops = sim.cops.filter(c => c.target !== k);
      }
    } else d.bust = Math.max(0, d.bust - dt * 0.8);
    // lost them? stars fade one by one when no police are near
    if (d.stars > 0 && !near) {
      d.calm += dt;
      if (d.calm >= ESCAPE_TIME) { d.calm = 0; d.stars--; sim.events.push({ e: d.stars ? 'cooler' : 'lost', k, n: d.stars }); }
    } else d.calm = 0;
  }
  if (sim.time >= sim.duration) sim.over = true;
}

export const scoreOf = d => d.banked;

/** What the party clients need each tick (numbers kept small). */
export function snapshot(sim) {
  return {
    who: sim.order,
    cars: sim.order.map(k => { const d = sim.drivers[k]; return [d.idx, Math.round(d.x), Math.round(d.y), Math.round(d.a * 100) / 100, Math.round(d.v), d.carry, d.banked, d.stars, Math.round(d.bust * 10) / 10, d.stun > 0 ? 1 : 0, Math.round(d.calm * 10) / 10]; }),
    cops: sim.cops.map(c => [c.id, Math.round(c.x), Math.round(c.y), Math.round(c.a * 100) / 100]),
    loot: sim.loot.map(l => [l.id, l.x | 0, l.y | 0, l.value, l.kind]),
    events: sim.events,
  };
}

/** Party scores: money banked, then loot grabbed. */
export function stats(sim) {
  return Object.fromEntries(sim.order.map(k => { const d = sim.drivers[k]; return [k, { score: d.banked, kos: d.steals, downs: d.busts, hits: d.grabs }]; }));
}
export const isOver = sim => sim.over;

// ---------------------------------------------------------------- bots
/** A bot's plan: grab the nearest loot; when hot, lose the police (car wash or drive away); then bank. */
export function botControls(sim, key) {
  const d = sim.drivers[key];
  if (!d || d.stun > 0) return [0, 0];
  if (d.back > 0) { d.back -= 0.05; return [-0.8, d.backSteer]; }
  d.stuckFor = Math.abs(d.v) < 20 ? (d.stuckFor || 0) + 0.05 : 0;
  if (d.stuckFor > 1) { d.stuckFor = 0; d.back = 0.6; d.backSteer = (d.idx % 2) ? 1 : -1; }
  let goal;
  const near = (list, f = () => 0) => list.reduce((a, b) => (!a || Math.hypot(b.x - d.x, b.y - d.y) + f(b) < Math.hypot(a.x - d.x, a.y - d.y) + f(a) ? b : a), null);
  if (d.stars > 0 && (d.carry > 0 || d.stars >= 3)) goal = near(sim.city.washes);
  else if (d.carry >= (sim.mode === 'solo' ? 800 : 500) || (d.carry > 0 && sim.time > sim.duration - 25)) goal = sim.city.hideout;
  else {
    // other drivers carrying lots are worth chasing too
    const prey = sim.order.map(k => sim.drivers[k]).filter(o => o !== d && o.carry >= 300 && Math.hypot(o.x - d.x, o.y - d.y) < 260);
    goal = prey[0] || near(sim.loot, l => -l.value * 0.4) || sim.city.hideout;
  }
  const [th, st] = steerToward(sim, d, goal.x, goal.y);
  return [th * 0.92, st]; // a touch slower than a flat-out human
}

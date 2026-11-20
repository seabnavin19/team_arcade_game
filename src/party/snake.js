// Snake Arena: the simulation the party server runs (8 moves a second).
//
// Every player's snake moves in one grid arena. Eat food to grow (+1, golden
// food +3). If another snake runs into YOUR body, you get +5. Hitting a wall,
// yourself or another snake knocks you out: your body turns into food and you
// respawn small 2 seconds later. Heads that meet knock both out. Most points wins.

import { createRng } from '../core/rng.js';

export const COLS = 40, ROWS = 21, CELL = 20, TOP = 60;   // 800 × 420 board below the HUD
export const TICK_MS = 125;
export const DURATION = 90;
export const MAX_PLAYERS = 8;
export const START_LEN = 4;
export const RESPAWN_TICKS = 16;   // 2 seconds
export const KO_POINTS = 5, FOOD_POINTS = 1, GOLD_POINTS = 3;
const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };
const cellKey = (x, y) => y * COLS + x;

export function createSnakeGame(seed) {
  return { seed: String(seed), rng: createRng(`snake:${seed}`), tick: 0, snakes: {}, order: [], food: [], events: [] };
}

function occupied(g) {
  const set = new Set();
  for (const k of g.order) { const s = g.snakes[k]; if (s.alive) for (const [x, y] of s.body) set.add(cellKey(x, y)); }
  return set;
}

function spawn(g, s) {
  const occ = occupied(g);
  for (let tries = 0; tries < 200; tries++) {
    const x = 4 + Math.floor(g.rng.next() * (COLS - 8)), y = 3 + Math.floor(g.rng.next() * (ROWS - 6));
    // head toward the roomier side, body trailing behind
    const dir = x < COLS / 2 ? 'right' : 'left';
    const [dx, dy] = DIRS[dir];
    const body = Array.from({ length: START_LEN }, (_, i) => [x - dx * i, y - dy * i]);
    const ahead = Array.from({ length: 4 }, (_, i) => [x + dx * (i + 1), y + dy * (i + 1)]);
    const near = [...body, ...ahead].some(([cx, cy]) => occ.has(cellKey(cx, cy)) || g.food.some(f => f.x === cx && f.y === cy));
    const clear = !near && ![...g.order].some(k => { const o = g.snakes[k]; return o !== s && o.alive && Math.abs(o.body[0][0] - x) + Math.abs(o.body[0][1] - y) < 6; });
    if (clear || tries === 199) { Object.assign(s, { body, dir, queue: [], alive: true, grow: 0, respawn: 0 }); return; }
  }
}

export function addSnake(g, key, name) {
  if (g.snakes[key]) return g.snakes[key];
  if (g.order.length >= MAX_PLAYERS) return null;
  const s = { key, name, idx: g.order.length, body: [], dir: 'right', queue: [], alive: false, grow: 0, respawn: 0, score: 0, kos: 0, downs: 0, food: 0 };
  g.snakes[key] = s; g.order.push(key);
  spawn(g, s);
  topUpFood(g);
  return s;
}

/** Queue a turn. Reversing straight into yourself is ignored. */
export function setDir(g, key, d) {
  const s = g.snakes[key];
  if (!s || !DIRS[d]) return;
  const last = s.queue.length ? s.queue.at(-1) : s.dir;
  if (d === last || d === OPPOSITE[last] || s.queue.length >= 2) return;
  s.queue.push(d);
}

function topUpFood(g) {
  const want = 3 + g.order.length;
  const occ = occupied(g);
  let guard = 0;
  while (g.food.filter(f => !f.drop).length < want && guard++ < 200) {
    const x = Math.floor(g.rng.next() * COLS), y = Math.floor(g.rng.next() * ROWS);
    if (occ.has(cellKey(x, y)) || g.food.some(f => f.x === x && f.y === y)) continue;
    g.food.push({ x, y, gold: g.rng.chance(0.12) });
  }
}

function knockOut(g, s, by) {
  s.alive = false; s.respawn = RESPAWN_TICKS; s.downs++;
  // the body becomes food (every other segment)
  s.body.forEach(([x, y], i) => { if (i % 2 === 0 && !g.food.some(f => f.x === x && f.y === y)) g.food.push({ x, y, gold: false, drop: true }); });
  if (g.food.filter(f => f.drop).length > 60) { const drops = g.food.filter(f => f.drop); g.food = g.food.filter(f => !f.drop || drops.indexOf(f) >= drops.length - 60); }
  g.events.push({ e: 'ko', k: s.idx, by: by ? by.idx : -1, x: s.body[0][0], y: s.body[0][1] });
  if (by && by !== s) { by.kos++; by.score += KO_POINTS; }
}

/** One move for every snake. */
export function step(g) {
  g.tick++;
  g.events = [];
  const live = g.order.map(k => g.snakes[k]).filter(s => s.alive);
  // 1. turn and work out new heads
  const heads = new Map();
  for (const s of live) {
    if (s.queue.length) s.dir = s.queue.shift();
    const [dx, dy] = DIRS[s.dir];
    heads.set(s, [s.body[0][0] + dx, s.body[0][1] + dy]);
  }
  // 2. who is eating this move (eaters keep their tail)
  const eating = new Map();
  for (const s of live) {
    const [hx, hy] = heads.get(s);
    const f = g.food.find(fd => fd.x === hx && fd.y === hy);
    if (f) eating.set(s, f);
  }
  // 3. cells occupied after the move (tails move away unless growing)
  const owner = new Map();
  for (const s of live) {
    const keepTail = s.grow > 0 || eating.has(s);
    const cells = keepTail ? s.body : s.body.slice(0, -1);
    for (const [x, y] of cells) owner.set(cellKey(x, y), s);
  }
  // 4. collisions
  const dead = new Map(); // snake -> credited snake (or null)
  for (const s of live) {
    const [hx, hy] = heads.get(s);
    if (hx < 0 || hx >= COLS || hy < 0 || hy >= ROWS) { dead.set(s, null); continue; }
    const hitBody = owner.get(cellKey(hx, hy));
    if (hitBody) { dead.set(s, hitBody === s ? null : hitBody); continue; }
    const other = live.find(o => o !== s && heads.get(o)[0] === hx && heads.get(o)[1] === hy);
    if (other) dead.set(s, null); // head-on: both out, nobody scores
  }
  // 5. move the survivors, eat
  for (const s of live) {
    if (dead.has(s)) continue;
    s.body.unshift(heads.get(s));
    const f = eating.get(s);
    if (f) {
      g.food.splice(g.food.indexOf(f), 1);
      const pts = f.gold ? GOLD_POINTS : FOOD_POINTS;
      s.score += pts; s.food++; s.grow += pts - 1;
      g.events.push({ e: 'eat', k: s.idx, gold: f.gold, x: f.x, y: f.y });
    } else if (s.grow > 0) s.grow--;
    else s.body.pop();
  }
  for (const [s, by] of dead) knockOut(g, s, by);
  // 6. respawns
  for (const k of g.order) {
    const s = g.snakes[k];
    if (!s.alive && --s.respawn <= 0) { spawn(g, s); g.events.push({ e: 'spawn', k: s.idx }); }
  }
  topUpFood(g);
}

/** Compact state for players: [idx, alive, score, x0, y0, x1, y1, ...] per snake. */
export function snapshot(g) {
  return {
    who: g.order,
    snakes: g.order.map(k => { const s = g.snakes[k]; return [s.idx, s.alive ? 1 : 0, s.score, ...(s.alive ? s.body.flat() : [])]; }),
    food: g.food.map(f => [f.x, f.y, f.gold ? 1 : 0]),
    events: g.events,
  };
}

export function snakeStats(g) {
  return Object.fromEntries(g.order.map(k => { const s = g.snakes[k]; return [k, { score: s.score, kos: s.kos, downs: s.downs, hits: s.food }]; }));
}

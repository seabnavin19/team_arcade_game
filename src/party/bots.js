// Bot players for party games.
//
// Every party game except Duo Mode is played by 4. If fewer people join, bots
// fill the empty seats when the game starts, so one person can play alone.
// Bots run on the party server and play through the same rules as people
// (no peeking at anything a player couldn't see, apart from Brain Race where
// a bot simply "knows" the answer with some chance). They're decent but
// beatable: a little slow, sometimes wrong.

import { createRng } from '../core/rng.js';
import { PARTY_GAMES, isDuo } from './rules.js';
import { WORDS, normalize } from './draw.js';
import { COLS, ROWS } from './snake.js';
import { COLORS, SKY_TOP, SKY_BOTTOM } from './firework.js';

export const PARTY_SIZE = 4;
const NAMES = ['Sophea', 'Dara', 'Vuthy', 'Chenda', 'Rithy', 'Malis', 'Kosal', 'Bopha'];
export const BOT_PREFIX = 'bot-';
export const isBot = key => String(key).startsWith(BOT_PREFIX);

/** When a non-Duo party starts, add bots until there are PARTY_SIZE players. Returns how many were added. */
export function fillWithBots(p, now = p.startAt) {
  if (isDuo(p)) return 0;
  const g = PARTY_GAMES[p.game || 'reaction'];
  const want = Math.min(PARTY_SIZE, g.maxPlayers);
  const rng = createRng(`bots:${p.seed}`);
  const names = [...NAMES];
  let added = 0, n = 1;
  while (Object.keys(p.players).length < want) {
    while (p.players[`${BOT_PREFIX}${n}`]) n++;
    const name = names.splice(Math.floor(rng.next() * names.length), 1)[0] || `Bot ${n}`;
    p.players[`${BOT_PREFIX}${n}`] = { name: `🤖 ${name}`, bot: true, score: 0, hits: 0, fakes: 0, misses: 0, kos: 0, downs: 0, joinedAt: now + n };
    added++;
  }
  return added;
}

export const botKeys = p => Object.keys(p?.players || {}).filter(isBot);

// A steady random number per bot and moment, so a bot's choice doesn't flicker.
const roll = (...parts) => createRng(parts.join(':')).next();

// ---------- Ship Battle ----------
/** Steering for a bot ship: chase the nearest ship and circle it so the nose (and guns) point at it. */
export function battleBotInput(sim, key, t) {
  const me = sim.ships[key];
  if (!me || !me.alive) return [0, 0];
  // low on shields and a pickup nearby? go get it
  if (me.hp <= 1 && sim.pickups.length) {
    const pk = sim.pickups.reduce((a, b) => (Math.hypot(a.x - me.x, a.y - me.y) < Math.hypot(b.x - me.x, b.y - me.y) ? a : b));
    if (Math.hypot(pk.x - me.x, pk.y - me.y) < 260) return unit(pk.x - me.x, pk.y - me.y);
  }
  let target = null, best = Infinity;
  for (const k of sim.order) {
    const s = sim.ships[k];
    if (k === key || !s.alive) continue;
    const d = Math.hypot(s.x - me.x, s.y - me.y);
    if (d < best) { best = d; target = s; }
  }
  if (!target) return wander(me, t, key);
  // Guns point where the ship flies, so: fly straight at the target (that's
  // aiming), lead it a little, and peel off sideways when too close.
  const lead = best / 430; // bullet travel time
  const tx = target.x + (target.mx || 0) * 210 * lead, ty = target.y + (target.my || 0) * 210 * lead;
  const [dx, dy] = unit(tx - me.x, ty - me.y);
  if (best < 85) { const side = roll(key, Math.floor(t / 3)) < 0.5 ? 1 : -1; return unit(-dy * side + dx * 0.2, dx * side + dy * 0.2); }
  // ease off the throttle in range so the guns stay on target; a small aim
  // error (changing every couple of seconds) keeps it from being an aimbot
  const err = (roll(key, 'aim', Math.floor(t / 2)) - 0.5) * 0.16;
  const m = best < 280 ? 0.3 : 1;
  const [ax, ay] = [dx * Math.cos(err) - dy * Math.sin(err), dx * Math.sin(err) + dy * Math.cos(err)];
  return [ax * m, ay * m];
}
function wander(me, t, key) { const a = t * 0.6 + roll(key) * 6; return [Math.cos(a), Math.sin(a)]; }
function unit(x, y) { const d = Math.hypot(x, y) || 1; return [x / d, y / d]; }

// ---------- Snake Arena ----------
const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };

/** Next turn for a bot snake: head for the nearest food, never into a wall or a body, prefer open space. */
export function snakeBotDir(g, key) {
  const s = g.snakes[key];
  if (!s || !s.alive) return null;
  const blocked = new Set();
  for (const k of g.order) {
    const o = g.snakes[k];
    if (!o.alive) continue;
    o.body.forEach(([x, y], i) => { if (i < o.body.length - 1) blocked.add(y * COLS + x); });
    if (o !== s) { const [hx, hy] = o.body[0]; for (const [dx, dy] of Object.values(DIRS)) blocked.add((hy + dy) * COLS + hx + dx); } // don't meet heads
  }
  const free = (x, y) => x >= 0 && x < COLS && y >= 0 && y < ROWS && !blocked.has(y * COLS + x);
  const room = (x, y) => { // how many cells we could reach from here (capped), to avoid dead ends
    const seen = new Set([y * COLS + x]), queue = [[x, y]];
    while (queue.length && seen.size < 40) {
      const [cx, cy] = queue.shift();
      for (const [dx, dy] of Object.values(DIRS)) {
        const nx = cx + dx, ny = cy + dy, k = ny * COLS + nx;
        if (!seen.has(k) && free(nx, ny)) { seen.add(k); queue.push([nx, ny]); }
      }
    }
    return seen.size;
  };
  const [hx, hy] = s.body[0];
  const food = g.food.reduce((a, f) => {
    const d = Math.abs(f.x - hx) + Math.abs(f.y - hy) - (f.gold ? 4 : 0);
    return !a || d < a.d ? { f, d } : a;
  }, null)?.f;
  let best = null;
  for (const [d, [dx, dy]] of Object.entries(DIRS)) {
    if (d === OPPOSITE[s.dir]) continue;
    const nx = hx + dx, ny = hy + dy;
    if (!free(nx, ny)) continue;
    const space = room(nx, ny);
    const toFood = food ? Math.abs(food.x - nx) + Math.abs(food.y - ny) : 0;
    const score = (space >= 40 ? 0 : (40 - space) * 3) + toFood + (d === s.dir ? -0.5 : 0);
    if (!best || score < best.score) best = { d, score };
  }
  return best ? best.d : s.dir;
}

// ---------- Reaction Tap ----------
/** When (seconds after it appears) bot `key` taps target i, or null if it doesn't. Fakes are mostly avoided. */
export function reactionBotTap(seed, key, i, tg) {
  const r = roll(seed, key, 'tap', i);
  if (tg.fake) return r < 0.1 ? 0.5 + r * 3 : null;
  if (r > 0.8) return null; // missed it
  const age = 0.42 + roll(seed, key, 'speed', i) * 0.55; // 0.42–0.97 s: quick, but a fast human wins
  return age < tg.life - 0.05 ? age : null;
}

// ---------- Brain Race ----------
/** A bot's answer to question i: { at: seconds after it opens, c: option }. */
export function quizBotAnswer(seed, key, i, correct) {
  if (roll(seed, key, 'skip', i) < 0.08) return null;
  const at = 2.2 + roll(seed, key, 'at', i) * 6;
  const right = roll(seed, key, 'ok', i) < 0.6;
  const wrong = (correct + 1 + Math.floor(roll(seed, key, 'c', i) * 3)) % 4;
  return { at, c: right ? correct : wrong };
}

// ---------- Boat Race ----------
/** When a bot hits beat `beatT` (ms on the server clock), or null if it misses it. */
export function boatBotTap(seed, key, beatT) {
  if (roll(seed, key, 'b', beatT) < 0.1) return null;
  const off = (roll(seed, key, 'o', beatT) - 0.5) * 2 * 170; // ±170 ms: mostly "good", sometimes "perfect"
  return beatT + off;
}

// ---------- Draw & Guess ----------
/** When a bot guesses round `round` right (seconds into the round), or null if it doesn't. */
export function drawBotGuess(seed, key, round) {
  if (roll(seed, key, 'g', round) < 0.35) return null;
  return 9 + roll(seed, key, 'gt', round) * 30;
}
/** A wrong (but plausible) guess to show in the chat now and then. */
export function drawBotChatter(seed, key, round, n, word) {
  const pool = WORDS.filter(w => normalize(w) !== normalize(word));
  return pool[Math.floor(roll(seed, key, 'w', round, n) * pool.length)];
}

// ---------- Firework Show ----------
/** A bot's firework drawing: a simple shape in a couple of palette colours. */
export function fireworkBotArt(seed, key) {
  const shapes = ['heart', 'star', 'flower', 'spiral', 'smile', 'burst'];
  const shape = shapes[Math.floor(roll(seed, key, 'shape') * shapes.length)];
  const c1 = COLORS[Math.floor(roll(seed, key, 'c1') * COLORS.length)];
  const c2 = COLORS[Math.floor(roll(seed, key, 'c2') * COLORS.length)];
  const cx = 400 + (roll(seed, key, 'x') - 0.5) * 200, cy = (SKY_TOP + SKY_BOTTOM) / 2, R = 95;
  const path = (f, n = 60, from = 0, to = Math.PI * 2) => {
    const pts = [];
    for (let i = 0; i <= n; i++) { const [x, y] = f(from + (to - from) * (i / n)); pts.push(Math.round(x), Math.round(Math.max(SKY_TOP, Math.min(SKY_BOTTOM, y)))); }
    return pts;
  };
  const circle = (r, x0 = cx, y0 = cy) => a => [x0 + Math.cos(a) * r, y0 + Math.sin(a) * r];
  const out = [];
  if (shape === 'heart') out.push({ c: c1, pts: path(a => [cx + 16 * Math.sin(a) ** 3 * 5.5, cy - (13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)) * 5.5]) });
  if (shape === 'star') out.push({ c: c1, pts: Array.from({ length: 11 }, (_, i) => { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? R * 0.45 : R; return [Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r)]; }).flat() });
  if (shape === 'flower') { for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; out.push({ c: c1, pts: path(circle(R * 0.35, cx + Math.cos(a) * R * 0.5, cy + Math.sin(a) * R * 0.5), 24) }); } out.push({ c: c2, pts: path(circle(R * 0.22), 20) }); }
  if (shape === 'spiral') out.push({ c: c1, pts: path(a => [cx + Math.cos(a) * a * 9, cy + Math.sin(a) * a * 9], 90, 0, Math.PI * 7) });
  if (shape === 'smile') { out.push({ c: c1, pts: path(circle(R)) }); out.push({ c: c2, pts: path(circle(R * 0.55), 20, 0.4, Math.PI - 0.4) }); out.push({ c: c2, pts: path(circle(8, cx - 32, cy - 28), 10) }); out.push({ c: c2, pts: path(circle(8, cx + 32, cy - 28), 10) }); }
  if (shape === 'burst') for (let k = 0; k < 12; k++) { const a = k * Math.PI / 6; out.push({ c: k % 2 ? c1 : c2, pts: [Math.round(cx + Math.cos(a) * 18), Math.round(cy + Math.sin(a) * 18), Math.round(cx + Math.cos(a) * R), Math.round(cy + Math.sin(a) * R)] }); }
  return out;
}
/** When a bot sends its drawing (seconds into the draw phase) and how many stars it gives firework i. */
export const fireworkBotReadyAt = (seed, key) => 6 + roll(seed, key, 'ready') * 18;
export const fireworkBotStars = (seed, key, i) => ({ at: 1.5 + roll(seed, key, 'rt', i) * 4, stars: 3 + Math.floor(roll(seed, key, 'st', i) * 3) });

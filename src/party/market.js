// Night Market Duo: a two-player co-op cooking game for Duo Mode.
// The party server runs this simulation 10 times a second.
//
// One player is the COOK: they put dishes on the 3 burners and move cooked
// dishes to the counter before they burn. The other is the SERVER: they pick a
// dish on the counter and hand it to a customer who ordered it, before the
// customer runs out of patience. Roles swap at half time. All tips are shared:
// both players always have the same score.

import { createRng } from '../core/rng.js';

export const TICK_MS = 100;
export const DURATION = 90;
export const TICKS = (DURATION * 1000) / TICK_MS;   // 900
export const SWAP_TICK = TICKS / 2;                  // roles swap at 0:45
export const RUSH_TICK = TICKS - 250;                // rush hour: the last 25 seconds
export const BURNERS = 3, COUNTER = 4, SEATS = 4;
export const BURN_AFTER = 60;                        // ticks a cooked dish can wait on the burner
export const DISHES = [
  { id: 'noodle', emoji: '🍜', name: 'Noodle soup', cook: 40 },
  { id: 'skewer', emoji: '🍢', name: 'Skewers', cook: 25 },
  { id: 'rice', emoji: '🍚', name: 'Fried rice', cook: 55 },
];
export const BASE_TIP = 10, SPEED_TIP = 10, MAX_MULT = 3;

/** The two players in join order; the first cooks first. */
export function createMarket(seed) {
  return {
    seed: String(seed), rng: createRng(`market:${seed}`), tick: 0,
    pair: [], names: {}, burners: Array(BURNERS).fill(null), counter: Array(COUNTER).fill(null), seats: Array(SEATS).fill(null),
    nextCustomer: 15, nextId: 1, tips: 0, combo: 0, served: 0, cooked: {}, handed: {}, walked: 0, burned: 0, events: [],
  };
}

export function addCook(g, key, name) {
  if (!g.pair.includes(key)) {
    if (g.pair.length >= 2) return null;
    g.pair.push(key);
  }
  g.names[key] = name;
  g.cooked[key] ||= 0; g.handed[key] ||= 0;
  return { key, score: g.tips };
}

export const swapped = g => g.tick >= SWAP_TICK;
export const cookKey = g => g.pair[swapped(g) ? 1 : 0] ?? g.pair[0];
export const serverKey = g => g.pair[swapped(g) ? 0 : 1] ?? null;
const multiplier = combo => Math.min(MAX_MULT, 1 + Math.floor(combo / 3));

/** A player's tap, already parsed. Only the right role can do each action. */
export function act(g, key, msg) {
  if (g.tick >= TICKS) return;
  const isCook = key === cookKey(g), isServer = key === serverKey(g);
  if (msg.type === 'cook' && isCook) {
    const d = Number(msg.d), b = g.burners.indexOf(null);
    if (!DISHES[d] || b < 0) return;
    g.burners[b] = { d, t: 0, burned: false };
  } else if (msg.type === 'plate' && isCook) {
    const b = Number(msg.b), slot = g.burners[b];
    if (!slot || slot.burned || slot.t < DISHES[slot.d].cook) return;
    const c = g.counter.indexOf(null);
    if (c < 0) { g.events.push({ e: 'full' }); return; }
    g.counter[c] = slot.d; g.burners[b] = null; g.cooked[key]++;
  } else if (msg.type === 'trash' && isCook) {
    const b = Number(msg.b);
    if (g.burners[b]) g.burners[b] = null;
  } else if (msg.type === 'serve' && isServer) {
    const c = Number(msg.c), s = Number(msg.s);
    const dish = g.counter[c], cust = g.seats[s];
    if (dish == null || !cust) return;
    if (dish !== cust.d) { g.combo = 0; g.events.push({ e: 'wrong', s }); return; }
    g.combo++;
    const tip = Math.round((BASE_TIP + SPEED_TIP * (cust.p / cust.max)) * multiplier(g.combo));
    g.tips += tip; g.served++; g.handed[key]++;
    g.counter[c] = null; g.seats[s] = null;
    g.events.push({ e: 'tip', s, tip, combo: g.combo });
  } else if (msg.type === 'toss' && isServer) {
    const c = Number(msg.c);
    if (g.counter[c] != null) g.counter[c] = null;
  }
}

/** One tick: cook, burn, customers arrive and lose patience. */
export function step(g) {
  if (g.tick >= TICKS) return;
  g.tick++;
  g.events = [];
  if (g.tick === SWAP_TICK) g.events.push({ e: 'swap' });
  if (g.tick === RUSH_TICK) g.events.push({ e: 'rush' });
  for (let b = 0; b < BURNERS; b++) {
    const slot = g.burners[b];
    if (!slot) continue;
    slot.t++;
    if (slot.burned) { if (slot.t > DISHES[slot.d].cook + BURN_AFTER + 15) g.burners[b] = null; continue; }
    if (slot.t > DISHES[slot.d].cook + BURN_AFTER) { slot.burned = true; g.burned++; g.events.push({ e: 'burn', b }); }
  }
  for (let s = 0; s < SEATS; s++) {
    const cust = g.seats[s];
    if (cust && --cust.p <= 0) { g.seats[s] = null; g.walked++; g.combo = 0; g.events.push({ e: 'walk', s }); }
  }
  const rush = g.tick >= RUSH_TICK;
  if (--g.nextCustomer <= 0) {
    const free = g.seats.map((c, i) => (c ? -1 : i)).filter(i => i >= 0);
    if (free.length) {
      const s = free[Math.floor(g.rng.next() * free.length)];
      const max = rush ? 150 : Math.round(230 - 60 * (g.tick / TICKS));
      g.seats[s] = { id: g.nextId++, d: Math.floor(g.rng.next() * DISHES.length), p: max, max };
      g.events.push({ e: 'arrive', s });
    }
    const gap = rush ? 22 : Math.round(55 - 20 * (g.tick / TICKS));
    g.nextCustomer = gap + Math.floor(g.rng.next() * 15);
  }
}

/** Compact state for players. */
export function snapshot(g) {
  return {
    who: g.pair, cook: cookKey(g), server: serverKey(g), tick: g.tick, ticks: TICKS, swapAt: SWAP_TICK, rush: g.tick >= RUSH_TICK,
    burners: g.burners.map(b => (b ? [b.d, Math.round((b.t / DISHES[b.d].cook) * 100) / 100, b.burned ? 1 : 0, Math.round(((b.t - DISHES[b.d].cook) / BURN_AFTER) * 100) / 100] : null)),
    counter: g.counter, seats: g.seats.map(c => (c ? [c.d, Math.round((c.p / c.max) * 100) / 100, c.id] : null)),
    tips: g.tips, combo: g.combo, mult: multiplier(g.combo), events: g.events,
  };
}

/** Both players share the team's tips; hits = dishes each one cooked or served. */
export function marketStats(g) {
  return Object.fromEntries(g.pair.map(k => [k, { score: g.tips, kos: 0, downs: 0, hits: (g.cooked[k] || 0) + (g.handed[k] || 0) }]));
}

export const marketSummary = g => ({ tips: g.tips, served: g.served, walked: g.walked, burned: g.burned });

/** After a server restart: keep the team's tips and counts, and the clock. */
export function restoreMarket(g, summary, tick = 0) {
  g.tick = Math.max(0, Math.min(TICKS, Math.floor(tick)));
  if (!summary) return;
  Object.assign(g, { tips: summary.tips || 0, served: summary.served || 0, walked: summary.walked || 0, burned: summary.burned || 0 });
}

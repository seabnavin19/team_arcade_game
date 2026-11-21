// Water Festival Boat Race (Bon Om Touk): the rules the party room runs.
//
// A festival drum beats. Tap Paddle on the beat: the closer to the beat, the
// stronger the stroke (one stroke counts per beat, so mashing doesn't help).
// With 4+ players you race in crews, and a crew whose members ALL hit the
// same beat gets a sync boost. With fewer than 4, everyone races their own
// boat, and a streak of 4+ good strokes gives a rhythm boost instead.
// The drum speeds up on the final stretch. First boat past the Royal Palace wins.

export const COURSE = 1000;            // distance to the finish
export const BEAT_MS = 800, FAST_BEAT_MS = 650, FINAL_STRETCH = 0.75;
export const WINDOW_MS = 300, PERFECT_MS = 90, GOOD_MS = 180;
export const STROKE = 19.2, DRAG = 1.2;
export const SYNC_BOOST = 1.35, STREAK_BOOST = 1.25, STREAK_FOR_BOOST = 4;
export const LEAD_IN_MS = 1500, MAX_SECONDS = 90, GRACE_MS = 8000;
export const CATCH_UP = 0.3;           // boats far behind get up to +30% per stroke, to keep races close
export const TICK_MS = 50;
export const CREWS = ['Naga', 'Hanuman', 'Garuda', 'Apsara'];
export const MAX_PLAYERS = 16;

/** How many crews for n players: 0 means everyone races solo. */
export const crewCount = n => (n < 4 ? 0 : n <= 7 ? 2 : n <= 11 ? 3 : 4);

/**
 * Put players into crews, honouring lobby picks while keeping crews even.
 * keys: players in join order; prefs: { key: crewIndex }.
 */
export function assignCrews(keys, prefs = {}) {
  const count = crewCount(keys.length);
  if (!count) return null;
  const cap = Math.ceil(keys.length / count);
  const sizes = Array(count).fill(0), out = {};
  for (const k of keys) {
    const want = prefs[k];
    if (Number.isInteger(want) && want >= 0 && want < count && sizes[want] < cap) { out[k] = want; sizes[want]++; }
  }
  for (const k of keys) {
    if (out[k] !== undefined) continue;
    const c = sizes.indexOf(Math.min(...sizes));
    out[k] = c; sizes[c]++;
  }
  return out;
}

/** p: the party (players in join order, crew picks, startAt). */
export function createRace(seed, p) {
  const keys = Object.entries(p.players).sort((a, b) => a[1].joinedAt - b[1].joinedAt).map(([k]) => k);
  const prefs = Object.fromEntries(keys.map(k => [k, p.players[k].crew]));
  const crews = assignCrews(keys, prefs);
  const sim = {
    seed: String(seed), mode: crews ? 'crews' : 'solo', startAt: p.startAt, lastNow: p.startAt, assign: crews || {},
    boats: [], players: {}, names: {}, beats: [], nextBeatAt: p.startAt + LEAD_IN_MS, interval: BEAT_MS,
    stretch: false, firstFinish: 0, over: false, events: [],
  };
  if (crews) for (let c = 0; c < crewCount(keys.length); c++) sim.boats.push(newBoat(CREWS[c], c));
  return sim;
}

const newBoat = (name, crew) => ({ name, crew, members: [], x: 0, v: 0, finish: 0, syncStreak: 0, bestSync: 0 });

/** Add a player (at the start, or late). Crews: the smallest crew. Solo: a new boat. */
export function addRower(sim, key, name) {
  if (sim.players[key]) return sim.players[key];
  if (Object.keys(sim.players).length >= MAX_PLAYERS) return null;
  let b;
  if (sim.mode === 'crews') {
    b = sim.assign[key];
    if (b === undefined) { const sizes = sim.boats.map(x => x.members.length); b = sizes.indexOf(Math.min(...sizes)); }
  } else {
    sim.boats.push(newBoat(name, -1));
    b = sim.boats.length - 1;
  }
  sim.boats[b].members.push(key);
  sim.names[key] = name;
  sim.players[key] = { boat: b, strokes: 0, onBeat: 0, perfect: 0, miss: 0, streak: 0, best: 0 };
  return sim.players[key];
}

export const quality = d => (Math.abs(d) <= PERFECT_MS ? 1 : Math.abs(d) <= GOOD_MS ? 0.75 : Math.abs(d) <= WINDOW_MS ? 0.4 : 0);

/** A tap. tapMs is the player's estimate of the server clock when they tapped. */
export function paddle(sim, key, tapMs, now) {
  const pl = sim.players[key];
  if (!pl || sim.over || sim.boats[pl.boat].finish) return null;
  const t = Number.isFinite(tapMs) && Math.abs(tapMs - now) <= 800 ? tapMs : now; // trust the client's timing within reason
  let best = null;
  for (const beat of sim.beats) {
    if (beat.resolved) continue;
    const d = t - beat.t;
    if (Math.abs(d) <= WINDOW_MS && (!best || Math.abs(d) < Math.abs(best.d))) best = { beat, d };
  }
  if (!best || best.beat.taps[key] !== undefined) {
    if (!best) { pl.miss++; pl.streak = 0; }
    return { q: 0 };
  }
  const q = quality(best.d);
  best.beat.taps[key] = q;
  pl.strokes++;
  if (q >= 0.7) pl.onBeat++;
  if (q === 1) pl.perfect++;
  return { q, d: Math.round(best.d) };
}

export function step(sim, now) {
  const dt = Math.max(0, Math.min(0.25, (now - sim.lastNow) / 1000));
  sim.lastNow = now;
  sim.events = [];
  if (sim.over) return;
  // schedule beats a second ahead so screens can show them coming
  while (sim.nextBeatAt <= now + 1000) {
    sim.beats.push({ t: sim.nextBeatAt, taps: {}, resolved: false });
    sim.nextBeatAt += sim.interval;
  }
  // resolve beats whose window has closed
  const leader = Math.max(0, ...sim.boats.map(b => b.x));
  for (const beat of sim.beats) {
    if (beat.resolved || now <= beat.t + WINDOW_MS) continue;
    beat.resolved = true;
    sim.boats.forEach((boat, bi) => {
      if (boat.finish || !boat.members.length) return;
      const qs = boat.members.map(k => beat.taps[k] || 0);
      for (const [i, k] of boat.members.entries()) {
        const pl = sim.players[k];
        pl.streak = qs[i] >= 0.7 ? pl.streak + 1 : 0;
        pl.best = Math.max(pl.best, pl.streak);
      }
      const avg = qs.reduce((a, b) => a + b, 0) / qs.length;
      const sync = boat.members.length >= 2 && qs.every(q => q >= 0.7);
      boat.syncStreak = sync ? boat.syncStreak + 1 : 0;
      boat.bestSync = Math.max(boat.bestSync, boat.syncStreak);
      const soloRhythm = boat.members.length === 1 && sim.players[boat.members[0]].streak >= STREAK_FOR_BOOST;
      const boost = sync ? SYNC_BOOST : soloRhythm ? STREAK_BOOST : 1;
      const catchUp = 1 + Math.min(CATCH_UP, (leader - boat.x) / COURSE); // the further behind, the more each stroke counts
      boat.v += avg * boost * catchUp * STROKE;
      if (avg > 0) sim.events.push({ e: 'stroke', b: bi, p: Math.round(avg * 100) / 100, sync, boost: boost > 1 });
    });
  }
  sim.beats = sim.beats.filter(b => !b.resolved || b.t > now - 2000);
  // boats glide and slow down between strokes
  sim.boats.forEach((boat, bi) => {
    if (boat.finish) return;
    boat.v *= Math.exp(-DRAG * dt);
    boat.x += boat.v * dt;
    if (boat.x >= COURSE) {
      boat.x = COURSE; boat.finish = now - sim.startAt;
      if (!sim.firstFinish) sim.firstFinish = now;
      sim.events.push({ e: 'finish', b: bi, ms: boat.finish });
    }
  });
  if (!sim.stretch && sim.boats.some(b => b.x >= COURSE * FINAL_STRETCH)) {
    sim.stretch = true; sim.interval = FAST_BEAT_MS;
    sim.events.push({ e: 'stretch' });
  }
  const allIn = sim.boats.length > 0 && sim.boats.every(b => b.finish);
  sim.over = allIn || (sim.firstFinish && now - sim.firstFinish >= GRACE_MS) || now - sim.startAt >= MAX_SECONDS * 1000;
}

export const isOver = sim => !!sim.over;

/** Places: finished boats by time, then the rest by distance. */
export function standings(sim) {
  return sim.boats.map((b, i) => ({ ...b, i }))
    .sort((a, b) => (a.finish && b.finish ? a.finish - b.finish : a.finish ? -1 : b.finish ? 1 : b.x - a.x))
    .map((b, n) => ({ ...b, place: n + 1 }));
}

export function snapshot(sim) {
  const upcoming = sim.beats.filter(b => !b.resolved).map(b => b.t).concat([sim.nextBeatAt]).slice(0, 3);
  return {
    mode: sim.mode, stretch: sim.stretch,
    boats: sim.boats.map((b, i) => [i, Math.round(b.x * 10) / 10, Math.round(b.v * 10) / 10, b.finish, b.crew, b.name, b.members, b.syncStreak]),
    beats: upcoming, interval: sim.interval,
    me: Object.fromEntries(Object.entries(sim.players).map(([k, p]) => [k, [p.boat, p.strokes, p.onBeat, p.streak]])),
    events: sim.events,
  };
}

const accuracy = p => (p.strokes ? Math.round((p.onBeat / Math.max(p.strokes + p.miss, 1)) * 100) : 0);

/** Party scores: your boat's place first, then your own accuracy. */
export function raceStats(sim) {
  const st = standings(sim), n = st.length;
  const placeOf = Object.fromEntries(st.map(b => [b.i, b.place]));
  return Object.fromEntries(Object.entries(sim.players).map(([k, p]) => [k, {
    score: (n - placeOf[p.boat] + 1) * 1000 + accuracy(p), kos: 0, downs: 0, hits: p.onBeat,
  }]));
}

export function raceSummary(sim) {
  const boats = standings(sim).map(b => ({ name: b.name, crew: b.crew, place: b.place, ms: b.finish, x: Math.round(b.x), members: b.members.map(k => sim.names[k]), bestSync: b.bestSync }));
  const rowers = Object.entries(sim.players).filter(([, p]) => p.strokes >= 5)
    .map(([k, p]) => ({ name: sim.names[k], pct: accuracy(p), strokes: p.strokes, best: p.best }))
    .sort((a, b) => b.pct - a.pct || b.strokes - a.strokes);
  const syncBoat = sim.mode === 'crews' ? [...boats].sort((a, b) => b.bestSync - a.bestSync)[0] : null;
  return {
    mode: sim.mode, boats,
    best: rowers[0] || null,
    sync: syncBoat && syncBoat.bestSync >= 2 ? { name: syncBoat.name, streak: syncBoat.bestSync } : null,
  };
}

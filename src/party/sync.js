// In Sync: a two-player "how well do you know me?" game for Duo Mode.
//
// Each round is about one of the two players (it alternates). That player
// answers for themselves, the partner guesses what they picked. Neither sees
// the other's pick until the reveal. A match scores for the TEAM: both players
// always share one score.
//
// Scoring per match: 200, plus up to 100 for how fast the guesser was.
// Three or more matches in a row double the points (the "in sync streak").

import { createRng } from '../core/rng.js';

export const ROUNDS = 8;
export const ANSWER_SECONDS = 12;
export const REVEAL_SECONDS = 4;
export const PER_ROUND = ANSWER_SECONDS + REVEAL_SECONDS;
export const SYNC_SECONDS = ROUNDS * PER_ROUND; // 128 s at most; rounds end early once both have picked
export const MATCH_POINTS = 200;
export const SPEED_POINTS = 100;
export const STREAK_FROM = 3;

// Light questions that work for partners and for work friends alike.
// Edit freely: each needs a short prompt and exactly 4 options.
export const QUESTIONS = [
  { q: 'Perfect Sunday morning?', o: ['☕ Café and brunch', '🛏️ Sleep till noon', '🏃 Morning run', '📺 Series marathon'] },
  { q: 'Pick a holiday', o: ['🏖️ Beach', '🏔️ Mountains', '🏙️ Big city', '🏡 Stay home'] },
  { q: 'Favourite street food?', o: ['🍢 Grilled skewers', '🍜 Noodle soup', '🥖 Num pang', '🍧 Shaved ice'] },
  { q: 'Coffee order?', o: ['🧋 Iced milk coffee', '☕ Black, no sugar', '🍵 Tea instead', '🥤 Something sweet'] },
  { q: 'Dream weekend activity?', o: ['🎮 Gaming', '🛍️ Shopping', '🌳 Outdoors', '🍳 Cooking at home'] },
  { q: 'Which pet?', o: ['🐶 Dog', '🐱 Cat', '🐟 Fish', '🙅 No pets'] },
  { q: 'Movie night pick?', o: ['😂 Comedy', '😱 Horror', '💥 Action', '😭 Something that makes you cry'] },
  { q: 'Morning person or night owl?', o: ['🌅 Up with the sun', '🌙 Night owl', '😴 Neither, always tired', '☕ Depends on the coffee'] },
  { q: 'How do you handle a bad day?', o: ['🍫 Snacks', '🎧 Music, alone', '🗣️ Talk it out', '😴 Sleep it off'] },
  { q: 'Phone battery usually at…', o: ['🔋 Always 80%+', '🪫 Living on 5%', '🔌 Always on the charger', '🤷 Never check'] },
  { q: 'Best part of a trip?', o: ['🍽️ The food', '📸 The photos', '🛌 The hotel', '🗺️ Getting lost'] },
  { q: 'Spicy level?', o: ['🌶️🌶️🌶️ Fire', '🌶️ A little', '🥛 None, please', '🔥 More than you'] },
  { q: 'Karaoke song style?', o: ['🎤 Big ballad', '🕺 Dance hit', '🤘 Rock', '🙈 Never singing'] },
  { q: 'Pick a superpower', o: ['🕊️ Fly', '⏱️ Stop time', '🫥 Invisible', '🧠 Read minds'] },
  { q: 'Usually late because…', o: ['😴 Overslept', '👕 Picking an outfit', '📱 On the phone', '⏰ Never late'] },
  { q: 'Dessert?', o: ['🍰 Cake', '🍨 Ice cream', '🥭 Mango sticky rice', '🙅 Skip dessert'] },
  { q: 'Ideal birthday?', o: ['🎉 Big party', '🍷 Dinner for two', '🎁 Quiet day', '✈️ A trip'] },
  { q: 'Which chore is the worst?', o: ['🍽️ Dishes', '🧺 Laundry', '🧹 Sweeping', '🛒 Groceries'] },
  { q: 'Go-to comfort food?', o: ['🍕 Pizza', '🍚 Rice and fried egg', '🍜 Instant noodles', '🍗 Fried chicken'] },
  { q: 'In the group chat…', o: ['💬 Replies instantly', '👀 Reads, never replies', '😂 Sends memes', '🔕 Muted it'] },
  { q: 'Favourite season?', o: ['☀️ Hot season', '🌧️ Rainy season', '🍃 Cool season', '🎊 Water Festival time'] },
  { q: 'Pick a drink at a party', o: ['🥤 Soda', '🍺 Beer', '🥥 Coconut', '💧 Just water'] },
  { q: 'A surprise $1,000 goes on…', o: ['📱 New gadget', '✈️ A trip', '🏦 Save it', '👟 Clothes and shoes'] },
  { q: 'Most used app?', o: ['💬 Telegram', '🎵 TikTok', '▶️ YouTube', '📸 Instagram'] },
  { q: 'Ordering food at a new place…', o: ['⚡ Instantly', '📖 Reads the whole menu', '🙋 Asks the waiter', '👉 Same as you'] },
  { q: 'Secretly most wants to win…', o: ['🚀 Drone Shooter', '⌨️ Typing Race', '🧠 Memory Match', '💡 Brain Race'] },
  { q: 'Dream job for one day?', o: ['🧑‍🍳 Chef', '🧑‍🚀 Astronaut', '🎬 Movie star', '🏝️ Island tour guide'] },
  { q: 'Best way to say thank you?', o: ['🎁 A small gift', '🍜 Buy them lunch', '💌 A kind message', '🤗 A hug'] },
  { q: 'Lost in a new city…', o: ['🗺️ Open the map', '🙋 Ask someone', '🚶 Keep walking', '📞 Call a friend'] },
  { q: 'Daily screen time…', o: ['📵 Very low', '📱 Normal', '😬 Do not ask', '🔋 Battery dies first'] },
  { q: 'Breakfast?', o: ['🍚 Bai sach chrouk', '🥐 Bread and coffee', '🍜 Noodle soup', '⏭️ Skip it'] },
  { q: 'Favourite way to travel around town?', o: ['🛺 Tuk tuk', '🛵 Motorbike', '🚗 Car', '🚶 Walk'] },
];

const shuffle = (rng, arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/** The party's 8 questions, picked from the secret so nobody can prepare. */
export function buildSync(secret) {
  const rng = createRng(`sync:${secret}`);
  return shuffle(rng, QUESTIONS).slice(0, ROUNDS).map(x => ({ q: x.q, o: [...x.o] }));
}

/** The two players, in join order. Round i is about pair[i % 2]. */
export const pairOf = p => Object.entries(p.players).sort((a, b) => a[1].joinedAt - b[1].joinedAt || (a[0] < b[0] ? -1 : 1)).map(([k]) => k).slice(0, 2);
export const subjectOf = (p, i) => pairOf(p)[i % 2];

export const pointsFor = (guessSeconds, streak) => {
  const pts = MATCH_POINTS + Math.round(SPEED_POINTS * Math.max(0, 1 - guessSeconds / ANSWER_SECONDS));
  return streak >= STREAK_FROM ? pts * 2 : pts;
};

const fresh = () => ({ picks: {}, matches: 0, streak: 0, best: 0, scored: {}, round: null });

/** Open round i now. */
function open(s, i, now) {
  s.round = { i, phase: 'question', opensAt: now, closesAt: now + ANSWER_SECONDS * 1000, revealUntil: 0 };
}

/** Called when the game starts. */
export function startSync(p, now) {
  p.sync = fresh();
  open(p.sync, 0, now);
}

/** A player picks option c in round i. One pick per round. */
export function pick(p, key, i, c, now) {
  const r = p.sync?.round;
  if (p.status !== 'running' || !r || !p.players[key] || !pairOf(p).includes(key)) return { kind: 'invalid' };
  if (r.phase !== 'question' || r.i !== i || now > r.closesAt || !Number.isInteger(c) || c < 0 || c > 3) return { kind: 'invalid' };
  const row = (p.sync.picks[i] ||= {});
  if (row[key]) return { kind: 'already' };
  row[key] = { c, s: Math.round((now - r.opensAt) / 100) / 10 };
  return { kind: 'locked', both: Object.keys(row).length >= 2 };
}

/**
 * Score round i once (idempotent). Both players get the team's points.
 * Returns what the reveal shows.
 */
export function settle(p, i) {
  p.sync ||= fresh();
  const s = p.sync;
  const [a, b] = pairOf(p);
  const subject = subjectOf(p, i), guesser = subject === a ? b : a;
  const row = s.picks[i] || {};
  const mine = row[subject], theirs = row[guesser];
  const match = !!(mine && theirs && mine.c === theirs.c);
  if (!s.scored[i]) {
    let pts = 0;
    if (match) { s.streak++; s.matches++; pts = pointsFor(theirs.s, s.streak); } else s.streak = 0;
    s.best = Math.max(s.best, s.streak);
    for (const k of [a, b]) {
      const pl = p.players[k];
      if (!pl) continue;
      pl.score += pts;
      if (match) pl.hits++;
    }
    s.scored[i] = { match, pts, streak: s.streak };
  }
  return {
    i, subject, guesser, match, pts: s.scored[i].pts, streak: s.scored[i].streak,
    subjectPick: mine ? mine.c : null, guesserPick: theirs ? theirs.c : null,
  };
}

/**
 * Move the game along. A round is revealed when both have picked or time runs
 * out; the next one opens after the reveal. Returns what happened:
 * { reveal } and/or { open: i }, or { done: true } after the last reveal.
 */
export function advance(p, now) {
  const s = p.sync, r = s?.round;
  if (!r || p.status !== 'running') return {};
  const out = {};
  if (r.phase === 'question') {
    const both = Object.keys(s.picks[r.i] || {}).length >= 2;
    if (both || now >= r.closesAt) {
      out.reveal = settle(p, r.i);
      r.phase = 'reveal'; r.revealUntil = now + REVEAL_SECONDS * 1000;
    }
  } else if (r.phase === 'reveal' && now >= r.revealUntil) {
    if (r.i + 1 >= ROUNDS) { r.phase = 'done'; out.done = true; }
    else { open(s, r.i + 1, now); out.open = r.i + 1; }
  }
  return out;
}

/** What both players see while a round is open (no picks). */
export function roundMsg(p, questions) {
  const r = p.sync.round;
  const subject = subjectOf(p, r.i);
  const row = p.sync.picks[r.i] || {};
  return {
    type: 'sync-round', i: r.i, n: ROUNDS, q: questions[r.i].q, o: questions[r.i].o,
    subject, subjectName: p.players[subject]?.name || '?', opensAt: r.opensAt, closesAt: r.closesAt, locked: Object.keys(row),
  };
}

export const syncSummary = p => ({ matches: p.sync?.matches || 0, percent: Math.round(((p.sync?.matches || 0) / ROUNDS) * 100), best: p.sync?.best || 0 });

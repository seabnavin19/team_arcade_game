// Live party rules, shared by the party server and the tests.
//  • Reaction Tap: everyone sees the same targets at the same moment; the
//    first valid tap on a target wins its points. Red fakes cost the tapper.
//  • Ship Battle: see battle.js; scores are KOs.

import { buildTimeline, scoreHit, FAKE_PENALTY, MISS_PENALTY, DURATION } from '../games/reaction.js';
import { QUIZ_SECONDS } from './quiz.js';
import { SYNC_SECONDS } from './sync.js';
import { DURATION as MARKET_SECONDS } from './market.js';

export const JOIN_SECONDS = 60;      // lobby length after /party
export const MIN_PLAYERS = 2;        // fewer than this → cancelled
export const LATE_JOIN_CUTOFF = 10;  // can't join in the last 10 seconds
export const PARTY_SECONDS = DURATION;

export const PARTY_GAMES = {
  reaction: { title: 'Reaction Tap', emoji: '⚡', seconds: DURATION, maxPlayers: 50,
    pitch: 'Everyone gets the same targets at the same moment. The fastest tap takes the points. Red ones are traps!' },
  quiz: { title: 'Brain Race', emoji: '💡', seconds: QUIZ_SECONDS, maxPlayers: 50,
    pitch: '8 quick IQ puzzles: number patterns, maths, time and logic. Everyone gets the same puzzle at the same moment. Right answers score more the faster you are, plus a bonus for the first correct answer. One try per puzzle!' },
  draw: { title: 'Draw & Guess', emoji: '🎨', seconds: 300, maxPlayers: 12,
    pitch: '3 rounds. Take turns drawing a secret word while everyone else guesses. Quick correct guesses score more, and the artist scores for every player who gets it.' },
  snake: { title: 'Snake Arena', emoji: '🐍', seconds: 90, maxPlayers: 8,
    pitch: "Everyone's snake in one arena. Eat food to grow (+1, golden +3). If another snake crashes into you, you get +5. Hit a wall or a snake and you respawn small. Most points wins." },
  battle: { title: 'Ship Battle', emoji: '🚀', seconds: 90, maxPlayers: 8,
    pitch: 'Everyone flies a ship in one arena. Your ship fires forward on its own, so steer to aim. 3 hits knock a ship out, and the most KOs wins.' },
  // Duo Mode: exactly 2 players on one team, sharing one score.
  sync: { title: 'In Sync', emoji: '💞', seconds: SYNC_SECONDS, maxPlayers: 2, duo: true,
    pitch: '8 questions about the two of you. Each round is about one player: they answer for themselves and their partner guesses. Matching answers score for the team, and 3 matches in a row doubles the points.' },
  market: { title: 'Night Market Duo', emoji: '🍜', seconds: MARKET_SECONDS, maxPlayers: 2, duo: true,
    pitch: 'Run a noodle stall together for 90 seconds. One of you cooks, the other serves customers before they lose patience. Roles swap at half time, and the tips are shared.' },
};
export const DUO_GAMES = Object.keys(PARTY_GAMES).filter(g => PARTY_GAMES[g].duo);
export const isDuo = p => !!PARTY_GAMES[p?.game]?.duo;
const CLOCK_SLACK = 0.4;             // seconds: tolerated clock difference
const LATENCY_SLACK = 1.2;           // seconds: tolerated network delay

// `seed` is shared with players (targets, arena layout). `secret` never leaves
// the server: it picks Brain Race puzzles and Draw & Guess words.
export function createParty({ id, chat, seed, secret = seed, now, joinSeconds = JOIN_SECONDS, game = 'reaction' }) {
  if (!PARTY_GAMES[game]) game = 'reaction';
  const startAt = now + joinSeconds * 1000;
  return {
    id, chat, game, seed: String(seed), secret: String(secret), status: 'lobby', createdAt: now, startAt, endAt: startAt + PARTY_GAMES[game].seconds * 1000,
    players: {}, claimed: {}, messageId: null,
  };
}

export const timelineFor = party => buildTimeline(`party:${party.seed}`);
export const isActive = p => !!p && (p.status === 'lobby' || p.status === 'running');

export function join(p, user, now) {
  if (!isActive(p)) return { ok: false, reason: 'This party is over. Send /party to start a new one.' };
  if (now > p.endAt - LATE_JOIN_CUTOFF * 1000) return { ok: false, reason: 'Too late to join this round.' };
  if (!p.players[user.key]) {
    if (Object.keys(p.players).length >= PARTY_GAMES[p.game || 'reaction'].maxPlayers) return { ok: false, reason: isDuo(p) ? 'This duo already has two players. Send /duo to start your own.' : 'This party is full. Catch the next one!' };
    p.players[user.key] = { name: user.name, score: 0, hits: 0, fakes: 0, misses: 0, kos: 0, downs: 0, joinedAt: now };
  }
  return { ok: true };
}

/** A player tapped target i, saying it had been visible for clientAge seconds. */
export function hit(p, timeline, userKey, i, clientAge, now) {
  const pl = p.players[userKey];
  if (p.status !== 'running' || !pl) return { kind: 'invalid' };
  const tg = timeline[i];
  if (!tg || typeof clientAge !== 'number' || !Number.isFinite(clientAge)) return { kind: 'invalid' };
  const serverAge = (now - p.startAt) / 1000 - tg.t;
  const plausible = clientAge >= 0 && clientAge <= tg.life + 0.05
    && serverAge + CLOCK_SLACK >= clientAge && serverAge <= tg.life + LATENCY_SLACK;
  if (!plausible) return { kind: 'invalid' };
  if (tg.fake) {
    pl.fakes++; pl.score = Math.max(0, pl.score - FAKE_PENALTY);
    return { kind: 'fake', points: -FAKE_PENALTY };
  }
  if (p.claimed[i]) return { kind: 'taken', by: p.claimed[i] };
  const points = scoreHit(clientAge, tg.life);
  p.claimed[i] = userKey; pl.hits++; pl.score += points;
  return { kind: 'hit', points };
}

export function miss(p, userKey) {
  const pl = p.players[userKey];
  if (p.status !== 'running' || !pl) return { kind: 'invalid' };
  pl.misses++; pl.score = Math.max(0, pl.score - MISS_PENALTY);
  return { kind: 'miss', points: -MISS_PENALTY };
}

export const START_NOW_SECONDS = 3; // countdown after someone taps "Start now"

/** A player in the lobby asks to start early. Needs enough players. */
export function startNow(p, userKey, now) {
  if (!p || p.status !== 'lobby') return { ok: false, reason: 'The party is not in the lobby.' };
  if (!p.players[userKey]) return { ok: false, reason: 'Join the party first.' };
  if (Object.keys(p.players).length < MIN_PLAYERS) return { ok: false, reason: `Needs at least ${MIN_PLAYERS} players.` };
  const startAt = now + START_NOW_SECONDS * 1000;
  if (startAt >= p.startAt) return { ok: false, reason: 'Already starting.' };
  const length = p.endAt - p.startAt;
  p.startAt = startAt;
  p.endAt = startAt + length;
  p.startedBy = p.players[userKey].name;
  return { ok: true };
}

/** Called when the lobby ends. */
export function start(p) {
  if (p.status !== 'lobby') return p.status;
  p.status = Object.keys(p.players).length >= MIN_PLAYERS ? 'running' : 'cancelled';
  return p.status;
}

export function finish(p) {
  if (p.status === 'running') p.status = 'done';
  return results(p);
}

export function results(p) {
  const rows = Object.entries(p.players).map(([key, v]) => ({ key, ...v }));
  rows.sort((a, b) => b.score - a.score || (a.downs || 0) - (b.downs || 0) || b.hits - a.hits || a.joinedAt - b.joinedAt);
  let place = 0;
  const same = (a, b) => a.score === b.score && (a.downs || 0) === (b.downs || 0);
  return rows.map((r, i) => { if (i === 0 || !same(r, rows[i - 1])) place = i + 1; return { ...r, place }; });
}

/** What clients are allowed to see. */
export const publicState = p => p && ({
  id: p.id, game: p.game || 'reaction', duo: isDuo(p), summary: p.summary || null, status: p.status, seed: p.seed, startAt: p.startAt, endAt: p.endAt, claimed: p.claimed, startedBy: p.startedBy || null,
  players: results(p).map(({ key, name, score, hits, fakes, kos, downs, place }) => ({ key, name, score, hits, fakes, kos, downs, place })),
});

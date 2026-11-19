// Reaction Tap Party: the rules, shared by the party server and the tests.
// Everyone sees the same targets at the same moment; the first valid tap on a
// target wins its points. Red fakes cost the player who taps them.

import { buildTimeline, scoreHit, FAKE_PENALTY, MISS_PENALTY, DURATION } from '../games/reaction.js';

export const JOIN_SECONDS = 60;      // lobby length after /party
export const MIN_PLAYERS = 2;        // fewer than this → cancelled
export const LATE_JOIN_CUTOFF = 10;  // can't join in the last 10 seconds
export const PARTY_SECONDS = DURATION;
const CLOCK_SLACK = 0.4;             // seconds: tolerated clock difference
const LATENCY_SLACK = 1.2;           // seconds: tolerated network delay

export function createParty({ id, chat, seed, now, joinSeconds = JOIN_SECONDS }) {
  const startAt = now + joinSeconds * 1000;
  return {
    id, chat, seed: String(seed), status: 'lobby', createdAt: now, startAt, endAt: startAt + PARTY_SECONDS * 1000,
    players: {}, claimed: {}, messageId: null,
  };
}

export const timelineFor = party => buildTimeline(`party:${party.seed}`);
export const isActive = p => !!p && (p.status === 'lobby' || p.status === 'running');

export function join(p, user, now) {
  if (!isActive(p)) return { ok: false, reason: 'This party is over. Send /party to start a new one.' };
  if (now > p.endAt - LATE_JOIN_CUTOFF * 1000) return { ok: false, reason: 'Too late to join this round.' };
  if (!p.players[user.key]) p.players[user.key] = { name: user.name, score: 0, hits: 0, fakes: 0, misses: 0, joinedAt: now };
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
  rows.sort((a, b) => b.score - a.score || b.hits - a.hits || a.joinedAt - b.joinedAt);
  let place = 0;
  return rows.map((r, i) => { if (i === 0 || r.score !== rows[i - 1].score) place = i + 1; return { ...r, place }; });
}

/** What clients are allowed to see. */
export const publicState = p => p && ({
  id: p.id, status: p.status, seed: p.seed, startAt: p.startAt, endAt: p.endAt, claimed: p.claimed,
  players: results(p).map(({ key, name, score, hits, fakes, place }) => ({ key, name, score, hits, fakes, place })),
});

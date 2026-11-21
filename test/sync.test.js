import { describe, it, expect } from 'vitest';
import { createParty, join, start } from '../src/party/rules.js';
import { buildSync, startSync, pick, advance, settle, pairOf, subjectOf, pointsFor, syncSummary, QUESTIONS, ROUNDS, ANSWER_SECONDS, REVEAL_SECONDS, MATCH_POINTS } from '../src/party/sync.js';

const T0 = Date.parse('2026-11-20T05:00:00Z');
function running() {
  const p = createParty({ id: 'x', chat: 1, seed: 's', secret: 'secret', now: T0, game: 'sync', joinSeconds: 0 });
  join(p, { key: 'a', name: 'Dara' }, T0);
  join(p, { key: 'b', name: 'Sophea' }, T0 + 1);
  start(p);
  startSync(p, T0);
  return p;
}

describe('In Sync', () => {
  it('every question has exactly 4 options, and a party gets 8 different ones', () => {
    for (const q of QUESTIONS) expect(q.o).toHaveLength(4);
    const qs = buildSync('abc');
    expect(qs).toHaveLength(ROUNDS);
    expect(new Set(qs.map(q => q.q)).size).toBe(ROUNDS);
    expect(buildSync('abc')).toEqual(qs);
  });

  it('is a duo: a third player cannot join', () => {
    const p = running();
    expect(join(p, { key: 'c', name: 'Vanna' }, T0).ok).toBe(false);
    expect(pairOf(p)).toEqual(['a', 'b']);
  });

  it('alternates who the round is about', () => {
    const p = running();
    expect([0, 1, 2, 3].map(i => subjectOf(p, i))).toEqual(['a', 'b', 'a', 'b']);
  });

  it('a match scores the same points for both players; one pick per round', () => {
    const p = running();
    expect(pick(p, 'a', 0, 2, T0 + 1000).kind).toBe('locked');
    expect(pick(p, 'a', 0, 1, T0 + 1500).kind).toBe('already');
    expect(pick(p, 'b', 0, 2, T0 + 2000)).toEqual({ kind: 'locked', both: true });
    const out = advance(p, T0 + 2000); // both in → reveal right away
    expect(out.reveal).toMatchObject({ match: true, subject: 'a', guesser: 'b', subjectPick: 2, guesserPick: 2 });
    expect(out.reveal.pts).toBe(pointsFor(2, 1));
    expect(p.players.a.score).toBe(out.reveal.pts);
    expect(p.players.b.score).toBe(out.reveal.pts);
    settle(p, 0); // idempotent
    expect(p.players.a.score).toBe(out.reveal.pts);
  });

  it('rejects picks for the wrong round, after time, or out of range', () => {
    const p = running();
    expect(pick(p, 'a', 1, 0, T0).kind).toBe('invalid');
    expect(pick(p, 'a', 0, 4, T0).kind).toBe('invalid');
    expect(pick(p, 'a', 0, 0, T0 + (ANSWER_SECONDS + 1) * 1000).kind).toBe('invalid');
  });

  it('a round with a missing pick is no match, then the next round opens after the reveal', () => {
    const p = running();
    pick(p, 'a', 0, 1, T0);
    expect(advance(p, T0 + 5000)).toEqual({});
    const r = advance(p, T0 + ANSWER_SECONDS * 1000);
    expect(r.reveal).toMatchObject({ match: false, guesserPick: null });
    expect(advance(p, T0 + (ANSWER_SECONDS + REVEAL_SECONDS) * 1000)).toEqual({ open: 1 });
    expect(p.sync.round).toMatchObject({ i: 1, phase: 'question' });
  });

  it('three matches in a row double the points; a full game ends with a summary', () => {
    const p = running();
    let now = T0;
    const got = [];
    for (let i = 0; i < ROUNDS; i++) {
      const c = i === 4 ? 1 : 0;
      pick(p, 'a', i, 0, now); pick(p, 'b', i, c, now);
      got.push(advance(p, now).reveal);
      now += REVEAL_SECONDS * 1000;
      const next = advance(p, now);
      if (i === ROUNDS - 1) expect(next).toEqual({ done: true });
      else expect(next.open).toBe(i + 1);
    }
    expect(got[1].pts).toBe(pointsFor(0, 2));
    expect(got[2].pts).toBe(2 * pointsFor(0, 1));
    expect(got[4]).toMatchObject({ match: false, pts: 0 });
    expect(got[5].streak).toBe(1);
    expect(syncSummary(p)).toEqual({ matches: 7, percent: 88, best: 4 });
    expect(pointsFor(0, 1)).toBe(MATCH_POINTS + 100);
  });
});

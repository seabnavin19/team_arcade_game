import { describe, it, expect } from 'vitest';
import { createParty, join, hit, miss, start, finish, timelineFor, publicState, MIN_PLAYERS } from '../src/party/rules.js';

const T0 = 1_000_000;
const A = { key: 'a', name: 'Dara' }, B = { key: 'b', name: 'Sokha' };
function running() {
  const p = createParty({ id: 'p1', chat: -1, seed: 'xyz', now: T0 });
  join(p, A, T0); join(p, B, T0 + 1000);
  expect(start(p)).toBe('running');
  return { p, tl: timelineFor(p) };
}
const at = (p, tg, extra) => p.startAt + (tg.t + extra) * 1000;

describe('party rules', () => {
  it('one player can start (bots fill the rest); nobody means cancelled', () => {
    const p = createParty({ id: 'p', chat: -1, seed: 's', now: T0 });
    expect(MIN_PLAYERS).toBe(1);
    expect(start({ ...p, players: {} })).toBe('cancelled');
    join(p, A, T0);
    expect(start(p)).toBe('running');
  });
  it('everyone gets the same targets for a party, different per party', () => {
    const a = createParty({ id: 'x', chat: 1, seed: 'one', now: 0 }), b = createParty({ id: 'y', chat: 1, seed: 'two', now: 0 });
    expect(timelineFor(a)).toEqual(timelineFor({ ...a }));
    expect(timelineFor(a)).not.toEqual(timelineFor(b));
  });
  it('first tap wins the target; the second is "taken"', () => {
    const { p, tl } = running();
    const i = tl.findIndex(t => !t.fake);
    expect(hit(p, tl, 'a', i, 0.3, at(p, tl[i], 0.45))).toMatchObject({ kind: 'hit', points: expect.any(Number) });
    expect(hit(p, tl, 'b', i, 0.2, at(p, tl[i], 0.5))).toEqual({ kind: 'taken', by: 'a' });
    expect(p.players.a.hits).toBe(1); expect(p.players.b.hits).toBe(0);
  });
  it('fakes cost the tapper only and stay for others', () => {
    const { p, tl } = running();
    const r = tl.findIndex(t => !t.fake), f = tl.findIndex(t => t.fake);
    hit(p, tl, 'a', r, 0.1, at(p, tl[r], 0.2));
    const before = p.players.a.score;
    expect(hit(p, tl, 'a', f, 0.2, at(p, tl[f], 0.3)).kind).toBe('fake');
    expect(p.players.a.score).toBe(Math.max(0, before - 150));
    expect(hit(p, tl, 'b', f, 0.2, at(p, tl[f], 0.3)).kind).toBe('fake');
  });
  it('rejects taps that do not fit the clock', () => {
    const { p, tl } = running();
    const i = tl.findIndex(t => !t.fake);
    expect(hit(p, tl, 'a', i, 0.3, at(p, tl[i], -1)).kind).toBe('invalid');   // before it appeared
    expect(hit(p, tl, 'a', i, 0.3, at(p, tl[i], tl[i].life + 3)).kind).toBe('invalid'); // long gone
    expect(hit(p, tl, 'a', i, -1, at(p, tl[i], 0.3)).kind).toBe('invalid');
    expect(hit(p, tl, 'a', 9999, 0.1, at(p, tl[i], 0.3)).kind).toBe('invalid');
    expect(hit(p, tl, 'zz', i, 0.1, at(p, tl[i], 0.3)).kind).toBe('invalid'); // not in the party
  });
  it('a laggy tap still counts with the player\'s own reaction time', () => {
    const { p, tl } = running();
    const i = tl.findIndex(t => !t.fake);
    expect(hit(p, tl, 'b', i, 0.25, at(p, tl[i], 0.25 + 0.9)).kind).toBe('hit');
  });
  it('misses cost a little, never below zero; results rank by score', () => {
    const { p, tl } = running();
    expect(miss(p, 'a').kind).toBe('miss');
    expect(p.players.a.score).toBe(0);
    const i = tl.findIndex(t => !t.fake);
    hit(p, tl, 'b', i, 0.1, at(p, tl[i], 0.2));
    const res = finish(p);
    expect(p.status).toBe('done');
    expect(res.map(r => [r.key, r.place])).toEqual([['b', 1], ['a', 2]]);
    expect(publicState(p).players[0].name).toBe('Sokha');
  });
  it('late join cut-off and no joining a finished party', () => {
    const p = createParty({ id: 'p', chat: -1, seed: 's', now: T0 });
    expect(join(p, A, p.endAt - 5000).ok).toBe(false);
    expect(join(p, A, p.startAt + 5000).ok).toBe(true);
    p.status = 'done';
    expect(join(p, B, p.startAt).ok).toBe(false);
  });
});

import { startNow } from '../src/party/rules.js';
describe('start now', () => {
  const T = 5_000_000;
  it('starts in 3 seconds, keeping the round length (a duo still needs both)', () => {
    const duo = createParty({ id: 'd', chat: -1, seed: 's', now: T, game: 'sync' });
    join(duo, A, T);
    expect(startNow(duo, 'a', T + 5000)).toMatchObject({ ok: false, reason: expect.stringMatching(/at least 2/) });
    const p = createParty({ id: 'p', chat: -1, seed: 's', now: T, game: 'battle' });
    join(p, A, T);
    join(p, B, T + 6000);
    const length = p.endAt - p.startAt;
    expect(startNow(p, 'b', T + 7000).ok).toBe(true);
    expect(p.startAt).toBe(T + 10000);
    expect(p.endAt - p.startAt).toBe(length);
    expect(publicState(p).startedBy).toBe('Sokha');
    expect(startNow(p, 'a', T + 7500).ok).toBe(false); // already starting
  });
  it('only players in the lobby can start it', () => {
    const p = createParty({ id: 'p', chat: -1, seed: 's', now: T });
    join(p, A, T); join(p, B, T);
    expect(startNow(p, 'stranger', T).ok).toBe(false);
    p.status = 'running';
    expect(startNow(p, 'a', T).ok).toBe(false);
  });
});

describe('party secrets', () => {
  it('the server-only secret is never in what players see', () => {
    const p = createParty({ id: 'p', chat: -1, seed: 'public-seed', secret: 'server-secret', now: 0 });
    expect(p.secret).toBe('server-secret');
    expect(JSON.stringify(publicState(p))).not.toMatch(/server-secret/);
    expect(publicState(p).seed).toBe('public-seed');
  });
});

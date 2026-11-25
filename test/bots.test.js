import { describe, it, expect } from 'vitest';
import { createParty, join, start } from '../src/party/rules.js';
import { fillWithBots, botKeys, isBot, battleBotInput, snakeBotDir, reactionBotTap, quizBotAnswer, boatBotTap, drawBotGuess, fireworkBotArt, PARTY_SIZE } from '../src/party/bots.js';
import { createBattle, addShip, setInput, step as stepBattle } from '../src/party/battle.js';
import { createSnakeGame, addSnake, setDir, step as stepSnake } from '../src/party/snake.js';
import { buildTimeline } from '../src/games/reaction.js';
import { cleanArt } from '../src/party/firework.js';
import { setupDraw } from '../src/party/draw.js';

const party = (game, people) => {
  const p = createParty({ id: 'p', chat: 1, seed: 'seed-1', now: 0, game });
  people.forEach((n, i) => join(p, { key: `tg-${i}`, name: n }, i));
  start(p);
  return p;
};

describe('bots fill party seats', () => {
  it('tops a party up to 4 players, never more, and leaves Duo games alone', () => {
    const solo = party('battle', ['Dara']);
    expect(fillWithBots(solo)).toBe(3);
    expect(Object.keys(solo.players)).toHaveLength(PARTY_SIZE);
    expect(botKeys(solo).every(k => solo.players[k].bot && solo.players[k].name.startsWith('🤖 '))).toBe(true);
    expect(new Set(Object.values(solo.players).map(p => p.name)).size).toBe(4); // different names
    const full = party('snake', ['A', 'B', 'C', 'D', 'E']);
    expect(fillWithBots(full)).toBe(0);
    const duo = party('sync', ['A', 'B']);
    expect(fillWithBots(duo)).toBe(0);
    expect(isBot('tg-1')).toBe(false);
  });
  it('bots never draw in Draw & Guess: a lone player draws, bots guess', () => {
    const p = party('draw', ['Dara']);
    fillWithBots(p);
    setupDraw(p, 0);
    expect(p.draw.order).toEqual(['tg-0', 'tg-0', 'tg-0']);
  });
});

describe('bots play well enough (but can be beaten)', () => {
  it('Ship Battle: bots hunt down a ship that just sits there', () => {
    const b = createBattle('s1');
    addShip(b, 'tg-0', 'Dara');
    for (const k of ['bot-1', 'bot-2', 'bot-3']) addShip(b, k, k);
    const p = { players: { 'tg-0': {}, 'bot-1': {}, 'bot-2': {}, 'bot-3': {} } };
    for (let t = 0; t < 60; t += 0.05) {
      for (const k of botKeys(p)) setInput(b, k, ...battleBotInput(b, k, t));
      stepBattle(b, 0.05);
    }
    expect(b.ships['tg-0'].downs).toBeGreaterThan(2);
    expect(botKeys(p).reduce((n, k) => n + b.ships[k].kos, 0)).toBeGreaterThan(3);
  });
  it('Snake Arena: bot snakes eat and rarely crash', () => {
    const g = createSnakeGame('s2');
    const keys = ['bot-1', 'bot-2', 'bot-3', 'bot-4'];
    keys.forEach(k => addSnake(g, k, k));
    for (let i = 0; i < 90 * 8; i++) { for (const k of keys) { const d = snakeBotDir(g, k); if (d) setDir(g, k, d); } stepSnake(g); }
    const food = keys.reduce((n, k) => n + g.snakes[k].food, 0), downs = keys.reduce((n, k) => n + g.snakes[k].downs, 0);
    expect(food).toBeGreaterThan(40);
    expect(downs).toBeLessThan(food / 3);
  });
  it('Reaction Tap: bots tap most real targets in a human time, and rarely fakes', () => {
    const tl = buildTimeline('party:x');
    const taps = tl.map((tg, i) => reactionBotTap('x', 'bot-1', i, tg));
    const real = tl.filter(t => !t.fake).length, fakes = tl.filter(t => t.fake).length;
    const realTaps = taps.filter((a, i) => a !== null && !tl[i].fake), fakeTaps = taps.filter((a, i) => a !== null && tl[i].fake);
    expect(realTaps.length / real).toBeGreaterThan(0.6);
    expect(fakeTaps.length).toBeLessThanOrEqual(Math.ceil(fakes * 0.25));
    expect(Math.min(...realTaps)).toBeGreaterThanOrEqual(0.42); // a quick human beats them
  });
  it('Brain Race: bots get roughly 6 in 10 right, a few seconds in', () => {
    let right = 0, n = 0;
    for (let i = 0; i < 200; i++) { const a = quizBotAnswer('x', `bot-${i % 3}`, i, i % 4); if (a) { n++; if (a.c === i % 4) right++; expect(a.at).toBeGreaterThan(2); expect(a.at).toBeLessThan(9); } }
    expect(right / n).toBeGreaterThan(0.45); expect(right / n).toBeLessThan(0.75);
  });
  it('Boat Race: bots paddle near the beat, missing now and then', () => {
    const offs = Array.from({ length: 200 }, (_, i) => boatBotTap('x', 'bot-1', 10000 + i * 800)).map((t, i) => (t === null ? null : t - (10000 + i * 800)));
    const hits = offs.filter(o => o !== null);
    expect(hits.length).toBeGreaterThan(160); expect(hits.length).toBeLessThan(200);
    expect(Math.max(...hits.map(Math.abs))).toBeLessThanOrEqual(170);
  });
  it('Draw & Guess: bots guess some drawings, not all, and not instantly', () => {
    const g = Array.from({ length: 60 }, (_, i) => drawBotGuess('x', `bot-${i % 3}`, i));
    const got = g.filter(x => x !== null);
    expect(got.length).toBeGreaterThan(25); expect(got.length).toBeLessThan(55);
    expect(Math.min(...got)).toBeGreaterThanOrEqual(9);
  });
  it('Firework Show: bot drawings are valid fireworks', () => {
    for (let i = 0; i < 20; i++) {
      const art = fireworkBotArt(`seed-${i}`, 'bot-1');
      expect(cleanArt(art).length).toBe(art.length);
      expect(art.length).toBeGreaterThan(0);
    }
  });
});

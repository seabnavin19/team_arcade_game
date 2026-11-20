import { describe, it, expect } from 'vitest';
import { WORDS, normalize, checkGuess, maskWord, pickWords, hintIndex, guessPoints, setupDraw, beginRound, guess, guessersLeft, ROUNDS, ROUND_SECONDS, ARTIST_POINTS } from '../src/party/draw.js';
import { createParty, join, start } from '../src/party/rules.js';

describe('draw & guess rules', () => {
  it('word list is clean: lowercase, unique, letters and spaces only', () => {
    expect(new Set(WORDS).size).toBe(WORDS.length);
    expect(WORDS.length).toBeGreaterThanOrEqual(150);
    expect(WORDS.every(w => /^[a-z]+( [a-z]+)*$/.test(w))).toBe(true);
  });
  it('guess checking is forgiving about case, spaces and punctuation; catches near misses', () => {
    expect(checkGuess('ice cream', 'Ice Cream!')).toBe('right');
    expect(checkGuess('ice cream', 'icecream')).toBe('right');
    expect(checkGuess('elephant', 'elefant')).toBe('close');
    expect(checkGuess('elephant', 'elephants')).toBe('close');
    expect(checkGuess('mango', 'mangi')).toBe('close');
    expect(checkGuess('mango', 'mingi')).toBe('wrong');
    expect(checkGuess('cat', 'car')).toBe('wrong'); // short words: no "close"
    expect(checkGuess('cat', '')).toBe('wrong');
    expect(normalize('  Tuk-Tuk ')).toBe('tuk tuk');
  });
  it('masks the word and shows hint letters', () => {
    expect(maskWord('ice cream')).toBe('_ _ _   _ _ _ _ _');
    expect(maskWord('cat', [1])).toBe('_ A _');
    const i = hintIndex('s', 0, 'tuk tuk');
    expect('tuk tuk'[i]).not.toBe(' ');
  });
  it('picks different words per round, same for the same party', () => {
    const w = pickWords('seed', 5);
    expect(new Set(w).size).toBe(5);
    expect(pickWords('seed', 5)).toEqual(w);
  });
  it('rounds, turn order and points', () => {
    const p = createParty({ id: 'd', chat: -1, seed: 'x', now: 0, game: 'draw', joinSeconds: 0 });
    ['a', 'b', 'c'].forEach((k, i) => join(p, { key: k, name: k.toUpperCase() }, i));
    start(p); setupDraw(p, 1000);
    expect([...p.draw.order].sort()).toEqual(['a', 'b', 'c']); // 3 players → each draws once, random order
    beginRound(p, 1000);
    const [artist, g1, g2] = [p.draw.order[0], ...['a', 'b', 'c'].filter(k => k !== p.draw.order[0])];
    const word = p.draw.words[0];
    expect(guess(p, artist, word, 2000).kind).toBe('ignored');        // the artist can't guess
    expect(guess(p, g1, 'zzz', 2000).kind).toBe('wrong');
    const r = guess(p, g1, word, 1000 + 10000);
    expect(r).toMatchObject({ kind: 'right', first: true, pts: guessPoints(ROUND_SECONDS - 10, true) });
    expect(guess(p, g1, word, 12000).kind).toBe('ignored');          // only once
    expect(guessersLeft(p)).toBe(1);
    guess(p, g2, word, 30000);
    expect(guessersLeft(p)).toBe(0);
    expect(p.players[artist].score).toBe(2 * ARTIST_POINTS);
    expect(p.players[g1].hits).toBe(1);
  });
  it('always 3 rounds: 2 players take turns A, B, A; 8 players → 3 different artists', () => {
    expect(ROUNDS).toBe(3);
    const two = createParty({ id: 'd', chat: -1, seed: 'x', now: 0, game: 'draw', joinSeconds: 0 });
    join(two, { key: 'a', name: 'A' }, 0); join(two, { key: 'b', name: 'B' }, 1);
    start(two); setupDraw(two, 0);
    expect(two.draw.order).toHaveLength(3);
    expect(two.draw.order[0]).toBe(two.draw.order[2]);
    expect(two.draw.order[0]).not.toBe(two.draw.order[1]);
    expect(new Set(two.draw.words).size).toBe(3);
    const eight = createParty({ id: 'd', chat: -1, seed: 'y', now: 0, game: 'draw', joinSeconds: 0 });
    for (let i = 0; i < 8; i++) join(eight, { key: `p${i}`, name: `P${i}` }, i);
    start(eight); setupDraw(eight, 0);
    expect(new Set(eight.draw.order).size).toBe(3);
    expect(eight.endAt).toBeGreaterThan(3 * ROUND_SECONDS * 1000);
    expect(eight.endAt).toBeLessThan(4 * ROUND_SECONDS * 1000);
  });
});

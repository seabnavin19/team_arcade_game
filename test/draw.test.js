import { describe, it, expect } from 'vitest';
import { WORDS, normalize, checkGuess, maskWord, pickWords, hintIndex, guessPoints, setupDraw, beginRound, guess, guessersLeft, MAX_ROUNDS, ROUND_SECONDS, ARTIST_POINTS } from '../src/party/draw.js';
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
    expect(p.draw.order).toEqual(['a', 'b', 'c']);
    beginRound(p, 1000);
    const word = p.draw.words[0];
    expect(guess(p, 'a', word, 2000).kind).toBe('ignored');           // the artist can't guess
    expect(guess(p, 'b', 'zzz', 2000).kind).toBe('wrong');
    const r = guess(p, 'b', word, 1000 + 10000);
    expect(r).toMatchObject({ kind: 'right', first: true, pts: guessPoints(ROUND_SECONDS - 10, true) });
    expect(guess(p, 'b', word, 12000).kind).toBe('ignored');          // only once
    expect(guessersLeft(p)).toBe(1);
    guess(p, 'c', word, 30000);
    expect(guessersLeft(p)).toBe(0);
    expect(p.players.a.score).toBe(2 * ARTIST_POINTS);
    expect(p.players.b.hits).toBe(1);
  });
  it('caps the number of rounds and sizes the party length to fit', () => {
    const p = createParty({ id: 'd', chat: -1, seed: 'x', now: 0, game: 'draw', joinSeconds: 0 });
    for (let i = 0; i < 8; i++) join(p, { key: `p${i}`, name: `P${i}` }, i);
    start(p); setupDraw(p, 0);
    expect(p.draw.order).toHaveLength(MAX_ROUNDS);
    expect(p.endAt).toBeGreaterThan(MAX_ROUNDS * ROUND_SECONDS * 1000);
  });
});

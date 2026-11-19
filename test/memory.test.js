import { describe, it, expect } from 'vitest';
import { buildLayout, createMemoryState, flip, tick, memoryScore, cardAt, cardRect } from '../src/games/memory.js';

describe('memory match', () => {
  it('layout: 8 pairs, same for the same day, different next day', () => {
    const d = buildLayout('2026-11-18');
    expect(d).toHaveLength(16);
    expect([...d].sort()).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7]);
    expect(buildLayout('2026-11-18')).toEqual(d);
    expect(buildLayout('2026-11-19')).not.toEqual(d);
  });
  it('score adds 2s per move beyond 8', () => {
    expect(memoryScore(30, 8)).toBe(30);
    expect(memoryScore(30.04, 12)).toBe(38);
  });
  it('a perfect game ends after 8 moves', () => {
    const s = createMemoryState('2026-11-18');
    for (let p = 0; p < 8; p++) {
      const [a, b] = s.deck.map((v, i) => [v, i]).filter(([v]) => v === p).map(([, i]) => i);
      flip(s, a); expect(flip(s, b).kind).toBe('match');
    }
    expect(s.over).toBe(true); expect(s.moves).toBe(8);
  });
  it('mismatch closes after a moment, or immediately on the next click', () => {
    const s = createMemoryState('2026-11-18');
    const a = 0, b = s.deck.findIndex((v, i) => i > 0 && v !== s.deck[0]);
    flip(s, a); expect(flip(s, b).kind).toBe('mismatch');
    tick(s, 0.5); expect(s.open).toHaveLength(2);
    tick(s, 0.3); expect(s.open).toHaveLength(0);
    flip(s, a); flip(s, b); flip(s, 5); expect(s.open).toEqual([5]);
    expect(flip(s, 5).kind).toBe('none'); // same card twice doesn't count
  });
  it('maps clicks to cards', () => {
    const r = cardRect(6);
    expect(cardAt(r.x + 5, r.y + 5)).toBe(6);
    expect(cardAt(2, 2)).toBe(-1);
  });
});

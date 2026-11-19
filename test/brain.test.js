import { describe, it, expect } from 'vitest';
import { createBrainState, choose, tick, optionAt } from '../src/games/brain.js';
import brain from '../src/games/brain.js';

describe('brain race (solo)', () => {
  it('same puzzles for everyone on a day; different the next day', () => {
    expect(createBrainState('2026-11-19').quiz).toEqual(createBrainState('2026-11-19').quiz);
    expect(createBrainState('2026-11-19').quiz).not.toEqual(createBrainState('2026-11-20').quiz);
  });
  it('fast right answers score more; wrong and timeouts score 0; ends after 8', () => {
    const s = createBrainState('2026-11-19');
    tick(s, 1); expect(choose(s, s.quiz[0].correct)).toEqual({ ok: true, pts: 950 });
    expect(choose(s, 0)).toBeNull(); // one try
    tick(s, 1.4); expect(s.i).toBe(1);
    expect(choose(s, (s.quiz[1].correct + 1) % 4)).toEqual({ ok: false, pts: 0 });
    tick(s, 1.4);
    expect(tick(s, 10)).toBe('timeout');
    let ev; for (let i = 0; i < 100 && ev !== 'done'; i++) ev = tick(s, 1);
    expect(ev).toBe('done'); expect(s.over).toBe(true);
    expect(s.score).toBe(950); expect(s.right).toBe(1);
  });
  it('maps clicks to answer boxes; checks plausibility', () => {
    expect(optionAt(100, 300)).toBe(0); expect(optionAt(700, 400)).toBe(3); expect(optionAt(10, 10)).toBe(-1);
    expect(brain.plausible(7800, 20).ok).toBe(true);
    expect(brain.plausible(9000, 20).ok).toBe(false);
  });
});

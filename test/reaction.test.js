import { describe, it, expect } from 'vitest';
import { buildTimeline, createReactionState, handleClick, scoreHit, resultMeta, DURATION } from '../src/games/reaction.js';

describe('reaction tap', () => {
  it('same day, same targets; different day, different targets', () => {
    expect(buildTimeline('2026-11-18')).toEqual(buildTimeline('2026-11-18'));
    expect(buildTimeline('2026-11-18')).not.toEqual(buildTimeline('2026-11-19'));
  });
  it('timeline is sensible', () => {
    const tl = buildTimeline('2026-11-18');
    expect(tl.length).toBeGreaterThan(40);
    expect(tl.length).toBeLessThan(70);
    expect(tl.every(t => t.t < DURATION && t.x > 0 && t.x < 800 && t.y > 56 && t.y < 480)).toBe(true);
    expect(tl.filter(t => t.fake).length).toBeGreaterThan(3);
    expect(tl.filter(t => t.t < 3).some(t => t.fake)).toBe(false);
  });
  it('faster hits score more', () => {
    expect(scoreHit(0, 1)).toBe(300);
    expect(scoreHit(0.5, 1)).toBe(175);
    expect(scoreHit(1, 1)).toBe(50);
  });
  it('scores hits, fakes and misses; score never negative', () => {
    const s = createReactionState('2026-11-18');
    expect(handleClick(s, 5, 470).kind).toBe('miss');
    expect(s.score).toBe(0);
    const real = s.timeline.findIndex(t => !t.fake);
    s.time = s.timeline[real].t + 0.1;
    const r = handleClick(s, s.timeline[real].x, s.timeline[real].y);
    expect(r.kind).toBe('hit');
    expect(handleClick(s, s.timeline[real].x, s.timeline[real].y).kind).not.toBe('hit'); // can't hit twice
    const fake = s.timeline.findIndex(t => t.fake);
    s.time = s.timeline[fake].t + 0.05;
    const before = s.score;
    expect(handleClick(s, s.timeline[fake].x, s.timeline[fake].y).kind).toBe('fake');
    expect(s.score).toBe(Math.max(0, before - 150));
    expect(resultMeta(s).hits).toBe(1);
    expect(resultMeta(s).avgMs).toBe(100);
  });
  it('a perfect player stays under the plausibility cap', () => {
    const tl = buildTimeline('2026-11-18');
    expect(tl.filter(t => !t.fake).length * 300).toBeLessThan(25000);
  });
});

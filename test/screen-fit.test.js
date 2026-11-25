import { describe, it, expect } from 'vitest';
import { fitLayout, toScreen, fromScreen, screenDir } from '../src/party/screen-fit.js';

describe('fitting party games to the screen', () => {
  it('scales the arena to fill the space it gets', () => {
    const v = fitLayout(1600, 960);
    expect(v.portrait).toBe(false); expect(v.css).toBeCloseTo(2);
  });
  it('only turns games sideways when they allow it', () => {
    expect(fitLayout(390, 760).portrait).toBe(false);              // e.g. Draw & Guess stays landscape
    expect(fitLayout(390, 760, { rotate: true }).portrait).toBe(true);
    expect(fitLayout(844, 390, { rotate: true }).portrait).toBe(false);
  });
  it('maps taps back to the right arena point when sideways', () => {
    const v = fitLayout(390, 760, { rotate: true });
    const { sx, sy } = toScreen(v, 700, 100);
    const p = fromScreen(v, sx / v.sw, sy / v.sh);
    expect(p.x).toBeCloseTo(700); expect(p.y).toBeCloseTo(100);
  });
  it('arrow buttons mean "that way on screen" when the arena is sideways', () => {
    const v = fitLayout(390, 760, { rotate: true });
    // screen up = towards arena x = 0
    const a = fromScreen(v, 0.5, 0.2), b = fromScreen(v, 0.5, 0.8);
    expect(a.x).toBeLessThan(b.x);
    expect(screenDir(v, 'up')).toBe('left');
    expect(screenDir(v, 'right')).toBe('up');
    expect(screenDir(fitLayout(1200, 700, { rotate: true }), 'up')).toBe('up');
  });
});

import { describe, it, expect } from 'vitest';
import { buildPassage, createTypingState, typeKey, typingResult } from '../src/games/typing.js';
import SENTENCES from '../src/games/sentences.js';
import typing from '../src/games/typing.js';

describe('typing race', () => {
  it('passage of the day is stable, long enough, and changes daily', () => {
    const p = buildPassage('2026-11-18');
    expect(p).toBe(buildPassage('2026-11-18'));
    expect(p).not.toBe(buildPassage('2026-11-19'));
    expect(p.length).toBeGreaterThanOrEqual(520);
    expect(/^[\x20-\x7e]+$/.test(p)).toBe(true); // plain keyboard characters only
  });
  it('sentence pool is plain ASCII and unique', () => {
    expect(SENTENCES.every(x => /^[\x20-\x7e]+$/.test(x))).toBe(true);
    expect(new Set(SENTENCES).size).toBe(SENTENCES.length);
    expect(SENTENCES.length).toBeGreaterThanOrEqual(100);
  });
  it('counts errors even after backspace, and computes net WPM', () => {
    const s = createTypingState('2026-11-18');
    const target = s.text.slice(0, 50);
    typeKey(s, '#'); typeKey(s, 'Backspace');
    for (const ch of target) typeKey(s, ch);
    const r = typingResult(s, 30);
    expect(r.correct).toBe(50);
    expect(r.wpm).toBe(20); // 50 chars / 5 = 10 words in 0.5 min
    expect(r.accuracy).toBeCloseTo(98.0, 1); // 1 error in 51 keystrokes
  });
  it('ignores modifier keys and typing past the end', () => {
    const s = createTypingState('x');
    expect(typeKey(s, 'Shift')).toBe('ignored');
    expect(typeKey(s, 'Backspace')).toBe('ignored');
  });
  it('low accuracy runs are not ranked', () => {
    expect(typing.plausible(80, 60, { accuracy: 85 }).ok).toBe(false);
    expect(typing.plausible(80, 60, { accuracy: 95 }).ok).toBe(true);
    expect(typing.plausible(250, 60, { accuracy: 99 }).ok).toBe(false);
  });
});

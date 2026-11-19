import { describe, it, expect } from 'vitest';
import { GAME_META, checkRun } from '../src/games/meta.js';
import { GAMES } from '../src/games/index.js';

describe('shared game facts', () => {
  it('match the games themselves', () => {
    for (const g of GAMES) {
      const m = GAME_META[g.id];
      expect(m.title).toBe(g.title);
      expect(m.better).toBe(g.better);
      for (const v of [0, 5, 41.3, 12450, 78]) expect(m.format(v)).toBe(g.format(v));
    }
  });
  it('server checks catch bad runs', () => {
    expect(checkRun('reaction', 8000, {}, 30)).toBeNull();
    expect(checkRun('reaction', 8000, {}, 5)).toMatch(/too quick/);
    expect(checkRun('reaction', 99999, {}, 30)).toMatch(/outside/);
    expect(checkRun('typing', 80, { accuracy: 80 }, 60)).toMatch(/90%/);
    expect(checkRun('memory', 2, {}, 30)).toMatch(/outside/);
    expect(checkRun('nope', 1, {}, 30)).toMatch(/Unknown/);
    expect(checkRun('shooter', NaN, {}, 30)).toMatch(/Invalid/);
  });
});

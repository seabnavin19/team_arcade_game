import { describe, it, expect } from 'vitest';
import { buildWaves, createShooter, step, dropFor, multiplierFor, WAVES, BOSS_BONUS } from '../src/games/shooter-engine.js';

// A simple bot: stays low, follows the lowest enemy (or the boss), and sidesteps nearby bullets.
function bot(s) {
  const p = s.player;
  const danger = s.enemyBullets.find(b => b.y < p.y && p.y - b.y < 90 && Math.abs(b.x - p.x) < 30);
  if (danger) return { pointer: { x: p.x + (danger.x < p.x ? 70 : -70), y: 440 } };
  const t = [...s.enemies].sort((a, b) => b.y - a.y)[0] || s.boss;
  return { pointer: { x: t ? t.x : 400, y: 440 } };
}

function run(seed, controller, maxSeconds = 300) {
  const s = createShooter(seed);
  let n = 0;
  while (!s.over && n < maxSeconds * 60) { step(s, 1 / 60, controller(s)); s.events.length = 0; n++; }
  return s;
}

describe('drone shooter', () => {
  it('waves are the same for the same day and differ the next', () => {
    expect(buildWaves('2026-11-18')).toEqual(buildWaves('2026-11-18'));
    expect(buildWaves('2026-11-18')).not.toEqual(buildWaves('2026-11-19'));
    expect(buildWaves('2026-11-18')).toHaveLength(WAVES);
  });
  it('drops depend only on the day and the drone, not on play order', () => {
    expect(dropFor('2026-11-18', 7)).toBe(dropFor('2026-11-18', 7));
    const drops = Array.from({ length: 400 }, (_, i) => dropFor('2026-11-18', i)).filter(Boolean);
    expect(drops.length).toBeGreaterThan(20); expect(drops.length).toBeLessThan(80);
  });
  it('combo multiplier steps up and caps at x5', () => {
    expect([1, 2, 3, 6, 9, 12, 30].map(multiplierFor)).toEqual([1, 1, 2, 3, 4, 5, 5]);
  });
  it('the same inputs give the same score (replayable)', () => {
    const a = run('2026-11-18', bot), b = run('2026-11-18', bot);
    expect(a.score).toBe(b.score); expect(a.time).toBe(b.time);
  });
  it('a decent bot reaches the boss; runs end within the time cap', () => {
    const s = run('2026-11-18', bot);
    expect(s.over).toBe(true);
    expect(Number.isFinite(s.score)).toBe(true);
    expect(s.wave).toBeGreaterThanOrEqual(3);
    console.log(`bot: score ${s.score}, wave ${s.wave}, won ${s.won}, lives ${s.lives}, ${s.time.toFixed(0)}s, kills ${s.kills}`);
  });
  it('a player who never moves loses all lives', () => {
    const s = run('2026-11-18', () => ({}));
    expect(s.over).toBe(true); expect(s.lives).toBe(0); expect(s.won).toBe(false);
    console.log(`idle: score ${s.score}, wave ${s.wave}, ${s.time.toFixed(0)}s`);
  });
  it('winning adds the boss and life bonus', () => {
    const s = createShooter('x'); s.lives = 2;
    s.phase = 'boss'; s.boss = { x: 400, y: 200, r: 46, hp: 1, age: 0, fireCd: 9, minionCd: 9 };
    s.player.x = 400; s.player.y = 260; s.player.fireCd = 0;
    const before = s.score;
    for (let i = 0; i < 30 && !s.over; i++) step(s, 1 / 60, {});
    expect(s.won).toBe(true);
    expect(s.score - before).toBe(10 + BOSS_BONUS + 2 * 1000);
  });
  it('several seeds: bot runs last a sensible time', () => {
    for (const d of ['2026-11-19', '2026-11-20', '2026-11-21']) {
      const s = run(d, bot);
      console.log(`${d}: score ${s.score}, wave ${s.wave}, won ${s.won}, ${s.time.toFixed(0)}s`);
      expect(s.time).toBeGreaterThan(40);
    }
  });
});

describe('Drone Shooter on a tall (upright phone) field', () => {
  it('keeps everything inside the narrow field and takes about as long', async () => {
    const { createShooter, step, TALL } = await import('../src/games/shooter-engine.js');
    const run = size => {
      const s = createShooter('2026-11-25', size);
      let maxX = 0;
      while (!s.over && s.time < 60) { step(s, 1 / 60, { pointer: { x: s.W / 2, y: s.H - 40 } }); for (const e of s.enemies) maxX = Math.max(maxX, e.x); }
      return { s, maxX };
    };
    const wide = run(), tall = run(TALL);
    expect(tall.s.W).toBe(480);
    expect(tall.maxX).toBeLessThan(480);
    expect(tall.s.player.y).toBeGreaterThan(TALL.h - 240);
    // same waves at the same pace: the tall run gets about as far in a minute
    expect(Math.abs(tall.s.wave - wide.s.wave)).toBeLessThanOrEqual(1);
  });
});

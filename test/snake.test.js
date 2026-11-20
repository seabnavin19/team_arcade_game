import { describe, it, expect } from 'vitest';
import { createSnakeGame, addSnake, setDir, step, snapshot, snakeStats, COLS, ROWS, START_LEN, KO_POINTS, RESPAWN_TICKS, MAX_PLAYERS } from '../src/party/snake.js';

// Put a snake exactly where a test needs it.
const place = (s, body, dir) => Object.assign(s, { body: body.map(c => [...c]), dir, queue: [], alive: true, grow: 0 });
function arena(n = 2) {
  const g = createSnakeGame('t');
  const snakes = Array.from({ length: n }, (_, i) => addSnake(g, `p${i}`, `P${i}`));
  g.food = [];
  return { g, snakes };
}

describe('snake arena', () => {
  it('spawns separate snakes of the starting length; max 8', () => {
    const g = createSnakeGame('s');
    for (let i = 0; i < MAX_PLAYERS; i++) expect(addSnake(g, `p${i}`, 'x').body).toHaveLength(START_LEN);
    expect(addSnake(g, 'nine', 'x')).toBeNull();
    const cells = new Set(g.order.flatMap(k => g.snakes[k].body.map(([x, y]) => `${x},${y}`)));
    expect(cells.size).toBe(MAX_PLAYERS * START_LEN);
    expect(g.food.length).toBe(3 + MAX_PLAYERS);
  });
  it('moves forward, turns, and ignores turning straight back', () => {
    const { g, snakes: [a] } = arena(1);
    place(a, [[10, 10], [9, 10], [8, 10], [7, 10]], 'right');
    step(g); expect(a.body[0]).toEqual([11, 10]);
    setDir(g, 'p0', 'left'); step(g); expect(a.body[0]).toEqual([12, 10]); // reverse ignored
    setDir(g, 'p0', 'down'); step(g); expect(a.body[0]).toEqual([12, 11]);
    expect(a.body).toHaveLength(START_LEN);
  });
  it('quick double turns are queued (down then left = a U-turn over two moves)', () => {
    const { g, snakes: [a] } = arena(1);
    place(a, [[10, 10], [9, 10], [8, 10], [7, 10]], 'right');
    setDir(g, 'p0', 'down'); setDir(g, 'p0', 'left');
    step(g); step(g);
    expect(a.body[0]).toEqual([9, 11]);
    expect(a.alive).toBe(true);
  });
  it('eating grows the snake and scores; golden food is worth 3', () => {
    const { g, snakes: [a] } = arena(1);
    place(a, [[10, 10], [9, 10], [8, 10], [7, 10]], 'right');
    g.food = [{ x: 11, y: 10, gold: false }, { x: 12, y: 10, gold: true }];
    step(g); expect(a.score).toBe(1); expect(a.body).toHaveLength(5);
    step(g); expect(a.score).toBe(4);
    step(g); step(g); step(g);
    expect(a.body).toHaveLength(8);
  });
  it('a wall knocks you out, your body becomes food, you respawn small', () => {
    const { g, snakes: [a] } = arena(1);
    place(a, [[COLS - 1, 5], [COLS - 2, 5], [COLS - 3, 5], [COLS - 4, 5]], 'right');
    step(g);
    expect(a.alive).toBe(false); expect(a.downs).toBe(1);
    expect(g.food.filter(f => f.drop)).toHaveLength(2);
    for (let i = 0; i < RESPAWN_TICKS; i++) step(g);
    expect(a.alive).toBe(true); expect(a.body).toHaveLength(START_LEN);
  });
  it('running into another snake credits that snake +5', () => {
    const { g, snakes: [a, b] } = arena(2);
    place(a, [[10, 9], [9, 9], [8, 9], [7, 9]], 'right');
    place(b, [[11, 12], [11, 11], [11, 10], [11, 9], [11, 8]], 'down'); // b's body crosses a's path
    step(g);
    expect(a.alive).toBe(false);
    expect(b.kos).toBe(1); expect(b.score).toBe(KO_POINTS);
    expect(g.events.find(e => e.e === 'ko')).toMatchObject({ k: a.idx, by: b.idx });
  });
  it('heads meeting knock both out and nobody scores', () => {
    const { g, snakes: [a, b] } = arena(2);
    place(a, [[10, 10], [9, 10], [8, 10]], 'right');
    place(b, [[12, 10], [13, 10], [14, 10]], 'left');
    step(g);
    expect(a.alive).toBe(false); expect(b.alive).toBe(false);
    expect(a.score + b.score).toBe(0);
  });
  it('chasing your own tail is safe (the tail moves away)', () => {
    const { g, snakes: [a] } = arena(1);
    place(a, [[10, 10], [10, 11], [11, 11], [11, 10]], 'up');
    setDir(g, 'p0', 'right');
    step(g);
    expect(a.alive).toBe(true);
  });
  it('a full random round stays sane; snapshot is small', () => {
    const g = createSnakeGame('chaos');
    for (let i = 0; i < 8; i++) addSnake(g, `p${i}`, `P${i}`);
    const dirs = ['up', 'right', 'down', 'left'];
    for (let t = 0; t < 90 * 8; t++) {
      if (t % 3 === 0) g.order.forEach((k, i) => setDir(g, k, dirs[(t + i * 7) % 4]));
      step(g);
      for (const k of g.order) for (const [x, y] of g.snakes[k].alive ? g.snakes[k].body : []) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(COLS); expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThan(ROWS); }
    }
    expect(JSON.stringify(snapshot(g)).length).toBeLessThan(4000);
    const st = snakeStats(g);
    expect(Object.values(st).every(s => s.score >= 0)).toBe(true);
  });
});

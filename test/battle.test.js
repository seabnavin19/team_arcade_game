import { describe, it, expect } from 'vitest';
import { buildArena, createBattle, addShip, setInput, step, snapshot, battleStats, moveShip, MAX_PLAYERS, MAX_HP, SHIP_R, W, H, TOP } from '../src/party/battle.js';

const run = (b, seconds) => { for (let i = 0; i < seconds * 20; i++) step(b, 0.05); };
function duel() {
  const b = createBattle('s1');
  b.blocks = []; // open arena for predictable tests
  const a = addShip(b, 'a', 'Dara'), c = addShip(b, 'c', 'Sokha');
  Object.assign(a, { x: 200, y: 270, a: 0, inv: 0, fireCd: 0 });
  Object.assign(c, { x: 420, y: 270, a: Math.PI, inv: 0, fireCd: 99 });
  return { b, a, c };
}

describe('ship battle', () => {
  it('arena is the same for a seed, mirrored, and leaves spawns clear', () => {
    expect(buildArena('x')).toEqual(buildArena('x'));
    expect(buildArena('x')).not.toEqual(buildArena('y'));
    const blocks = buildArena('x');
    expect(blocks.length).toBeGreaterThanOrEqual(3);
    const b = createBattle('x');
    for (let i = 0; i < 8; i++) {
      const s = addShip(b, `p${i}`, `P${i}`);
      expect(blocks.some(r => s.x + SHIP_R > r.x && s.x - SHIP_R < r.x + r.w && s.y + SHIP_R > r.y && s.y - SHIP_R < r.y + r.h)).toBe(false);
    }
    expect(addShip(b, 'extra', 'X')).toBeNull();
    expect(MAX_PLAYERS).toBe(8);
  });
  it('ships move, face where they go, and stay inside the arena', () => {
    const b = createBattle('m'); b.blocks = [];
    const s = addShip(b, 'a', 'A');
    setInput(b, 'a', 1, 0); run(b, 10);
    expect(s.x).toBe(W - SHIP_R); expect(s.a).toBe(0);
    setInput(b, 'a', 0, -1); run(b, 10);
    expect(s.y).toBe(TOP + SHIP_R);
  });
  it('cover stops ships and bullets', () => {
    const blocks = [{ x: 300, y: 200, w: 40, h: 100 }];
    const s = { x: 250, y: 250, a: 0 };
    for (let i = 0; i < 40; i++) moveShip(s, 1, 0, 0.05, blocks);
    expect(s.x).toBeLessThanOrEqual(300 - SHIP_R + 0.01);
    const { b, a, c } = duel();
    b.blocks = blocks; a.x = 200; a.y = 250; c.x = 420; c.y = 250;
    run(b, 2);
    expect(c.hp).toBe(MAX_HP);
  });
  it('three hits knock a ship out; it respawns with a spawn shield; KOs are counted', () => {
    const { b, a, c } = duel();
    let ko = null;
    for (let i = 0; i < 20 * 3 && !ko; i++) { step(b, 0.05); ko = b.events.find(e => e.e === 'ko'); c.x = 420; c.y = 270; }
    expect(ko).toMatchObject({ k: c.idx, by: a.idx });
    expect(c.alive).toBe(false); expect(a.kos).toBe(1); expect(c.downs).toBe(1); expect(a.hits).toBe(3);
    run(b, 2.1);
    expect(c.alive).toBe(true); expect(c.hp).toBe(MAX_HP); expect(c.inv).toBeGreaterThan(0);
  });
  it('spawn shield blocks damage', () => {
    const { b, c } = duel(); c.inv = 5;
    run(b, 2);
    expect(c.hp).toBe(MAX_HP);
  });
  it('pickups appear on a schedule and heal or speed up guns', () => {
    const b = createBattle('p'); b.blocks = [];
    const s = addShip(b, 'a', 'A'); s.hp = 1;
    run(b, 12.05);
    expect(b.pickups).toHaveLength(1);
    const p = b.pickups[0]; s.x = p.x; s.y = p.y; s.alive = true;
    step(b, 0.05);
    expect(b.events.some(e => e.e === 'pickup')).toBe(true);
    expect(p.kind === 'heal' ? s.hp === MAX_HP : s.rapid > 0).toBe(true);
  });
  it('snapshot is compact and stats rank by KOs', () => {
    const { b } = duel();
    run(b, 3);
    const snap = snapshot(b);
    expect(snap.ships[0]).toHaveLength(10);
    expect(JSON.stringify(snap).length).toBeLessThan(2000);
    const st = battleStats(b);
    expect(st.a.kos).toBeGreaterThanOrEqual(1); expect(st.a.score).toBe(st.a.kos);
  });
  it('8 ships wandering for a full round stay in bounds and finite', () => {
    const b = createBattle('chaos');
    for (let i = 0; i < 8; i++) addShip(b, `p${i}`, `P${i}`);
    for (let n = 0; n < 90 * 20; n++) {
      if (n % 20 === 0) b.order.forEach((k, i) => setInput(b, k, Math.cos(n / 37 + i), Math.sin(n / 23 + i * 2)));
      step(b, 0.05);
    }
    for (const k of b.order) { const s = b.ships[k]; expect(s.x).toBeGreaterThanOrEqual(SHIP_R); expect(s.x).toBeLessThanOrEqual(W - SHIP_R); expect(s.y).toBeGreaterThanOrEqual(TOP + SHIP_R); expect(s.y).toBeLessThanOrEqual(H); }
    const total = Object.values(battleStats(b)).reduce((n, s) => n + s.kos, 0);
    console.log('random 8-player round, total KOs:', total, 'bullets live:', b.bullets.length);
  });
});

describe('Ship Battle screen layout and steering', () => {
  it('fills a wide screen and turns the arena sideways on a tall one', async () => {
    const { battleLayout } = await import('../src/party/battle-view.js');
    const wide = battleLayout(1200, 700), tall = battleLayout(390, 760);
    expect(wide.portrait).toBe(false); expect(wide.sw * wide.css).toBeGreaterThan(1100);
    expect(tall.portrait).toBe(true); expect(tall.sh * tall.css).toBeGreaterThan(700);
  });
  it('maps screen taps back to the same arena point in both layouts', async () => {
    const { battleLayout, toScreen, fromScreen } = await import('../src/party/battle-view.js');
    for (const view of [battleLayout(1200, 700), battleLayout(390, 760)]) {
      const { sx, sy } = toScreen(view, 123, 300);
      const p = fromScreen(view, sx / view.sw, sy / view.sh);
      expect(p.x).toBeCloseTo(123); expect(p.y).toBeCloseTo(300);
    }
  });
  it('ships turn smoothly instead of snapping round', () => {
    const s = { x: 400, y: 300, a: 0 };
    moveShip(s, -1, 0, 1 / 60, []);
    expect(Math.abs(s.a)).toBeGreaterThan(0); expect(Math.abs(s.a)).toBeLessThan(0.5);
    for (let i = 0; i < 30; i++) moveShip(s, -1, 0, 1 / 60, []);
    expect(Math.abs(s.a)).toBeCloseTo(Math.PI);
  });
});

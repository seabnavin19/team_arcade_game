import { describe, it, expect } from 'vitest';
import {
  buildCity, createStreet, addDriver, setControls, step, botControls, stats, snapshot, tileAt, driveCar,
  TILE, COLS, ROWS, ROAD, BUILDING, WW, WH, MAX_STARS,
} from '../src/games/street.js';
import { objective } from '../src/games/heat.js';
import heat from '../src/games/heat.js';
import { GAME_META, checkRun } from '../src/games/meta.js';

const run = (sim, secs, ctl = k => botControls(sim, k)) => { for (let i = 0; i < secs * 20 && !sim.over; i++) { for (const k of sim.order) setControls(sim, k, ...ctl(k)); step(sim, 0.05); } };

describe('Street Heat city', () => {
  it('is the same city for the same day, and different the next', () => {
    expect(buildCity('2026-11-25').tiles).toEqual(buildCity('2026-11-25').tiles);
    expect(buildCity('2026-11-25').shops).not.toEqual(buildCity('2026-11-26').shops);
  });
  it('every shop is on a road and every road connects to the hideout', () => {
    for (const day of ['a', 'b', 'c']) {
      const city = buildCity(day);
      for (const s of city.shops) expect(tileAt(city, s.x, s.y)).toBe(ROAD);
      expect(city.washes).toHaveLength(2);
      // flood from the hideout's ring
      const seen = new Set(), q = [[city.hideout.c, city.hideout.r]];
      while (q.length) {
        const [c, r] = q.pop(), k = r * COLS + c;
        if (c < 0 || r < 0 || c >= COLS || r >= ROWS || seen.has(k) || city.tiles[k] === BUILDING) continue;
        seen.add(k); q.push([c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]);
      }
      const drivable = city.tiles.filter(t => t !== BUILDING).length;
      expect(seen.size).toBe(drivable);
    }
  });
  it('cars stay on the streets: buildings and the city edge stop them', () => {
    const city = buildCity('x');
    const car = { x: TILE, y: TILE, a: Math.PI / 2, v: 0 };
    for (let i = 0; i < 200; i++) driveCar(car, 1, 0, 0.05, city); // full throttle straight into a block
    expect(tileAt(city, car.x, car.y)).not.toBe(BUILDING);
    const edge = { x: TILE, y: TILE, a: Math.PI, v: 0 };
    for (let i = 0; i < 100; i++) driveCar(edge, 1, 0, 0.05, city);
    expect(edge.x).toBeGreaterThan(0); expect(edge.x).toBeLessThan(WW); expect(edge.y).toBeLessThan(WH);
  });
});

describe('Street Heat rules', () => {
  it('grabbing loot makes you wanted; the hideout is locked until you lose the police', () => {
    const sim = createStreet('rules');
    const d = addDriver(sim, 'you', 'You');
    step(sim, 0.05);
    const l = sim.loot[0];
    Object.assign(d, { x: l.x, y: l.y, v: 0 });
    step(sim, 0.05);
    expect(d.carry).toBe(l.value);
    expect(d.stars).toBeGreaterThan(0);
    Object.assign(d, { x: sim.city.hideout.x - 70, y: sim.city.hideout.y - 70 });
    sim.cops = []; step(sim, 0.05);
    expect(sim.events.some(e => e.e === 'hot')).toBe(true);
    expect(d.banked).toBe(0);
    // no police near for long enough → the stars fade, then it banks
    for (let i = 0; i < 400 && d.stars; i++) { sim.cops = []; d.x = sim.city.hideout.x - 70; d.y = sim.city.hideout.y - 70; step(sim, 0.05); }
    expect(d.stars).toBe(0);
    step(sim, 0.05);
    expect(d.banked).toBe(l.value);
    expect(d.carry).toBe(0);
  });
  it('banking several grabs in one trip earns a haul bonus', () => {
    const sim = createStreet('haul');
    const d = addDriver(sim, 'you', 'You');
    Object.assign(d, { carry: 600, haul: 3, stars: 0, x: sim.city.hideout.x - 70, y: sim.city.hideout.y - 70 });
    step(sim, 0.05);
    expect(d.banked).toBe(600 + 300); // +25% for each extra grab
  });
  it('the car wash clears the heat; police contact busts you and takes the loot', () => {
    const sim = createStreet('wash');
    const d = addDriver(sim, 'you', 'You');
    Object.assign(d, { stars: 3, carry: 400, x: sim.city.washes[0].x - 70, y: sim.city.washes[0].y - 70 });
    step(sim, 0.05);
    expect(d.stars).toBe(0);
    Object.assign(d, { stars: 2, x: 400, y: 60, v: 0 });
    for (let i = 0; i < 40 && !d.busts; i++) { sim.cops[0] && Object.assign(sim.cops[0], { x: d.x + 20, y: d.y, v: 0 }); step(sim, 0.05); }
    expect(d.busts).toBe(1);
    expect(d.carry).toBe(0);
    expect(d.stars).toBe(0);
  });
  it('stars never go past six, and more stars bring more police', () => {
    const sim = createStreet('cops');
    const d = addDriver(sim, 'you', 'You');
    step(sim, 0.05);
    const grab = () => { const l = sim.loot.find(x => x.hot); Object.assign(d, { x: l.x, y: l.y, v: 0 }); step(sim, 0.05); };
    grab();
    const one = sim.cops.length;
    for (let i = 0; i < 8; i++) grab();
    expect(d.stars).toBe(MAX_STARS);
    expect(sim.cops.length).toBeGreaterThan(one);
  });
  it('party: ramming a car that carries loot knocks half of it loose', () => {
    const sim = createStreet('ram', { mode: 'party' });
    const a = addDriver(sim, 'a', 'A'), b = addDriver(sim, 'b', 'B');
    Object.assign(a, { x: 300, y: 60, a: 0, v: 280 });
    Object.assign(b, { x: 322, y: 60, a: 0, v: 0, carry: 400 });
    step(sim, 0.05);
    expect(b.carry).toBe(200);
    expect(sim.loot.some(l => l.kind === 'bag' && l.value === 200)).toBe(true);
    expect(sim.events.some(e => e.e === 'ram' && e.by === 'a')).toBe(true);
  });
  it('a full party round with bots: they grab, bank and the scores add up', () => {
    const sim = createStreet('2026-11-25', { mode: 'party' });
    for (const k of ['b1', 'b2', 'b3', 'b4']) addDriver(sim, k, k);
    run(sim, 200);
    expect(sim.over).toBe(true);
    const st = stats(sim);
    expect(Object.values(st).reduce((n, s) => n + s.hits, 0)).toBeGreaterThan(10);
    expect(Object.values(st).some(s => s.score > 0)).toBe(true);
    const snap = snapshot(sim);
    expect(snap.cars).toHaveLength(4);
    expect(JSON.stringify(snap).length).toBeLessThan(3000); // small enough to send 20× a second
  });
});

describe('Street Heat solo game', () => {
  it('points the way: loot first, a car wash when wanted with loot, the hideout to bank', () => {
    const sim = createStreet('obj');
    const d = addDriver(sim, 'you', 'You');
    step(sim, 0.05);
    expect(objective(sim, d).label).toBe('$');
    d.carry = 300; d.stars = 2;
    expect(objective(sim, d).label).toBe('WASH');
    d.stars = 0;
    expect(objective(sim, d).label).toBe('BANK IT');
  });
  it('is listed with sane score limits', () => {
    expect(heat.id).toBe('heat');
    expect(GAME_META.heat.format(1250)).toBe('$1,250');
    expect(checkRun('heat', 2400, {}, 90)).toBeNull();
    expect(checkRun('heat', 2400, {}, 30)).toMatch(/too quick/);
    expect(checkRun('heat', 99999, {}, 90)).toMatch(/outside/);
  });
});

describe('Street Heat tilt steering', () => {
  it('steers like a wheel whichever way the phone is held, on Android and iPhone', async () => {
    const { tiltSteer } = await import('../src/games/street-draw.js');
    const g = 9.81, s20 = Math.sin(20 * Math.PI / 180) * g;
    // Android, held upright (gravity reads +y): tipping the right side down → steer right
    expect(tiltSteer(-s20, g, 3, 0)).toBeGreaterThan(0.5);
    expect(tiltSteer(s20, g, 3, 0)).toBeLessThan(-0.5);
    // iPhone reports everything the other way round: same turn, same steering
    expect(tiltSteer(s20, -g, -3, 0)).toBeGreaterThan(0.5);
    // lying almost flat (gravity mostly on z) still works on both
    expect(tiltSteer(-s20, 1, g, 0)).toBeGreaterThan(0.5);
    expect(tiltSteer(s20, -1, -g, 0)).toBeGreaterThan(0.5);
    // held sideways (screen turned 90° either way): the long side is now left–right
    expect(tiltSteer(g * 0.5, s20, 6, 90)).toBeGreaterThan(0.5);
    expect(tiltSteer(-g * 0.5, -s20, 6, -90)).toBeGreaterThan(0.5);
    expect(tiltSteer(-g * 0.5, -s20, -6, 90)).toBeGreaterThan(0.5); // iPhone, sideways
    // level: straight ahead; tipped a lot: full lock, never more
    expect(tiltSteer(0.3, g, 2, 0)).toBe(0);
    expect(tiltSteer(-g, 1, 1, 0)).toBe(1);
    expect(tiltSteer(NaN, 0, 0, 0)).toBe(0);
  });
});

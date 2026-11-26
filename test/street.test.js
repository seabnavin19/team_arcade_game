import { describe, it, expect } from 'vitest';
import {
  buildCity, createStreet, addDriver, setControls, step, botControls, stats, snapshot, tileAt, driveCar, steerToward, easyDrive, reportPosition,
  TILE, COLS, ROWS, ROAD, BUILDING, WW, WH, MAX_STARS,
} from '../src/games/street.js';
import { objective } from '../src/games/heat.js';
import heat from '../src/games/heat.js';
import { GAME_META, checkRun } from '../src/games/meta.js';

const run = (sim, secs, ctl = k => botControls(sim, k)) => { for (let i = 0; i < secs * 20 && !sim.over; i++) { for (const k of sim.order) setControls(sim, k, ...ctl(k)); step(sim, 0.05); } };

describe('GTP6 city', () => {
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

describe('GTP6 rules', () => {
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

describe('GTP6 solo game', () => {
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

describe('GTP6 easy driving', () => {
  const city = buildCity('2026-11-26');
  const drive = (plan, secs) => {
    const car = { x: 60, y: 40, a: 0, v: 0, assist: true };
    let want = null, pi = 0, hard = 0;
    for (let i = 0; i < secs * 30; i++) {
      while (pi < plan.length && plan[pi][0] <= i / 30) want = plan[pi++][1];
      if (driveCar(car, ...easyDrive(city, car, want), 1 / 30, city) > 120) hard++;
    }
    return { car, hard };
  };
  it('one tap and the car cruises down the road, in the middle of the lane', () => {
    const { car, hard } = drive([[0, 'right']], 4);
    expect(hard).toBe(0);
    expect(car.x).toBeGreaterThan(800);
    expect(Math.abs(car.y - 40)).toBeLessThan(4);
  });
  it('tapping ▼ early turns into the next street down, lined up, without hitting anything', () => {
    const { car, hard } = drive([[0, 'right'], [0.3, 'down']], 4);
    expect(hard).toBe(0);
    expect(Math.abs(car.x - 280)).toBeLessThan(6); // the first street down
    expect(car.y).toBeGreaterThan(500);
  });
  it('follows the road round the corner of the city instead of crashing', () => {
    const { car, hard } = drive([[0, 'right']], 12);
    expect(hard).toBe(0);
    expect(car.x).toBeGreaterThan(2080); // went round the top-right corner…
    expect(car.y).toBeGreaterThan(400); // …and on down the side
  });
  it('the opposite arrow turns the car round', () => {
    const { car } = drive([[0, 'right'], [2, 'left']], 6);
    expect(Math.cos(car.a)).toBeLessThan(-0.9);
  });
  it('random tapping for 90 s: never stuck, barely a bump', () => {
    let r = 3; const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647;
    const plan = []; for (let t = 0; t < 90; t += 0.5 + rnd() * 3) plan.push([t, ['up', 'down', 'left', 'right'][Math.floor(rnd() * 4)]]);
    const car = { x: 60, y: 40, a: 0, v: 0, assist: true };
    let want = null, pi = 0, slow = 0, stuck = 0, hard = 0;
    for (let i = 0; i < 90 * 30; i++) {
      while (pi < plan.length && plan[pi][0] <= i / 30) want = plan[pi++][1];
      if (driveCar(car, ...easyDrive(city, car, want), 1 / 30, city) > 120) hard++;
      slow = Math.abs(car.v) < 25 ? slow + 1 / 30 : 0;
      if (slow > 1.5 && slow - 1 / 30 <= 1.5) stuck++;
    }
    expect(stuck).toBe(0);
    expect(hard).toBeLessThanOrEqual(5);
  });
});

describe('GTP6 D-pad', () => {
  const fakeInput = () => {
    const ls = { pointerdown: [], pointermove: [], pointerup: [], keydown: [] };
    return { keys: new Set(), pointer: { inside: false }, on: (t, f) => ls[t]?.push(f), fire: (t, pt, id) => ls[t].forEach(f => f(pt, { pointerId: id })), key: k => ls.keydown.forEach(f => f({ key: k })) };
  };
  it('a tap (or a key) picks the way to go, and it sticks after letting go', async () => {
    globalThis.window ||= { matchMedia: () => ({ matches: true }), addEventListener() {}, removeEventListener() {} };
    globalThis.navigator ||= { maxTouchPoints: 5 };
    const { createDriveControls, padLayout } = await import('../src/games/street-draw.js');
    const city = buildCity('pad');
    const input = fakeInput();
    const c = createDriveControls(input, { toWorld: (x, y) => ({ x, y }), city: () => city, screen: () => ({ w: 480, h: 860 }) });
    const L = padLayout(480, 860), mid = r => ({ x: r.x + r.w / 2, y: r.y + r.h / 2, type: 'touch', down: true });
    expect(c.want).toBeNull();
    expect(c.read({ x: 60, y: 40, a: 0, v: 0 })).toEqual([0, 0]); // waits for the first tap
    input.fire('pointerdown', mid(L.right), 1); input.fire('pointerup', { type: 'touch' }, 1);
    expect(c.want).toBe('right');
    expect(c.read({ x: 60, y: 40, a: 0, v: 0 })[0]).toBeGreaterThan(0); // still going after letting go
    input.fire('pointerdown', { x: L.cx + 5, y: L.cy + L.size * 1.3, type: 'touch', down: true }, 2); // near ▼, not exactly on it
    expect(c.want).toBe('down');
    input.fire('pointermove', mid(L.left), 2);
    expect(c.want).toBe('left');
    input.key('ArrowUp');
    expect(c.want).toBe('up');
    input.fire('pointerdown', { x: 400, y: 200, type: 'touch', down: true }, 3); // a tap on the street does nothing
    expect(c.want).toBe('up');
  });
});

describe('GTP6 handling', () => {
  it('drives straight by itself when a little off, and slides along walls instead of stopping', () => {
    const city = buildCity('handling');
    const car = { x: TILE * 3, y: TILE, a: 0.17, v: 250, assist: true };
    let scrapes = 0;
    for (let i = 0; i < 90; i++) if (driveCar(car, 1, 0, 1 / 30, city) > 0) scrapes++;
    expect(scrapes).toBe(0);
    expect(Math.abs(car.a)).toBeLessThan(0.02);
    expect(car.v).toBeGreaterThan(250);
  });
  it('a full-lock right turn at cruise makes the corner over a comfortable window', () => {
    const city = buildCity('handling');
    let clean = 0;
    for (let startAt = 150; startAt <= 290; startAt += 10) {
      const car = { x: 60, y: 40, a: 0, v: 0, assist: true };
      let turning = false, done = false, hard = 0;
      for (let i = 0; i < 150; i++) {
        if (!done && car.x >= startAt) turning = true;
        if (turning && car.a >= Math.PI / 2 - 0.15) { turning = false; done = true; }
        const steer = turning ? 1 : 0;
        if (driveCar(car, 1 - 0.45 * steer, steer, 1 / 30, city) > 120) hard++;
      }
      if (hard === 0 && Math.abs(car.x - 280) < 10 && car.y > 600) clean++;
    }
    expect(clean).toBeGreaterThanOrEqual(6); // 60+ px of road where turning just works
  });
  it('half throttle cruises at about half speed', () => {
    const city = buildCity('handling');
    const car = { x: TILE * 3, y: TILE, a: 0, v: 290, assist: true };
    for (let i = 0; i < 60; i++) driveCar(car, 0.5, 0, 1 / 30, city);
    expect(car.v).toBeGreaterThan(130); expect(car.v).toBeLessThan(160);
  });
});

describe('GTP6 never gets stuck', () => {
  it('nose in a wall with the gas on: it backs out and gets going again', () => {
    const city = buildCity('stuck');
    const car = { x: 60, y: 40, a: Math.PI / 2, v: 200, assist: true }; // driving straight at the block below
    let slowFor = 0, longest = 0;
    for (let i = 0; i < 120; i++) {
      driveCar(car, 1, 0, 1 / 30, city); // no steering at all
      slowFor = Math.abs(car.v) < 25 ? slowFor + 1 / 30 : 0;
      longest = Math.max(longest, slowFor);
    }
    expect(longest).toBeLessThan(0.8);
    expect(tileAt(city, car.x, car.y)).not.toBe(BUILDING);
  });
  it('a phone player steering with lag is never stuck for a second', () => {
    for (const day of ['a', 'b', 'c']) {
      const sim = createStreet(day);
      const d = addDriver(sim, 'you', 'You');
      let s = 0, slowFor = 0, stuck = 0;
      for (let i = 0; i < 90 * 30; i++) {
        const goal = sim.loot[0] || sim.city.hideout;
        const [, want] = steerToward(sim, d, goal.x, goal.y);
        s += (want - s) * 0.25;
        setControls(sim, 'you', 1 - 0.45 * Math.abs(s), s);
        step(sim, 1 / 30);
        sim.cops = [];
        slowFor = Math.abs(d.v) < 25 && d.stun <= 0 ? slowFor + 1 / 30 : 0;
        if (slowFor > 1 && slowFor - 1 / 30 <= 1) stuck++;
      }
      expect(stuck).toBe(0);
      expect(d.grabs).toBeGreaterThan(8);
    }
  });
});

describe('GTP6 party: your phone drives your car', () => {
  it('takes believable positions from the phone, refuses teleports, buildings and moving while busted', () => {
    const sim = createStreet('remote', { mode: 'party' });
    const d = addDriver(sim, 'p', 'P');
    step(sim, 0.05);
    expect(reportPosition(sim, 'p', { x: d.x + 10, y: d.y, a: 0, v: 200 })).toBe(true);
    expect(d.x).toBeCloseTo(TILE + 10);
    step(sim, 0.05);
    expect(d.x).toBeCloseTo(TILE + 10); // the server doesn't move a car the phone is driving
    expect(reportPosition(sim, 'p', { x: d.x + 900, y: d.y, a: 0, v: 200 })).toBe(false); // too far, too fast
    expect(reportPosition(sim, 'p', { x: 3 * TILE, y: 3 * TILE, a: 0, v: 0 })).toBe(false); // inside a building
    expect(reportPosition(sim, 'p', { x: NaN, y: 1, a: 0, v: 0 })).toBe(false);
    d.stun = 1;
    expect(reportPosition(sim, 'p', { x: d.x + 5, y: d.y, a: 0, v: 0 })).toBe(false);
  });
  it('a phone that goes quiet: the car coasts to a stop instead of freezing mid-air', () => {
    const sim = createStreet('quiet', { mode: 'party' });
    const d = addDriver(sim, 'p', 'P');
    step(sim, 0.05);
    reportPosition(sim, 'p', { x: d.x + 5, y: d.y, a: 0, v: 250 });
    for (let i = 0; i < 60; i++) step(sim, 0.05);
    expect(Math.abs(d.v)).toBeLessThan(30);
  });
  it('the loot the phone drives over is grabbed on the server', () => {
    const sim = createStreet('grab', { mode: 'party' });
    const d = addDriver(sim, 'p', 'P');
    step(sim, 0.05);
    const l = sim.loot[0];
    Object.assign(d, { x: l.x, y: l.y - 30 }); // on the street just short of it (shops are on roads)
    expect(reportPosition(sim, 'p', { x: l.x, y: l.y - 2, a: Math.PI / 2, v: 150 })).toBe(true);
    step(sim, 0.05);
    expect(d.grabs).toBeGreaterThan(0);
  });
});

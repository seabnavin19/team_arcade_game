import { describe, it, expect } from 'vitest';
import { createMarket, addCook, act, step, snapshot, marketStats, restoreMarket, cookKey, serverKey, DISHES, TICKS, SWAP_TICK, BURN_AFTER, SEATS } from '../src/party/market.js';

function game() {
  const g = createMarket('seed');
  addCook(g, 'a', 'Dara'); addCook(g, 'b', 'Sophea');
  return g;
}
const run = (g, n) => { for (let i = 0; i < n; i++) step(g); };

describe('Night Market Duo', () => {
  it('takes two players; the first cooks, the second serves, and they swap at half time', () => {
    const g = game();
    expect(addCook(g, 'c', 'Vanna')).toBeNull();
    expect([cookKey(g), serverKey(g)]).toEqual(['a', 'b']);
    run(g, SWAP_TICK);
    expect([cookKey(g), serverKey(g)]).toEqual(['b', 'a']);
    expect(g.events).toContainEqual({ e: 'swap' });
  });

  it('only the cook cooks and plates; a dish is ready after its cook time and burns if left', () => {
    const g = game();
    act(g, 'b', { type: 'cook', d: 0 });
    expect(g.burners.every(b => !b)).toBe(true);
    act(g, 'a', { type: 'cook', d: 1 });
    act(g, 'a', { type: 'plate', b: 0 });
    expect(g.counter.every(c => c == null)).toBe(true); // not cooked yet
    run(g, DISHES[1].cook);
    act(g, 'a', { type: 'plate', b: 0 });
    expect(g.counter[0]).toBe(1);
    act(g, 'a', { type: 'cook', d: 0 });
    run(g, DISHES[0].cook + BURN_AFTER + 1);
    expect(g.burners[0].burned).toBe(true);
    expect(g.burned).toBe(1);
  });

  it('customers arrive and walk out when their patience runs out', () => {
    const g = game();
    run(g, 20);
    expect(g.seats.some(Boolean)).toBe(true);
    run(g, 400);
    expect(g.walked).toBeGreaterThan(0);
    expect(g.seats.filter(Boolean).length).toBeLessThanOrEqual(SEATS);
  });

  it('serving the right dish earns shared tips; the wrong one breaks the combo', () => {
    const g = game();
    g.seats[0] = { id: 1, d: 2, p: 200, max: 200 };
    g.seats[1] = { id: 2, d: 0, p: 100, max: 200 };
    g.counter[0] = 2; g.counter[1] = 1;
    g.combo = 2;
    act(g, 'a', { type: 'serve', c: 0, s: 0 }); // the cook can't serve
    expect(g.tips).toBe(0);
    act(g, 'b', { type: 'serve', c: 1, s: 1 });
    expect(g.combo).toBe(0);
    expect(g.counter[1]).toBe(1);
    act(g, 'b', { type: 'serve', c: 0, s: 0 });
    expect(g.tips).toBe(20);
    expect(g.served).toBe(1);
    expect(g.seats[0]).toBeNull();
    expect(marketStats(g)).toEqual({ a: { score: 20, kos: 0, downs: 0, hits: 0 }, b: { score: 20, kos: 0, downs: 0, hits: 1 } });
  });

  it('stops at the end of the round and survives a restart with its tips and clock', () => {
    const g = game();
    run(g, TICKS + 50);
    expect(g.tick).toBe(TICKS);
    const snap = snapshot(g);
    expect(snap).toMatchObject({ tick: TICKS, cook: 'b', server: 'a' });
    const again = createMarket('seed');
    addCook(again, 'a', 'Dara'); addCook(again, 'b', 'Sophea');
    restoreMarket(again, { tips: 120, served: 6, walked: 1, burned: 0 }, 600.4);
    expect(again).toMatchObject({ tick: 600, tips: 120, served: 6, walked: 1 });
  });
});

import { describe, it, expect, vi } from 'vitest';
import { createRng } from '../src/core/rng.js';
import { dayKey, weekKey, previousWeekKey } from '../src/core/time.js';
import { createConfluenceClient } from '../src/core/confluence.js';

describe('rng', () => {
  it('same seed gives same sequence', () => {
    const a = createRng('2026-11-18:reaction'), b = createRng('2026-11-18:reaction');
    const sa = Array.from({ length: 20 }, a.next), sb = Array.from({ length: 20 }, b.next);
    expect(sa).toEqual(sb);
    expect(sa.every(x => x >= 0 && x < 1)).toBe(true);
  });
  it('different seeds differ', () => {
    expect(createRng('a').next()).not.toBe(createRng('b').next());
  });
});

describe('time (UTC+7)', () => {
  it('day rolls over at 17:00 UTC', () => {
    expect(dayKey(new Date('2026-11-18T16:59:00Z'))).toBe('2026-11-18');
    expect(dayKey(new Date('2026-11-18T17:00:00Z'))).toBe('2026-11-19');
  });
  it('week changes Sunday 23:59 -> Monday 00:00 local', () => {
    // Monday 2026-11-23 00:00 UTC+7 = 2026-11-22T17:00Z
    expect(weekKey(new Date('2026-11-22T16:59:00Z'))).toBe('2026-W47');
    expect(weekKey(new Date('2026-11-22T17:00:00Z'))).toBe('2026-W48');
  });
  it('handles year-boundary ISO weeks', () => {
    expect(weekKey(new Date('2026-12-31T05:00:00Z'))).toBe('2026-W53');
    expect(weekKey(new Date('2027-01-03T05:00:00Z'))).toBe('2026-W53');
    expect(weekKey(new Date('2027-01-04T05:00:00Z'))).toBe('2027-W01');
    expect(weekKey(new Date('2025-12-29T05:00:00Z'))).toBe('2026-W01');
  });
  it('previous week', () => {
    expect(previousWeekKey(new Date('2026-11-18T05:00:00Z'))).toBe('2026-W46');
  });
});

const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

describe('confluence client', () => {
  const make = f => createConfluenceClient({ fetch: f, pageId: '123', contextPath: '/wiki' });
  it('reads a property', async () => {
    const f = vi.fn(async () => res(200, { key: 'k', value: { a: 1 }, version: { number: 4 } }));
    const r = await make(f).getProperty('k');
    expect(r).toEqual({ status: 'ok', value: { a: 1 }, version: 4 });
    expect(f.mock.calls[0][0]).toBe('/wiki/rest/api/content/123/property/k');
  });
  it('maps statuses', async () => {
    expect((await make(async () => res(404)).getProperty('k')).status).toBe('notFound');
    expect((await make(async () => res(409)).updateProperty('k', {}, 2)).status).toBe('conflict');
    expect((await make(async () => res(403)).updateProperty('k', {}, 2)).status).toBe('forbidden');
    expect((await make(async () => res(400)).createProperty('k', {})).status).toBe('conflict');
    expect((await make(async () => res(500)).getProperty('k')).status).toBe('error');
    expect((await make(async () => { throw new TypeError('offline'); }).getProperty('k')).status).toBe('network');
  });
  it('sends version + 1 and XSRF header on update', async () => {
    const f = vi.fn(async () => res(200, {}));
    await make(f).updateProperty('k', { x: 1 }, 5);
    const [, opts] = f.mock.calls[0];
    expect(opts.method).toBe('PUT');
    expect(opts.headers['X-Atlassian-Token']).toBe('no-check');
    expect(JSON.parse(opts.body).version.number).toBe(5);
  });
  it('current user', async () => {
    const ok = await make(async () => res(200, { type: 'known', userKey: 'u1', displayName: 'Dara' })).currentUser();
    expect(ok).toEqual({ status: 'ok', user: { key: 'u1', name: 'Dara' } });
    const anon = await make(async () => res(200, { type: 'anonymous' })).currentUser();
    expect(anon.status).toBe('forbidden');
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { createHandler, weekPath, boardText, announcement, displayName, CHATS_PATH } from '../telegram/app.js';
import { deriveKeys, sign, verify } from '../telegram/token.js';
import { weekKey } from '../src/core/time.js';

const ENV = {
  BOT_TOKEN: '123:abc', DATA_TOKEN: 'ghp_x', ARCADE_SECRET: 'a-very-long-test-secret-123',
  GITHUB_REPO: 'me/repo', DATA_BRANCH: 'scores', GAME_URL: 'https://me.github.io/repo/', GAME_SHORT_NAME: 'arcade', ANNOUNCE: 'top3',
};
const ORIGIN = 'https://team-arcade.me.workers.dev';
const GROUP = { id: -100123, type: 'supergroup', title: 'Dev team' };

// Fake GitHub contents API (with real sha conflicts) + fake Telegram.
function fakeWorld() {
  const files = new Map(); // path -> { content, sha }
  const refs = new Map([['main', 'mainsha']]);
  const sent = [];
  let shaN = 0;
  const res = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), { status });
  async function fetch(url, init = {}) {
    await new Promise(r => setTimeout(r, 0)); // let concurrent requests interleave
    const u = new URL(url);
    if (u.hostname === 'api.telegram.org') {
      const method = u.pathname.split('/').pop();
      const body = init.body ? JSON.parse(init.body) : {};
      sent.push({ method, body });
      if (method === 'getMe') return res(200, { ok: true, result: { username: 'TeamArcadeBot' } });
      return res(200, { ok: true, result: true });
    }
    const p = decodeURIComponent(u.pathname.replace('/repos/me/repo/', ''));
    if (p.startsWith('contents/')) {
      const path = p.slice('contents/'.length);
      if (!init.method || init.method === 'GET') {
        expect(u.searchParams.get('ref')).toBe('scores');
        const f = files.get(path);
        return f ? res(200, { content: f.content, sha: f.sha }) : res(404, { message: 'Not Found' });
      }
      const body = JSON.parse(init.body);
      expect(body.branch).toBe('scores');
      const f = files.get(path);
      if (f && body.sha !== f.sha) return res(409, { message: 'sha mismatch' });
      if (!f && body.sha) return res(409, { message: 'sha mismatch' });
      if (f && !body.sha) return res(422, { message: 'sha required' });
      files.set(path, { content: body.content, sha: `s${++shaN}` });
      return res(200, {});
    }
    if (p.startsWith('git/ref/heads/')) {
      const name = p.slice('git/ref/heads/'.length);
      return refs.has(name) ? res(200, { object: { sha: refs.get(name) } }) : res(404, {});
    }
    if (p === 'git/refs' && init.method === 'POST') {
      const { ref, sha } = JSON.parse(init.body); refs.set(ref.replace('refs/heads/', ''), sha); return res(201, {});
    }
    return res(404, { message: `fake: ${init.method || 'GET'} ${p}` });
  }
  const read = path => {
    const f = files.get(path); if (!f) return null;
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(f.content), c => c.charCodeAt(0))));
  };
  return { fetch, files, refs, sent, read };
}

let world, clock, worker, keys;
const waits = [];
const ctx = { waitUntil: p => waits.push(p) };
const settle = async () => { while (waits.length) await waits.shift(); };
const NOW = Date.parse('2026-11-19T03:00:00Z'); // Thursday, week 47

async function call(method, path, body, headers = {}) {
  const res = await worker.fetch(new Request(`${ORIGIN}${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined,
  }), ENV, ctx);
  await settle();
  const text = await res.text();
  let data = null; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}
const webhook = update => call('POST', '/telegram', update, { 'X-Telegram-Bot-Api-Secret-Token': keys.webhookSecret });

async function tapPlay(from, chat = GROUP) {
  world.sent.length = 0;
  await webhook({ callback_query: { id: 'cq1', from, game_short_name: 'arcade', message: { chat } } });
  const ans = world.sent.find(s => s.method === 'answerCallbackQuery');
  const u = new URL(ans.body.url);
  return { url: u, t: new URLSearchParams(u.hash.slice(1)).get('t') };
}
async function playRun(t, game, score, seconds, meta = {}) {
  const { data } = await call('POST', '/run', { t, game });
  clock += seconds * 1000;
  return call('POST', '/score', { t, run: data.run, game, score, meta });
}

const dara = { id: 11, first_name: 'Dara', last_name: 'Sok' };
const sokha = { id: 22, first_name: 'Sokha' };

beforeEach(async () => {
  world = fakeWorld(); clock = NOW; waits.length = 0;
  worker = createHandler({ fetch: world.fetch, now: () => clock });
  keys = await deriveKeys(ENV.ARCADE_SECRET);
});

describe('tokens', () => {
  it('round-trip, reject tampering and expiry', async () => {
    const t = await sign(keys.tokenKey, { typ: 's', u: 1, n: 'Dara', exp: NOW + 1000 });
    expect((await verify(keys.tokenKey, t, NOW)).n).toBe('Dara');
    expect(await verify(keys.tokenKey, t, NOW + 2000)).toBeNull();
    const [body, sig] = t.split('.');
    const forged = btoa(JSON.stringify({ typ: 's', u: 2, n: 'Evil', exp: NOW + 1e9 })).replace(/=+$/, '');
    expect(await verify(keys.tokenKey, `${forged}.${sig}`, NOW)).toBeNull();
    expect(await verify(keys.tokenKey, `${body}.AAAA`, NOW)).toBeNull();
    expect(await verify((await deriveKeys('another-secret-of-length')).tokenKey, t, NOW)).toBeNull();
  });
  it('handles names with Khmer and emoji', async () => {
    const t = await sign(keys.tokenKey, { typ: 's', n: 'សុខា 🎮', exp: NOW + 1000 });
    expect((await verify(keys.tokenKey, t, NOW)).n).toBe('សុខា 🎮');
  });
});

describe('webhook', () => {
  it('rejects calls without the secret header', async () => {
    expect((await call('POST', '/telegram', { message: {} })).status).toBe(403);
  });
  it('Play opens the game page with a signed link and remembers the group', async () => {
    const { url, t } = await tapPlay(dara);
    expect(url.origin + url.pathname).toBe(ENV.GAME_URL);
    expect(url.searchParams.get('api')).toBe(ORIGIN);
    const claims = await verify(keys.tokenKey, t, NOW);
    expect(claims).toMatchObject({ typ: 's', u: 11, n: 'Dara S.', c: GROUP.id });
    expect(world.read(CHATS_PATH).chats[GROUP.id].title).toBe('Dev team');
  });
  it('/arcade posts the game; /arcade@OtherBot is ignored', async () => {
    await webhook({ message: { text: '/arcade', chat: GROUP, from: dara } });
    expect(world.sent.find(s => s.method === 'sendGame').body).toMatchObject({ chat_id: GROUP.id, game_short_name: 'arcade' });
    world.sent.length = 0;
    await webhook({ message: { text: '/arcade@OtherBot', chat: GROUP, from: dara } });
    expect(world.sent.some(s => s.method === 'sendGame')).toBe(false);
    await webhook({ message: { text: '/arcade@TeamArcadeBot', chat: GROUP, from: dara } });
    expect(world.sent.some(s => s.method === 'sendGame')).toBe(true);
  });
  it('/board shows an empty week nicely', async () => {
    await webhook({ message: { text: '/board', chat: GROUP, from: dara } });
    expect(world.sent.find(s => s.method === 'sendMessage').body.text).toMatch(/No scores yet/);
  });
});

describe('scores', () => {
  it('saves a run to GitHub JSON on the scores branch and announces #1', async () => {
    const { t } = await tapPlay(dara);
    world.sent.length = 0;
    const r = await playRun(t, 'reaction', 8000, 31, { hits: 30, avgMs: 412 });
    expect(r.data.status).toBe('saved');
    const file = world.read(weekPath(GROUP.id, weekKey(new Date(NOW))));
    expect(file.games.reaction.entries['tg-11']).toMatchObject({ name: 'Dara S.', score: 8000, meta: { hits: 30, avgMs: 412 } });
    expect(world.sent.find(s => s.method === 'sendMessage').body.text).toMatch(/Dara S\..*#1.*Reaction Tap/);
  });

  it('keeps only the best; worse runs say notBest and are not written', async () => {
    const { t } = await tapPlay(dara);
    await playRun(t, 'memory', 40.2, 45);
    const shaBefore = world.files.get(weekPath(GROUP.id, '2026-W47')).sha;
    expect((await playRun(t, 'memory', 55, 60)).data.status).toBe('notBest');
    expect(world.files.get(weekPath(GROUP.id, '2026-W47')).sha).toBe(shaBefore);
    expect((await playRun(t, 'memory', 30.5, 35)).data.status).toBe('saved');
  });

  it('rejects runs that are too fast, impossible or unverified', async () => {
    const { t } = await tapPlay(dara);
    expect((await playRun(t, 'reaction', 8000, 3)).data.status).toBe('rejected');
    expect((await playRun(t, 'reaction', 99999, 31)).data.status).toBe('rejected');
    expect((await playRun(t, 'typing', 80, 60, { accuracy: 70 })).data.status).toBe('rejected');
    const other = await tapPlay(sokha);
    const { data } = await call('POST', '/run', { t: other.t, game: 'reaction' });
    clock += 31000;
    const stolen = await call('POST', '/score', { t, run: data.run, game: 'reaction', score: 9000 });
    expect(stolen.data.status).toBe('rejected');
    expect((await call('POST', '/score', { t: 'garbage', run: 'x', game: 'reaction', score: 1 })).status).toBe(401);
  });

  it('two players finishing at the same moment are both saved', async () => {
    const a = await tapPlay(dara), b = await tapPlay(sokha);
    const [ra, rb] = await Promise.all([call('POST', '/run', { t: a.t, game: 'shooter' }), call('POST', '/run', { t: b.t, game: 'shooter' })]);
    clock += 120000;
    const [sa, sb] = await Promise.all([
      call('POST', '/score', { t: a.t, run: ra.data.run, game: 'shooter', score: 12000 }),
      call('POST', '/score', { t: b.t, run: rb.data.run, game: 'shooter', score: 9000 }),
    ]);
    expect([sa.data.status, sb.data.status]).toEqual(['saved', 'saved']);
    expect(Object.keys(world.read(weekPath(GROUP.id, '2026-W47')).games.shooter.entries).sort()).toEqual(['tg-11', 'tg-22']);
  });

  it('/board on the web and in chat shows the champion', async () => {
    const a = await tapPlay(dara), b = await tapPlay(sokha);
    await playRun(a.t, 'reaction', 8000, 31);
    await playRun(b.t, 'reaction', 6000, 31);
    await playRun(b.t, 'typing', 70, 60, { accuracy: 97 });
    const web = await call('GET', `/board?t=${encodeURIComponent(a.t)}`);
    expect(web.data.week).toBe('2026-W47');
    expect(web.data.lastWeek).toBe('2026-W46');
    expect(Object.keys(web.data.boards.reaction.entries)).toHaveLength(2);
    world.sent.length = 0;
    await webhook({ message: { text: '/board', chat: GROUP, from: dara } });
    const text = world.sent.find(s => s.method === 'sendMessage').body.text;
    expect(text).toMatch(/🥇 Sokha · 18 pts/); // 8 (2nd reaction) + 10 (1st typing)
    expect(text).toMatch(/Dara S\. · 10 pts/);
  });

  it('groups have separate boards', async () => {
    const a = await tapPlay(dara);
    const other = await tapPlay(dara, { id: -100999, type: 'group', title: 'Other' });
    await playRun(a.t, 'reaction', 8000, 31);
    const web = await call('GET', `/board?t=${encodeURIComponent(other.t)}`);
    expect(web.data.boards.reaction.entries).toEqual({});
  });
});

describe('Monday results and setup', () => {
  it('posts last week\'s results to every known group', async () => {
    const a = await tapPlay(dara);
    await playRun(a.t, 'reaction', 8000, 31);
    world.sent.length = 0;
    clock = Date.parse('2026-11-23T01:30:00Z'); // Monday 08:30 in Cambodia
    await worker.scheduled({}, ENV, ctx); await settle();
    const msg = world.sent.find(s => s.method === 'sendMessage');
    expect(msg.body.chat_id).toBe(GROUP.id);
    expect(msg.body.text).toMatch(/Final results · Week 47/);
    expect(msg.body.text).toMatch(/Congratulations <b>Dara S\.<\/b>/);
  });
  it('setup needs the secret, creates the scores branch and sets the webhook', async () => {
    expect((await call('GET', '/setup?key=wrong')).status).toBe(403);
    const r = await call('GET', `/setup?key=${ENV.ARCADE_SECRET}`);
    expect(r.data).toMatchObject({ ok: true, scoresBranch: 'created', bot: '@TeamArcadeBot' });
    expect(world.refs.get('scores')).toBe('mainsha');
    const hook = world.sent.find(s => s.method === 'setWebhook').body;
    expect(hook).toMatchObject({ url: `${ORIGIN}/telegram`, secret_token: keys.webhookSecret });
  });
});

describe('text helpers', () => {
  it('names and announcements', () => {
    expect(displayName({ id: 5, first_name: 'Dara', last_name: 'Sok' })).toBe('Dara S.');
    expect(displayName({ id: 123456, username: 'x' })).toBe('x');
    expect(announcement('reaction', 'A', null, { place: 1, score: 10 })).toMatch(/#1/);
    expect(announcement('reaction', 'A', { place: 1 }, { place: 1, score: 10 })).toBeNull();
    expect(announcement('reaction', 'A', { place: 5 }, { place: 3, score: 10 })).toMatch(/#3/);
    expect(announcement('reaction', 'A', { place: 5 }, { place: 3, score: 10 }, 'first')).toBeNull();
    expect(announcement('reaction', '<b>', null, { place: 1, score: 1 })).toMatch(/&lt;b&gt;/);
  });
  it('board text escapes names', () => {
    const wk = { games: { reaction: { entries: { a: { name: '<script>', score: 5, at: '1' } } } } };
    expect(boardText(wk, '2026-W47')).not.toMatch(/<script>/);
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { createHandler } from '../telegram/app.js';
import { PartyRoom } from '../telegram/party-room.js';
import { deriveKeys, verify } from '../telegram/token.js';
import { join, timelineFor } from '../src/party/rules.js';

const ENV = { BOT_TOKEN: '1:x', DATA_TOKEN: 'g', ARCADE_SECRET: 'a-very-long-test-secret-123', GITHUB_REPO: 'me/repo', DATA_BRANCH: 'scores', GAME_URL: 'https://me.github.io/repo/', GAME_SHORT_NAME: 'arcade' };
const GROUP = { id: -100555, type: 'supergroup', title: 'Team' };
let clock, sent, rooms, env, worker, keys;

// Minimal stand-ins for Telegram, GitHub and the Durable Object runtime.
function fakeWs(key, name) {
  return { key, name, inbox: [], send(d) { this.inbox.push(JSON.parse(d)); }, deserializeAttachment() { return { key, name }; }, close() {} };
}
function makeRoomNamespace() {
  const map = new Map();
  return {
    idFromName: n => n,
    get(id) {
      if (!map.has(id)) {
        const store = new Map(); let alarm = null; const sockets = [];
        const ctx = {
          storage: { get: async k => structuredClone(store.get(k)), put: async (k, v) => { store.set(k, structuredClone(v)); }, setAlarm: async t => { alarm = t; } },
          getWebSockets: () => sockets, acceptWebSocket: ws => sockets.push(ws),
        };
        const obj = new PartyRoom(ctx, env, { now: () => clock, fetch: fakeFetch });
        map.set(id, { obj, sockets, alarm: () => alarm, fetch: (url, init) => obj.fetch(new Request(url, init)) });
      }
      return map.get(id);
    },
    map,
  };
}
async function fakeFetch(url, init = {}) {
  const u = new URL(url);
  if (u.hostname === 'api.telegram.org') {
    const method = u.pathname.split('/').pop();
    sent.push({ method, body: init.body ? JSON.parse(init.body) : {} });
    const result = method === 'getMe' ? { username: 'TeamArcadeBot' } : method === 'sendGame' ? { message_id: 777 } : true;
    return new Response(JSON.stringify({ ok: true, result }));
  }
  return new Response(JSON.stringify({}), { status: 404 }); // GitHub: nothing stored
}

const ctx = { waitUntil: p => p.catch(() => {}) };
async function webhook(update) {
  await worker.fetch(new Request('https://w.dev/telegram', { method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': keys.webhookSecret }, body: JSON.stringify(update) }), env, ctx);
}
const lastText = () => [...sent].reverse().find(s => s.method === 'sendMessage')?.body.text;

beforeEach(async () => {
  clock = Date.parse('2026-11-19T05:00:00Z'); sent = [];
  env = { ...ENV }; rooms = makeRoomNamespace(); env.PARTY = rooms;
  worker = createHandler({ fetch: fakeFetch, now: () => clock });
  keys = await deriveKeys(ENV.ARCADE_SECRET);
});

describe('live party', () => {
  it('/party posts a join card, a second /party says one is already on', async () => {
    await webhook({ message: { text: '/party reaction', chat: GROUP, from: { id: 1, first_name: 'Dara' } } });
    const card = sent.find(s => s.method === 'sendGame').body;
    expect(card.reply_markup.inline_keyboard[0][0]).toEqual({ text: '⚡ Join the party', callback_game: {} });
    expect(lastText()).toMatch(/Starts in 60 seconds/);
    await webhook({ message: { text: '/party reaction', chat: GROUP, from: { id: 1, first_name: 'Dara' } } });
    expect(lastText()).toMatch(/already on/);
    expect(sent.filter(s => s.method === 'sendGame')).toHaveLength(1);
  });

  it('Join on the party card gives a party link; Play on a normal card does not', async () => {
    await webhook({ message: { text: '/party reaction', chat: GROUP, from: { id: 1, first_name: 'Dara' } } });
    sent.length = 0;
    await webhook({ callback_query: { id: 'q', from: { id: 2, first_name: 'Sokha' }, game_short_name: 'arcade', message: { chat: GROUP, message_id: 777 } } });
    const url = new URL(sent.find(s => s.method === 'answerCallbackQuery').body.url);
    const h = new URLSearchParams(url.hash.slice(1));
    expect(h.get('party')).toBe('1');
    expect((await verify(keys.tokenKey, h.get('t'), clock)).p).toMatch(/^[0-9a-f]{8}$/);
    sent.length = 0;
    await webhook({ callback_query: { id: 'q2', from: { id: 2, first_name: 'Sokha' }, game_short_name: 'arcade', message: { chat: GROUP, message_id: 12 } } });
    expect(new URL(sent.find(s => s.method === 'answerCallbackQuery').body.url).hash).not.toMatch(/party/);
  });

  it('cancels with fewer than 2 players', async () => {
    await webhook({ message: { text: '/party reaction', chat: GROUP, from: { id: 1, first_name: 'Dara' } } });
    const r = rooms.get(String(GROUP.id));
    join(r.obj.party, { key: 'tg-1', name: 'Dara' }, clock);
    clock = r.alarm(); await r.obj.alarm();
    expect(r.obj.party.status).toBe('cancelled');
    expect(lastText()).toMatch(/only <b>Dara<\/b> joined/);
  });

  it('plays a full round: first tap wins, everyone sees it, results posted', async () => {
    await webhook({ message: { text: '/party reaction', chat: GROUP, from: { id: 1, first_name: 'Dara' } } });
    const r = rooms.get(String(GROUP.id));
    const a = fakeWs('tg-1', 'Dara'), b = fakeWs('tg-2', 'Sokha');
    r.sockets.push(a, b);
    join(r.obj.party, { key: 'tg-1', name: 'Dara' }, clock); join(r.obj.party, { key: 'tg-2', name: 'Sokha' }, clock);
    clock = r.alarm(); await r.obj.alarm();
    expect(r.obj.party.status).toBe('running');
    expect(a.inbox.at(-1).party.status).toBe('running');

    const tl = timelineFor(r.obj.party);
    const real = tl.map((t, i) => [t, i]).filter(([t]) => !t.fake).slice(0, 3);
    for (const [tg, i] of real) {
      clock = r.obj.party.startAt + (tg.t + 0.35) * 1000;
      await r.obj.webSocketMessage(a, JSON.stringify({ type: 'hit', i, age: 0.3 }));
      await r.obj.webSocketMessage(b, JSON.stringify({ type: 'hit', i, age: 0.32 }));
    }
    expect(b.inbox.filter(m => m.type === 'taken')).toHaveLength(3);
    const ev = b.inbox.find(m => m.type === 'event' && m.kind === 'hit');
    expect(ev).toMatchObject({ name: 'Dara', points: expect.any(Number) });

    clock = r.alarm(); await r.obj.alarm();
    expect(r.obj.party.status).toBe('done');
    expect(lastText()).toMatch(/Reaction Tap Party results/);
    expect(lastText()).toMatch(/🥇 <b>Dara<\/b>/);
    expect(lastText()).toMatch(/Dara<\/b> wins the party/);
  });

  it('ping gets the server time back (for clock sync)', async () => {
    await webhook({ message: { text: '/party reaction', chat: GROUP, from: { id: 1, first_name: 'Dara' } } });
    const r = rooms.get(String(GROUP.id));
    const a = fakeWs('tg-1', 'Dara');
    await r.obj.webSocketMessage(a, JSON.stringify({ type: 'ping', c: 123 }));
    expect(a.inbox[0]).toEqual({ type: 'pong', c: 123, s: clock });
  });

  it('/party asks which game; tapping a choice opens that party', async () => {
    await webhook({ message: { text: '/party', chat: GROUP, from: { id: 1, first_name: 'Dara' } } });
    const picker = sent.find(s => s.method === 'sendMessage').body;
    expect(picker.text).toMatch(/Pick a party game/);
    expect(picker.reply_markup.inline_keyboard[0].map(b => b.callback_data)).toEqual(['party:reaction', 'party:battle']);
    sent.length = 0;
    await webhook({ callback_query: { id: 'p1', from: { id: 2, first_name: 'Sokha' }, data: 'party:battle', message: { chat: GROUP, message_id: 50 } } });
    expect(sent.find(s => s.method === 'editMessageText').body.text).toMatch(/Sokha<\/b> picked <b>🚀 Ship Battle/);
    expect(sent.find(s => s.method === 'sendGame').body.reply_markup.inline_keyboard[0][0].text).toBe('🚀 Join the party');
    expect(lastText()).toMatch(/Ship Battle Party!.*lasts 90 seconds/s);
    expect(sent.find(s => s.method === 'answerCallbackQuery').body.text).toMatch(/party on/);
    const r = rooms.get(String(GROUP.id));
    expect(r.obj.party.game).toBe('battle');
    sent.length = 0;
    await webhook({ callback_query: { id: 'p2', from: { id: 3, first_name: 'Navin' }, data: 'party:reaction', message: { chat: GROUP, message_id: 51 } } });
    expect(lastText()).toMatch(/Ship Battle<\/b> party is already on/);
    expect(r.obj.party.game).toBe('battle');
  });

  it('plays a Ship Battle: the room runs the arena, players shoot, KOs decide the winner', async () => {
    await webhook({ message: { text: '/party battle', chat: GROUP, from: { id: 1, first_name: 'Dara' } } });
    const r = rooms.get(String(GROUP.id));
    const a = fakeWs('tg-1', 'Dara'), b = fakeWs('tg-2', 'Sokha');
    r.sockets.push(a, b);
    join(r.obj.party, { key: 'tg-1', name: 'Dara' }, clock); join(r.obj.party, { key: 'tg-2', name: 'Sokha' }, clock);
    clock = r.alarm(); await r.obj.alarm();
    expect(r.obj.party.status).toBe('running');
    expect(r.obj.ticker).toBeTruthy();
    // put the two ships face to face in the open and let the arena run (fast-forward the ticks by hand)
    const sim = r.obj.battle; sim.blocks = [];
    Object.assign(sim.ships['tg-1'], { x: 200, y: 270, a: 0, inv: 0, fireCd: 0 });
    Object.assign(sim.ships['tg-2'], { x: 420, y: 270, a: Math.PI, inv: 0, fireCd: 9 });
    await r.obj.webSocketMessage(b, JSON.stringify({ type: 'input', mx: 0, my: 0 }));
    const { step } = await import('../src/party/battle.js');
    for (let i = 0; i < 80; i++) { step(sim, 0.05); sim.ships['tg-2'].fireCd = 9; sim.ships['tg-2'].x = 420; sim.ships['tg-2'].y = 270; }
    expect(sim.ships['tg-1'].kos).toBeGreaterThanOrEqual(1);
    clock = r.alarm(); await r.obj.alarm();
    expect(r.obj.ticker).toBeNull();
    expect(r.obj.party.status).toBe('done');
    expect(lastText()).toMatch(/🚀 <b>Ship Battle Party results/);
    expect(lastText()).toMatch(/🥇 <b>Dara<\/b> · \d+ KOs? · knocked out 0×/);
  });

  it('/party in a private chat explains it is for groups', async () => {
    await webhook({ message: { text: '/party', chat: { id: 5, type: 'private' }, from: { id: 5, first_name: 'Dara' } } });
    expect(lastText()).toMatch(/for groups/);
  });
});

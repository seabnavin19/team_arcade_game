import { describe, it, expect, beforeEach } from 'vitest';
import { MusicRoom } from '../telegram/music-room.js';
import { MESSAGES, IDLE_CLEAR_MS } from '../src/music/rules.js';

const LINK = id => `https://youtu.be/${id}`;
const SONG_A = 'aaaaaaaaaaa', SONG_B = 'bbbbbbbbbbb', BLOCKED = 'blockedXXXX';
let clock, sent, env;

function fakeWs(key, name) {
  return { key, name, inbox: [], send(d) { this.inbox.push(JSON.parse(d)); }, deserializeAttachment() { return { key, name }; }, serializeAttachment() {}, close() {} };
}
const last = (ws, type) => [...ws.inbox].reverse().find(m => m.type === type);

async function fakeFetch(url, init = {}) {
  const u = new URL(url);
  if (u.hostname === 'api.telegram.org') {
    sent.push({ method: u.pathname.split('/').pop(), body: JSON.parse(init.body || '{}') });
    return new Response(JSON.stringify({ ok: true, result: true }));
  }
  if (u.hostname === 'www.youtube.com' && u.pathname === '/oembed') {
    const id = new URL(u.searchParams.get('url')).searchParams.get('v');
    if (id === BLOCKED) return new Response('Unauthorized', { status: 401 });
    if (id === 'downXXXXXXX') return new Response('oops', { status: 503 });
    return new Response(JSON.stringify({ title: id === SONG_A ? 'Song A' : 'Song B' }));
  }
  return new Response('not found', { status: 404 });
}

// One room with its own storage and sockets; `restart()` simulates eviction.
function makeRoom() {
  const store = new Map(); let alarm = null; const sockets = [];
  const ctx = {
    storage: {
      get: async k => structuredClone(store.get(k)), put: async (k, v) => { store.set(k, structuredClone(v)); },
      setAlarm: async t => { alarm = t; }, deleteAlarm: async () => { alarm = null; },
    },
    getWebSockets: () => sockets, acceptWebSocket: ws => sockets.push(ws),
  };
  const r = {
    obj: new MusicRoom(ctx, env, { now: () => clock, fetch: fakeFetch }),
    alarm: () => alarm,
    restart() { r.obj = new MusicRoom(ctx, env, { now: () => clock, fetch: fakeFetch }); },
    // Connect a listener. The fake runtime has no WebSocketPair, so the room's
    // connect step is called directly with a fake socket.
    async join(key, name) { const ws = fakeWs(key, name); await r.obj.connect(ws, { key, name }); return ws; },
    async leave(ws) { sockets.splice(sockets.indexOf(ws), 1); await r.obj.webSocketClose(ws, 1000); },
    say: (ws, msg) => r.obj.webSocketMessage(ws, JSON.stringify(msg)),
    http: (path, body) => r.obj.fetch(new Request(`https://music${path}`, body ? { method: 'POST', body: JSON.stringify(body) } : undefined)).then(res => res.json()),
  };
  return r;
}

beforeEach(() => {
  clock = Date.parse('2026-11-21T05:00:00Z'); sent = [];
  env = { BOT_TOKEN: '1:x', MUSIC_ANNOUNCE: 'off' };
});

describe('music room', () => {
  it('adding a link starts it for everyone, with its title and who added it', async () => {
    const r = makeRoom();
    const a = await r.join('tg-1', 'Dara'), b = await r.join('tg-2', 'Sokha');
    await r.say(a, { type: 'add', url: LINK(SONG_A) });
    for (const ws of [a, b]) {
      const s = last(ws, 'state');
      expect(s.music.now.title).toBe('Song A');
      expect(s.music.now.addedBy.name).toBe('Dara');
      expect(s.listeners.map(l => l.name)).toEqual(['Dara', 'Sokha']);
    }
    expect(a.inbox.find(m => m.type === 'state').you).toBe('tg-1');
  });

  it('rejects blocked videos and non-links, only telling the sender', async () => {
    const r = makeRoom();
    const a = await r.join('tg-1', 'Dara'), b = await r.join('tg-2', 'Sokha');
    await r.say(a, { type: 'add', url: LINK(BLOCKED) });
    expect(last(a, 'notice').text).toBe(MESSAGES.blocked);
    await r.say(a, { type: 'add', url: 'hello' });
    expect(last(a, 'notice').text).toBe(MESSAGES.notLink);
    expect(last(b, 'notice')).toBeUndefined();
    expect(last(b, 'state').music.now).toBeNull();
  });

  it('accepts a link with a fallback title when YouTube cannot be reached', async () => {
    const r = makeRoom();
    const a = await r.join('tg-1', 'Dara');
    await r.say(a, { type: 'add', url: LINK('downXXXXXXX') });
    expect(last(a, 'state').music.now.title).toBe('YouTube video');
  });

  it('moves on when the song-end alarm fires, then goes idle', async () => {
    const r = makeRoom();
    const a = await r.join('tg-1', 'Dara');
    await r.say(a, { type: 'add', url: LINK(SONG_A) });
    await r.say(a, { type: 'add', url: LINK(SONG_B) });
    const id = last(a, 'state').music.now.id;
    await r.say(a, { type: 'duration', id, seconds: 200 });
    expect(r.alarm()).toBe(clock + 202_000);
    clock = r.alarm(); await r.obj.alarm();
    expect(last(a, 'state').music.now.title).toBe('Song B');
    await r.say(a, { type: 'duration', id: last(a, 'state').music.now.id, seconds: 100 });
    clock = r.alarm(); await r.obj.alarm();
    expect(last(a, 'state').music.now).toBeNull();
    expect(r.alarm()).toBeNull();
  });

  it('skips a song longer than 15 minutes with a notice to everyone', async () => {
    const r = makeRoom();
    const a = await r.join('tg-1', 'Dara'), b = await r.join('tg-2', 'Sokha');
    await r.say(a, { type: 'add', url: LINK(SONG_A) });
    await r.say(b, { type: 'duration', id: last(b, 'state').music.now.id, seconds: 3600 });
    expect(last(b, 'notice').text).toBe(MESSAGES.tooLong('Song A'));
    expect(last(b, 'state').music.now).toBeNull();
  });

  it('skips for everyone when a player cannot play the song', async () => {
    const r = makeRoom();
    const a = await r.join('tg-1', 'Dara'), b = await r.join('tg-2', 'Sokha');
    await r.say(a, { type: 'add', url: LINK(SONG_A) });
    await r.say(b, { type: 'unplayable', id: last(b, 'state').music.now.id, code: 150 });
    expect(last(a, 'notice').text).toBe(MESSAGES.unplayable('Song A'));
    expect(last(a, 'state').music.now).toBeNull();
  });

  it('counts one person with two tabs as one listener', async () => {
    const r = makeRoom();
    await r.join('tg-1', 'Dara');
    const a2 = await r.join('tg-1', 'Dara');
    expect(last(a2, 'state').listeners).toHaveLength(1);
  });

  it('pause and resume apply to everyone', async () => {
    const r = makeRoom();
    const a = await r.join('tg-1', 'Dara'), b = await r.join('tg-2', 'Sokha');
    await r.say(a, { type: 'add', url: LINK(SONG_A) });
    clock += 30_000; await r.say(b, { type: 'pause' });
    expect(last(a, 'state').music).toMatchObject({ paused: true, position: 30 });
    clock += 60_000; await r.say(a, { type: 'resume' });
    clock += 5000; await r.say(a, { type: 'ping', c: 1 });
    expect(last(b, 'state').music.paused).toBe(false);
  });

  it('a listener leaving can complete a skip vote', async () => {
    const r = makeRoom();
    const a = await r.join('tg-1', 'Dara'), b = await r.join('tg-2', 'Sokha'), c = await r.join('tg-3', 'Vanna');
    await r.say(a, { type: 'add', url: LINK(SONG_A) });
    await r.say(a, { type: 'add', url: LINK(SONG_B) });
    await r.say(b, { type: 'skip' });
    expect(last(c, 'state').music).toMatchObject({ votes: 1 });
    expect(last(c, 'state').music.now.title).toBe('Song A');
    await r.leave(c); // 2 listeners left, 1 vote is enough
    expect(last(a, 'state').music.now.title).toBe('Song B');
  });

  it('only the adder can remove a waiting song', async () => {
    const r = makeRoom();
    const a = await r.join('tg-1', 'Dara'), b = await r.join('tg-2', 'Sokha');
    await r.say(a, { type: 'add', url: LINK(SONG_A) });
    await r.say(a, { type: 'add', url: LINK(SONG_B) });
    const waiting = last(a, 'state').music.queue[0].id;
    await r.say(b, { type: 'remove', id: waiting });
    expect(last(a, 'state').music.queue).toHaveLength(1);
    await r.say(a, { type: 'remove', id: waiting });
    expect(last(b, 'state').music.queue).toHaveLength(0);
  });

  it('pauses when the last person leaves, clears after a day', async () => {
    const r = makeRoom();
    const a = await r.join('tg-1', 'Dara');
    await r.say(a, { type: 'add', url: LINK(SONG_A) });
    clock += 40_000;
    await r.leave(a);
    expect(r.alarm()).toBe(clock + IDLE_CLEAR_MS);
    clock = r.alarm(); await r.obj.alarm();
    const back = await r.join('tg-1', 'Dara');
    expect(last(back, 'state').music.now).toBeNull();
  });

  it('picks up at the right spot after the room restarts', async () => {
    const r = makeRoom();
    const a = await r.join('tg-1', 'Dara');
    await r.say(a, { type: 'add', url: LINK(SONG_A) });
    clock += 75_000;
    r.restart();
    const b = await r.join('tg-2', 'Sokha');
    expect(last(b, 'state').music).toMatchObject({ position: 75, paused: false });
  });

  it('remembers music cards', async () => {
    const r = makeRoom();
    await r.http('/set-card', { chat: -100, messageId: 5 });
    expect(await r.http('/is-card?messageId=5')).toEqual({ card: true });
    expect(await r.http('/is-card?messageId=6')).toEqual({ card: false });
  });

  it('announces songs in the group only when turned on', async () => {
    const r = makeRoom();
    await r.http('/set-card', { chat: -100, messageId: 5 });
    const a = await r.join('tg-1', 'Dara');
    await r.say(a, { type: 'add', url: LINK(SONG_A) });
    expect(sent.filter(s => s.method === 'sendMessage')).toHaveLength(0);

    env.MUSIC_ANNOUNCE = 'now-playing';
    await r.say(a, { type: 'add', url: LINK(SONG_B) });
    await r.say(a, { type: 'skip' });
    const msg = sent.find(s => s.method === 'sendMessage').body;
    expect(msg).toMatchObject({ chat_id: -100, parse_mode: 'HTML', text: '🎵 Now playing: <b>Song B</b> (added by Dara)' });
  });
});

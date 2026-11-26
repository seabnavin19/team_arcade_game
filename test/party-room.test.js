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
        obj.ensureBots = () => {}; // no background bot timer in tests: a test drives the bots itself (botTick / liveTick)
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
    const body = init.body instanceof FormData
      ? Object.fromEntries([...init.body.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : { file: v.name, type: v.type, size: v.size }]))
      : init.body ? JSON.parse(init.body) : {};
    sent.push({ method, body });
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

  it('one player gets 3 bots; nobody at all cancels', async () => {
    await webhook({ message: { text: '/party reaction', chat: GROUP, from: { id: 1, first_name: 'Dara' } } });
    expect(lastText()).toMatch(/Bots fill the empty seats, so you can even play alone/);
    const r = rooms.get(String(GROUP.id));
    const a = fakeWs('tg-1', 'Dara');
    r.sockets.push(a);
    join(r.obj.party, { key: 'tg-1', name: 'Dara' }, clock);
    clock = r.alarm(); await r.obj.alarm();
    r.obj.stopBots();
    expect(r.obj.party.status).toBe('running');
    const players = a.inbox.findLast(m => m.type === 'state').party.players;
    expect(players).toHaveLength(4);
    expect(players.filter(x => x.bot).map(x => x.name)).toEqual([expect.stringMatching(/^🤖 /), expect.stringMatching(/^🤖 /), expect.stringMatching(/^🤖 /)]);
    // the bots tap targets like players do (a little slower than a quick human)
    const tl = timelineFor(r.obj.party);
    r.obj.botDone = new Set();
    for (let t = 0; t < 12; t += 0.1) { clock = r.obj.party.startAt + t * 1000; await r.obj.botTick(); }
    expect(a.inbox.some(m => m.type === 'event' && m.kind === 'hit' && m.key.startsWith('bot-'))).toBe(true);
    expect(Object.keys(r.obj.party.claimed).length).toBeGreaterThan(0);
    expect(tl.length).toBeGreaterThan(10);

    await webhook({ message: { text: '/party reaction', chat: { ...GROUP, id: -100777 }, from: { id: 1, first_name: 'Dara' } } });
    const empty = rooms.get('-100777');
    clock = empty.alarm(); await empty.obj.alarm();
    expect(empty.obj.party.status).toBe('cancelled');
    expect(lastText()).toMatch(/nobody joined/);
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

  it('Start now moves the start up and re-arms the timer for everyone', async () => {
    await webhook({ message: { text: '/party battle', chat: GROUP, from: { id: 1, first_name: 'Dara' } } });
    const r = rooms.get(String(GROUP.id));
    const a = fakeWs('tg-1', 'Dara'), b = fakeWs('tg-2', 'Sokha');
    r.sockets.push(a, b);
    join(r.obj.party, { key: 'tg-1', name: 'Dara' }, clock);
    join(r.obj.party, { key: 'tg-2', name: 'Sokha' }, clock);
    clock += 5000;
    await r.obj.webSocketMessage(b, JSON.stringify({ type: 'start-now' }));
    expect(r.alarm()).toBe(clock + 3000);
    expect(a.inbox.at(-1).party).toMatchObject({ startAt: clock + 3000, startedBy: 'Sokha' });
    clock = r.alarm(); await r.obj.alarm();
    expect(r.obj.party.status).toBe('running');
    r.obj.stopBattle();
  });

  it('plays a Brain Race: questions arrive without answers, reveals score the fastest and first', async () => {
    await webhook({ message: { text: '/party iq', chat: GROUP, from: { id: 1, first_name: 'Dara' } } });
    const r = rooms.get(String(GROUP.id));
    expect(r.obj.party.game).toBe('quiz');
    const a = fakeWs('tg-1', 'Dara'), b = fakeWs('tg-2', 'Sokha');
    r.sockets.push(a, b);
    join(r.obj.party, { key: 'tg-1', name: 'Dara' }, clock); join(r.obj.party, { key: 'tg-2', name: 'Sokha' }, clock);
    clock = r.alarm(); await r.obj.alarm();
    r.obj.stopQuiz(); // drive the clock by hand instead of real timers
    const q = a.inbox.find(m => m.type === 'question');
    expect(q).toMatchObject({ i: 0, n: 8, options: expect.any(Array) });
    expect(q).not.toHaveProperty('correct');
    const right = r.obj.quiz[0].correct;
    clock += 1500; await r.obj.webSocketMessage(b, JSON.stringify({ type: 'answer', i: 0, c: right }));
    clock += 1500; await r.obj.webSocketMessage(a, JSON.stringify({ type: 'answer', i: 0, c: (right + 1) % 4 }));
    expect(b.inbox.at(-1)).toMatchObject({ type: 'answered', count: 2, of: 4 }); // 2 people + 2 bots
    clock = r.obj.party.startAt + 10500; r.obj.quizTick();
    const rev = a.inbox.find(m => m.type === 'reveal');
    expect(rev).toMatchObject({ i: 0, correct: right, firstName: 'Sokha' });
    expect(rev.answers['tg-2']).toMatchObject({ ok: true, first: true });
    expect(rev.answers['tg-1']).toMatchObject({ ok: false, pts: 0 });
    clock = r.obj.party.startAt + 13200; r.obj.quizTick();
    expect(a.inbox.filter(m => m.type === 'question').at(-1).i).toBe(1);
    clock = r.alarm(); await r.obj.alarm();
    expect(lastText()).toMatch(/💡 <b>Brain Race Party results/);
    expect(lastText()).toMatch(/🥇 <b>Sokha<\/b> · [\d,]+ \(1\/8 right\)/);
  });

  it('plays a Snake Arena: turns go to the right snake, crashes score, results posted', async () => {
    await webhook({ message: { text: '/party snake', chat: GROUP, from: { id: 1, first_name: 'Dara' } } });
    const r = rooms.get(String(GROUP.id));
    expect(r.obj.party.game).toBe('snake');
    const a = fakeWs('tg-1', 'Dara'), b = fakeWs('tg-2', 'Sokha');
    r.sockets.push(a, b);
    join(r.obj.party, { key: 'tg-1', name: 'Dara' }, clock); join(r.obj.party, { key: 'tg-2', name: 'Sokha' }, clock);
    clock = r.alarm(); await r.obj.alarm();
    expect(r.obj.ticker).toBeTruthy();
    expect(a.inbox.at(-1)).toMatchObject({ type: 'snap', who: ['tg-1', 'tg-2', 'bot-1', 'bot-2'] });
    const { step } = await import('../src/party/snake.js');
    const g = r.obj.battle; g.food = [];
    for (const k of ['bot-1', 'bot-2']) Object.assign(g.snakes[k], { alive: false, respawn: 999 }); // bots off the board for this crash test
    Object.assign(g.snakes['tg-1'], { body: [[10, 9], [9, 9], [8, 9], [7, 9]], dir: 'right', queue: [] });
    Object.assign(g.snakes['tg-2'], { body: [[11, 12], [11, 11], [11, 10], [11, 9], [11, 8]], dir: 'down', queue: [] });
    await r.obj.webSocketMessage(b, JSON.stringify({ type: 'dir', d: 'left' })); // Sokha turns away from the wall
    step(g);
    expect(g.snakes['tg-1'].alive).toBe(false);
    expect(g.snakes['tg-2']).toMatchObject({ kos: 1, score: 5 });
    clock = r.alarm(); await r.obj.alarm();
    expect(r.obj.ticker).toBeNull();
    expect(lastText()).toMatch(/🐍 <b>Snake Arena Party results/);
    expect(lastText()).toMatch(/🥇 <b>Sokha<\/b> · 5 pts · 0 food · 1 KO/);
  });

  it('plays Draw & Guess: only the artist sees the word and draws; guesses score; rounds rotate', async () => {
    await webhook({ message: { text: '/party draw', chat: GROUP, from: { id: 1, first_name: 'Dara' } } });
    const r = rooms.get(String(GROUP.id));
    expect(r.obj.party.game).toBe('draw');
    const a = fakeWs('tg-1', 'Dara'), b = fakeWs('tg-2', 'Sokha'), c = fakeWs('tg-3', 'Navin'), e = fakeWs('tg-4', 'Mony');
    r.sockets.push(a, b, c, e);
    join(r.obj.party, { key: 'tg-1', name: 'Dara' }, clock); join(r.obj.party, { key: 'tg-2', name: 'Sokha' }, clock + 1); join(r.obj.party, { key: 'tg-3', name: 'Navin' }, clock + 2); join(r.obj.party, { key: 'tg-4', name: 'Mony' }, clock + 3);
    clock = r.alarm(); await r.obj.alarm();
    r.obj.stopDraw(); // drive rounds by hand
    const d = r.obj.party.draw, word = d.words[0];
    expect(d.order).toHaveLength(3);
    const sock = { 'tg-1': a, 'tg-2': b, 'tg-3': c, 'tg-4': e };
    const artist = sock[d.order[0]], [g1, g2, g3] = Object.keys(sock).filter(k => k !== d.order[0]).map(k => sock[k]);
    const roundFor = ws => ws.inbox.filter(m => m.type === 'round').at(-1);
    expect(roundFor(artist)).toMatchObject({ i: 0, n: 3, artist: d.order[0], word });
    expect(roundFor(g1)).not.toHaveProperty('word');
    expect(roundFor(g1).mask.replace(/[ _]/g, '')).toBe('');

    // only the artist's strokes go out, to everyone else
    await r.obj.webSocketMessage(artist, JSON.stringify({ type: 'stroke', id: 1, c: '#ff0000', w: 6, pts: [10, 10, 50, 60, 90, 90] }));
    await r.obj.webSocketMessage(g1, JSON.stringify({ type: 'stroke', id: 9, c: '#00ff00', w: 6, pts: [1, 1, 2, 2] }));
    const drawn = ws => ws.inbox.filter(m => m.type === 'strokes').flatMap(m => m.ops).filter(o => o.t === 'stroke');
    expect(drawn(g1)).toHaveLength(1); expect(drawn(g1)[0].c).toBe('#ff0000');
    expect(drawn(artist)).toHaveLength(0); // the artist already has it on screen
    expect(d.strokes).toHaveLength(1);

    // wrong guesses are shown as chat; near misses only to the guesser; right ones score
    await r.obj.webSocketMessage(g1, JSON.stringify({ type: 'guess', text: 'definitely not it' }));
    expect(g2.inbox.at(-1)).toMatchObject({ type: 'chat', text: 'definitely not it' });
    const nearMiss = word.length >= 4 ? `${word.slice(0, -1)}${word.endsWith('q') ? 'z' : 'q'}` : null;
    if (nearMiss) {
      await r.obj.webSocketMessage(g2, JSON.stringify({ type: 'guess', text: nearMiss }));
      expect(g2.inbox.at(-1)).toMatchObject({ type: 'close-guess' });
      expect(g1.inbox.some(m => m.type === 'chat' && m.text === nearMiss)).toBe(false);
    }
    clock += 5000;
    await r.obj.webSocketMessage(g1, JSON.stringify({ type: 'guess', text: word.toUpperCase() }));
    expect(g1.inbox.find(m => m.type === 'you-guessed')).toMatchObject({ first: true, word });
    expect(g2.inbox.some(m => m.type === 'chat' && m.text.toLowerCase() === word)).toBe(false); // the answer never leaks into chat
    await r.obj.webSocketMessage(g2, JSON.stringify({ type: 'guess', text: word }));
    expect(artist.inbox.find(m => m.type === 'reveal')).toBeUndefined(); // one guesser still to go
    await r.obj.webSocketMessage(g3, JSON.stringify({ type: 'guess', text: word }));
    expect(artist.inbox.find(m => m.type === 'reveal')).toMatchObject({ i: 0, word });

    // round 2: the next artist gets the next word
    clock += 4500; await r.obj.drawTick(false);
    const next = sock[d.order[1]];
    expect(roundFor(next)).toMatchObject({ i: 1, artist: d.order[1], word: d.words[1] });
    // an absent artist's round is skipped after a few seconds
    r.sockets.splice(r.sockets.indexOf(next), 1);
    clock += 4500; await r.obj.drawTick(false);
    expect(g2.inbox.filter(m => m.type === 'reveal').concat(artist.inbox.filter(m => m.type === 'reveal')).some(m => m.i === 1 && m.skipped)).toBe(true);
    // round 3 runs out of time → results
    clock += 4500; await r.obj.drawTick(false);
    clock = d.roundEnd + 10; await r.obj.drawTick(false);
    clock += 4500; await r.obj.drawTick(false);
    expect(r.obj.party.status).toBe('done');
    expect(lastText()).toMatch(/🎨 <b>Draw & Guess Party results/);
    expect(lastText()).toMatch(/guessed 1 drawing/);
  });

  it('runs a Water Festival race: crew picks in the lobby, paddling on the beat, early finish, results posted', async () => {
    await webhook({ message: { text: '/party boat', chat: GROUP, from: { id: 1, first_name: 'Dara' } } });
    const r = rooms.get(String(GROUP.id));
    expect(r.obj.party.game).toBe('boat');
    const names = ['Dara', 'Sokha', 'Navin', 'Bopha'];
    const ws = names.map((n, i) => fakeWs(`tg-${i + 1}`, n));
    r.sockets.push(...ws);
    names.forEach((n, i) => join(r.obj.party, { key: `tg-${i + 1}`, name: n }, clock + i));
    // Dara and Sokha both pick Hanuman in the lobby
    await r.obj.webSocketMessage(ws[0], JSON.stringify({ type: 'crew', c: 1 }));
    await r.obj.webSocketMessage(ws[1], JSON.stringify({ type: 'crew', c: 1 }));
    expect(ws[2].inbox.at(-1).party.players.find(p => p.name === 'Dara').crew).toBe(1);
    clock = r.alarm(); await r.obj.alarm();
    clearInterval(r.obj.ticker); r.obj.ticker = null; // drive the race clock by hand
    const sim = r.obj.battle;
    expect(sim.mode).toBe('crews');
    expect(sim.boats.map(b => b.name)).toEqual(['Naga', 'Hanuman']);
    expect(sim.boats[1].members).toEqual(['tg-1', 'tg-2']);
    const { step } = await import('../src/party/boat.js');
    // Hanuman (Dara + Sokha) paddle on every beat together; Naga only tap now and then
    const done = new Set();
    for (let t = clock; t < clock + 95000 && !sim.over; t += 20) {
      for (const beat of sim.beats) for (const [i, w] of ws.entries()) {
        const id = `${i}@${beat.t}`;
        const keen = i < 2 || Math.round(beat.t / 600) % 3 === 0;
        if (keen && !done.has(id) && t >= beat.t + 25) { done.add(id); await r.obj.webSocketMessage(w, JSON.stringify({ type: 'paddle', t })); clock = t; }
      }
      clock = t; step(sim, t);
    }
    expect(sim.over).toBe(true);
    expect(ws[0].inbox.some(m => m.type === 'paddle-result' && m.q === 1)).toBe(true);
    await r.obj.finishParty();
    expect(r.obj.party.status).toBe('done');
    expect(r.obj.party.summary.boats[0].name).toBe('Hanuman');
    expect(lastText()).toMatch(/🚣 <b>Water Festival Boat Race<\/b> · 4 paddlers/);
    expect(lastText()).toMatch(/🥇 <b>Hanuman<\/b> \(Dara, Sokha\) · \d+\.\d s/);
    expect(lastText()).toMatch(/Hanuman<\/b> crew wins the race/);
    expect(lastText()).toMatch(/Best paddler: <b>(Dara|Sokha)<\/b>/);
    expect(lastText()).toMatch(/Best sync: <b>Hanuman<\/b>/);
  });

  it('runs a Firework Show: everyone draws, each firework is shown and rated, results posted', async () => {
    await webhook({ message: { text: '/party fireworks', chat: GROUP, from: { id: 1, first_name: 'Dara' } } });
    const r = rooms.get(String(GROUP.id));
    expect(r.obj.party.game).toBe('firework');
    const names = ['Dara', 'Sokha', 'Navin'];
    const ws = names.map((n, i) => fakeWs(`tg-${i + 1}`, n));
    r.sockets.push(...ws);
    names.forEach((n, i) => join(r.obj.party, { key: `tg-${i + 1}`, name: n }, clock + i));
    clock = r.alarm(); await r.obj.alarm();
    clearInterval(r.obj.ticker); r.obj.ticker = null; // drive the show clock by hand
    const sim = r.obj.battle;
    const { step, COLORS } = await import('../src/party/firework.js');
    const art = [{ c: COLORS[1], pts: [300, 200, 400, 120, 500, 200] }];
    clock += 5000;
    await r.obj.webSocketMessage(ws[0], JSON.stringify({ type: 'fw-submit', strokes: art }));
    await r.obj.webSocketMessage(ws[1], JSON.stringify({ type: 'fw-submit', strokes: art }));
    expect(ws[0].inbox.at(-1)).toEqual({ type: 'fw-saved', points: 3 });
    clock = sim.drawEnd + 2000; step(sim, clock);
    expect(sim.phase).toBe('show');
    await r.obj.webSocketMessage(ws[2], JSON.stringify({ type: 'fw-art', i: 0 }));
    expect(ws[2].inbox.at(-1)).toEqual({ type: 'fw-art', i: 0, art });
    const { renderFireworkGif, toBase64 } = await import('../src/party/firework-gif.js');
    r.obj.fireworkEvents(sim); // the first launch: the artist's screen is asked for the GIF
    const stars = { 'tg-1': 5, 'tg-2': 3 };
    while (!sim.over) {
      const artist = sim.order[sim.i];
      const w = ws[Number(artist.slice(3)) - 1];
      const ask = w.inbox.findLast(m => m.type === 'fw-render');
      expect(ask).toMatchObject({ i: sim.i, art });
      const data = toBase64(renderFireworkGif(ask.art, { seed: ask.seed }));
      await r.obj.webSocketMessage(ws[2], JSON.stringify({ type: 'fw-gif', i: sim.i, data: 'R0lGODlhAQ==' })); // not asked: ignored
      await r.obj.webSocketMessage(w, JSON.stringify({ type: 'fw-gif', i: sim.i, data }));
      for (const [i, x] of ws.entries()) if (`tg-${i + 1}` !== artist) await r.obj.webSocketMessage(x, JSON.stringify({ type: 'fw-rate', i: sim.i, stars: stars[artist] }));
      clock += 9000; step(sim, clock); r.obj.fireworkEvents(sim);
    }
    await r.obj.finishParty();
    const gifs = sent.filter(m => m.method === 'sendAnimation');
    expect(gifs).toHaveLength(2);
    expect(gifs[0].body.animation).toMatchObject({ file: 'firework.gif', type: 'image/gif' });
    expect(gifs[0].body.animation.size).toBeGreaterThan(20000);
    expect(gifs.map(g => g.body.caption)).toEqual(expect.arrayContaining([
      expect.stringMatching(/🎆 <b>Firework \d of 2<\/b> · by <b>Dara<\/b>\n★★★★★ 5\.0 from 2 ratings/),
      expect.stringMatching(/by <b>Sokha<\/b>\n★★★☆☆ 3\.0 from 2 ratings/),
    ]));
    expect(sent.findIndex(m => m.method === 'sendAnimation')).toBeLessThan(sent.findLastIndex(m => m.method === 'sendMessage'));
    expect(r.obj.party.status).toBe('done');
    expect(lastText()).toMatch(/🎆 <b>Water Festival Firework Show<\/b> · 2 fireworks/);
    expect(lastText()).toMatch(/🥇 <b>Dara<\/b> · ★★★★★ 5\.0 \(2 ratings\)/);
    expect(lastText()).toMatch(/🥈 <b>Sokha<\/b> · ★★★☆☆ 3\.0/);
    expect(lastText()).toMatch(/Didn't draw: Navin/);
  });

  it('a Firework Show alone: 3 bots draw, rate, and every firework goes to the group', async () => {
    await webhook({ message: { text: '/party fireworks', chat: GROUP, from: { id: 1, first_name: 'Dara' } } });
    expect(lastText()).toMatch(/you can even play alone/);
    const r = rooms.get(String(GROUP.id));
    const w = fakeWs('tg-1', 'Dara');
    r.sockets.push(w);
    join(r.obj.party, { key: 'tg-1', name: 'Dara' }, clock);
    await r.obj.webSocketMessage(w, JSON.stringify({ type: 'start-now' }));
    clock = r.alarm(); await r.obj.alarm();
    expect(r.obj.party.status).toBe('running');
    expect(Object.keys(r.obj.party.players)).toHaveLength(4);
    clearInterval(r.obj.ticker); r.obj.ticker = null;
    const sim = r.obj.battle;
    const { COLORS } = await import('../src/party/firework.js');
    const { renderFireworkGif, toBase64 } = await import('../src/party/firework-gif.js');
    await r.obj.webSocketMessage(w, JSON.stringify({ type: 'fw-submit', strokes: [{ c: COLORS[2], pts: [300, 200, 500, 200] }] }));
    // the bots send their drawings within 25 s; once everyone's ready the show starts early
    clock = r.obj.party.startAt + 25000; r.obj.liveTick();
    expect(Object.keys(sim.art)).toHaveLength(4);
    for (let k = 0; k < 4 && sim.phase === 'draw'; k++) { clock += 2000; r.obj.liveTick(); }
    expect(sim.phase).toBe('show');
    // each firework: the page renders its GIF, bots rate it, it goes to the group
    const answered = new Set(), before = sent.length;
    for (let guard = 0; guard < 80 && !sim.over; guard++) {
      for (const ask of w.inbox.filter(m => m.type === 'fw-render' && !answered.has(m.i))) {
        answered.add(ask.i);
        await r.obj.webSocketMessage(w, JSON.stringify({ type: 'fw-gif', i: ask.i, data: toBase64(renderFireworkGif(ask.art, { seed: ask.seed })) }));
      }
      clock += 500; r.obj.liveTick();
    }
    expect(sim.over).toBe(true); // the room finishes the party by itself and posts the results
    const results = () => sent.slice(before).some(m => /4 fireworks/.test(m.body?.text || ''));
    for (let k = 0; k < 200 && !results(); k++) await new Promise(res => setTimeout(res, 10));
    const posted = sent.slice(before);
    expect(posted.filter(m => m.method === 'sendAnimation')).toHaveLength(4);
    const mine = posted.find(m => m.method === 'sendAnimation' && /by <b>Dara<\/b>/.test(m.body.caption));
    expect(mine.body.caption).toMatch(/from 3 ratings/); // all three bots rated Dara's firework
    expect(posted.at(-1).body.text).toMatch(/Firework Show<\/b> · 4 fireworks/);
  });

  it('Draw & Guess alone: you draw, the bots guess once there is a drawing', async () => {
    await webhook({ message: { text: '/party draw', chat: GROUP, from: { id: 1, first_name: 'Dara' } } });
    const r = rooms.get(String(GROUP.id));
    const a = fakeWs('tg-1', 'Dara');
    r.sockets.push(a);
    join(r.obj.party, { key: 'tg-1', name: 'Dara' }, clock);
    clock = r.alarm(); await r.obj.alarm();
    r.obj.stopDraw();
    const d = r.obj.party.draw;
    expect(d.order).toEqual(['tg-1', 'tg-1', 'tg-1']);
    r.obj.party.seed = 'fixed-seed'; // which bots guess, and when, comes from the seed
    r.obj.botDone = new Set();
    for (let t = 0; t < 4; t += 0.5) { clock = d.roundStart + t * 1000; await r.obj.botTick(); }
    for (let t = 4; t < 49; t += 0.5) { clock = d.roundStart + t * 1000; await r.obj.botTick(); }
    expect(Object.keys(d.guessed)).toHaveLength(0); // nothing drawn, nothing guessed
    d.roundEnd = clock + 60000; // a fresh round
    for (let i = 1; i <= 3; i++) await r.obj.webSocketMessage(a, JSON.stringify({ type: 'stroke', id: i, c: '#ff0000', w: 6, pts: [10 * i, 10, 50, 60] }));
    const drawnAt = clock;
    for (let t = 0; t < 40; t += 0.5) { clock = drawnAt + t * 1000; await r.obj.botTick(); }
    expect(Object.keys(d.guessed).length).toBeGreaterThan(0);
    expect(a.inbox.some(m => m.type === 'guessed' && m.name.startsWith('🤖'))).toBe(true);
    expect(r.obj.party.players['tg-1'].score).toBeGreaterThan(0); // the artist scores for every bot that gets it
  });

  it('plays a GTP6 party (/party gtp6): bots drive, scores are cash banked', async () => {
    await webhook({ message: { text: '/party gtp6', chat: GROUP, from: { id: 1, first_name: 'Dara' } } });
    expect(lastText()).toMatch(/GTP6/);
    const r = rooms.get(String(GROUP.id));
    const a = fakeWs('tg-1', 'Dara');
    r.sockets.push(a);
    join(r.obj.party, { key: 'tg-1', name: 'Dara' }, clock);
    clock = r.alarm(); await r.obj.alarm();
    clearInterval(r.obj.ticker); r.obj.ticker = null;
    const sim = r.obj.battle;
    expect(sim.order).toHaveLength(4); // you + 3 bots
    await r.obj.webSocketMessage(a, JSON.stringify({ type: 'drive', th: 1, st: 0.2 }));
    expect(sim.drivers['tg-1'].throttle).toBe(1);
    for (let i = 0; i < 20 * 125 && r.obj.party.status === 'running'; i++) { clock += 50; r.obj.liveTick(); }
    const snap = a.inbox.findLast(m => m.type === 'snap');
    expect(snap.cars).toHaveLength(4);
    expect(sim.over).toBe(true);
    for (let k = 0; k < 200 && !/Party results/.test(lastText()); k++) await new Promise(res => setTimeout(res, 5));
    expect(lastText()).toMatch(/GTP6 Party results/);
    expect(lastText()).toMatch(/banked · \d+ grabs?/);
    const banked = Object.values(sim.drivers).reduce((n, d) => n + d.banked, 0);
    expect(Object.values(r.obj.party.players).reduce((n, p) => n + p.score, 0)).toBe(banked);
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
    expect(picker.reply_markup.inline_keyboard.map(row => row[0].callback_data)).toEqual(['party:reaction', 'party:quiz', 'party:boat', 'party:firework', 'party:draw', 'party:snake', 'party:heat', 'party:battle']);
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

describe('Duo Mode', () => {
  it('/duo shows only duo games, and /party no longer lists them', async () => {
    await webhook({ message: { text: '/duo', chat: GROUP, from: { id: 1, first_name: 'Dara' } } });
    const duoKb = [...sent].reverse().find(s => s.method === 'sendMessage').body.reply_markup.inline_keyboard.flat().map(b => b.callback_data);
    expect(duoKb).toEqual(['party:sync', 'party:market']);
    await webhook({ message: { text: '/party', chat: GROUP, from: { id: 1, first_name: 'Dara' } } });
    const partyKb = [...sent].reverse().find(s => s.method === 'sendMessage').body.reply_markup.inline_keyboard.flat().map(b => b.callback_data);
    expect(partyKb).not.toContain('party:sync');
    expect(partyKb).not.toContain('party:market');
  });

  it('a duo runs in its own room next to a party, and Join links point at it', async () => {
    await webhook({ message: { text: '/party reaction', chat: GROUP, from: { id: 1, first_name: 'Dara' } } });
    rooms.get(String(GROUP.id)).obj.party.messageId = 776; // the fake Telegram gives every card id 777
    sent.length = 0;
    await webhook({ message: { text: '/duo sync', chat: GROUP, from: { id: 1, first_name: 'Dara' } } });
    const card = sent.find(s => s.method === 'sendGame').body;
    expect(card.reply_markup.inline_keyboard[0][0].text).toBe('💞 Join the duo');
    expect(lastText()).toMatch(/In Sync<\/b> · Duo Mode, started by <b>Dara/);
    const duoRoom = rooms.get(`${GROUP.id}:duo`);
    expect(duoRoom.obj.party.game).toBe('sync');
    sent.length = 0;
    await webhook({ callback_query: { id: 'q', from: { id: 2, first_name: 'Sophea' }, game_short_name: 'arcade', message: { chat: GROUP, message_id: 777 } } });
    const url = new URL(sent.find(s => s.method === 'answerCallbackQuery').body.url);
    const claims = await verify(keys.tokenKey, new URLSearchParams(url.hash.slice(1)).get('t'), clock);
    expect(claims).toMatchObject({ p: duoRoom.obj.party.id, r: 'duo' });
  });

  it('plays In Sync end to end: picks stay hidden until the reveal, the team shares one score, results name the duo', async () => {
    await webhook({ message: { text: '/duo sync', chat: GROUP, from: { id: 1, first_name: 'Dara' } } });
    const r = rooms.get(`${GROUP.id}:duo`);
    const a = fakeWs('tg-1', 'Dara'), b = fakeWs('tg-2', 'Sophea');
    r.sockets.push(a, b);
    join(r.obj.party, { key: 'tg-1', name: 'Dara' }, clock); join(r.obj.party, { key: 'tg-2', name: 'Sophea' }, clock + 1);
    expect(join(r.obj.party, { key: 'tg-3', name: 'Vanna' }, clock).ok).toBe(false);
    clock = r.alarm(); await r.obj.alarm();
    expect(r.obj.party.status).toBe('running');
    const q0 = a.inbox.find(m => m.type === 'sync-round');
    expect(q0).toMatchObject({ i: 0, subject: 'tg-1', subjectName: 'Dara', o: expect.any(Array) });
    for (let i = 0; i < 8; i++) {
      await r.obj.webSocketMessage(a, JSON.stringify({ type: 'pick', i, c: 1 }));
      const partner = b.inbox.at(-1);
      expect(partner).toEqual({ type: 'sync-partner', i, locked: ['tg-1'] }); // no pick shown
      await r.obj.webSocketMessage(b, JSON.stringify({ type: 'pick', i, c: i === 0 ? 3 : 1 }));
      expect(b.inbox.filter(m => m.type === 'sync-reveal').at(-1)).toMatchObject({ i, match: i !== 0 });
      clock += 5000; await r.obj.syncTick();
    }
    r.obj.stopSync();
    expect(r.obj.party.status).toBe('done');
    const ps = r.obj.party.players;
    expect(ps['tg-1'].score).toBe(ps['tg-2'].score);
    expect(r.obj.party.summary).toMatchObject({ matches: 7, percent: 88 });
    expect(lastText()).toMatch(/💞 <b>In Sync<\/b> · <b>Dara ♥ Sophea<\/b>/);
    expect(lastText()).toMatch(/7\/8 in sync \(88%\)/);
    expect(lastText()).toMatch(/This week's top duos[\s\S]*🥇 Dara ♥ Sophea .* ← you/);
    await webhook({ message: { text: '/duo board', chat: GROUP, from: { id: 1, first_name: 'Dara' } } });
    expect(lastText()).toMatch(/Top duos[\s\S]*💞 <b>In Sync<\/b>\n🥇 Dara ♥ Sophea/);
    expect(lastText()).toMatch(/Night Market Duo<\/b>\n<i>No duos yet/);
  });

  it('plays Night Market Duo: the room runs the stall, only the right role acts, tips are shared', async () => {
    await webhook({ message: { text: '/duo market', chat: GROUP, from: { id: 1, first_name: 'Dara' } } });
    const r = rooms.get(`${GROUP.id}:duo`);
    const a = fakeWs('tg-1', 'Dara'), b = fakeWs('tg-2', 'Sophea');
    r.sockets.push(a, b);
    join(r.obj.party, { key: 'tg-1', name: 'Dara' }, clock); join(r.obj.party, { key: 'tg-2', name: 'Sophea' }, clock + 1);
    clock = r.alarm(); await r.obj.alarm();
    expect(r.obj.ticker).toBeTruthy();
    const sim = r.obj.battle;
    expect(a.inbox.find(m => m.type === 'snap')).toMatchObject({ cook: 'tg-1', server: 'tg-2' });
    await r.obj.webSocketMessage(b, JSON.stringify({ type: 'cook', d: 1 }));
    expect(sim.burners.every(x => !x)).toBe(true);
    await r.obj.webSocketMessage(a, JSON.stringify({ type: 'cook', d: 1 }));
    expect(sim.burners[0]).toMatchObject({ d: 1 });
    sim.counter[0] = 0; sim.seats[2] = { id: 9, d: 0, p: 100, max: 100 };
    await r.obj.webSocketMessage(b, JSON.stringify({ type: 'serve', c: 0, s: 2 }));
    expect(sim.tips).toBe(20);
    clock = r.alarm(); await r.obj.alarm();
    expect(r.obj.ticker).toBeNull();
    expect(r.obj.party.players['tg-1'].score).toBe(20);
    expect(r.obj.party.players['tg-2'].score).toBe(20);
    expect(lastText()).toMatch(/🍜 <b>Night Market Duo<\/b> · <b>Dara ♥ Sophea<\/b>\n\$20 in tips · 1 served/);
  });

  it('cancels a duo when the partner never joins', async () => {
    await webhook({ message: { text: '/duo sync', chat: GROUP, from: { id: 1, first_name: 'Dara' } } });
    const r = rooms.get(`${GROUP.id}:duo`);
    join(r.obj.party, { key: 'tg-1', name: 'Dara' }, clock);
    clock = r.alarm(); await r.obj.alarm();
    expect(r.obj.party.status).toBe('cancelled');
    expect(lastText()).toMatch(/In Sync cancelled: only <b>Dara<\/b> joined[\s\S]*\/duo/);
  });
});

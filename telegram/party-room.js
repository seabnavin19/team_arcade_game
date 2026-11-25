// One live party room per Telegram group (a Cloudflare Durable Object).
// Players connect with WebSockets; alarms start and end the round; the room
// posts the lobby, a cancel notice, and the results in the group.

import { createParty, join, hit, miss, start, startNow, finish, timelineFor, publicState, isActive, isDuo, MIN_PLAYERS, minPlayersFor, PARTY_SECONDS, PARTY_GAMES } from '../src/party/rules.js';
import { createBattle, addShip, setInput, step as stepBattle, snapshot as battleSnapshot, battleStats } from '../src/party/battle.js';
import { createSnakeGame, addSnake, setDir, step as stepSnake, snapshot as snakeSnapshot, snakeStats, TICK_MS as SNAKE_TICK_MS } from '../src/party/snake.js';

import { setupDraw, beginRound, guess as drawGuess, guessersLeft, maskWord, hintIndex, HINT_AT, MAX_STROKE_POINTS } from '../src/party/draw.js';
import { buildQuiz, phaseAt, answer as quizAnswer, questionMsg, QUESTIONS } from '../src/party/quiz.js';
import { buildSync, startSync, pick as syncPick, advance as syncAdvance, roundMsg as syncRoundMsg, syncSummary, pairOf, ROUNDS as SYNC_ROUNDS } from '../src/party/sync.js';
import { createMarket, addCook, act as marketAct, step as stepMarket, snapshot as marketSnapshot, marketStats, marketSummary, restoreMarket, TICK_MS as MARKET_TICK_MS } from '../src/party/market.js';
import { weekKey } from '../src/core/time.js';

// Real-time party games the room simulates itself, and how.
import { createRace, addRower, paddle, step as stepRace, snapshot as raceSnapshot, raceStats, raceSummary, isOver as raceOver, TICK_MS as RACE_TICK_MS, CREWS } from '../src/party/boat.js';

import { isGif, fromBase64 } from '../src/party/firework-gif.js';
import { createShow, addSparker, submit as fwSubmit, rate as fwRate, artFor, step as stepShow, snapshot as showSnapshot, showStats, showSummary, isOver as showOver, TICK_MS as SHOW_TICK_MS } from '../src/party/firework.js';
import {
  fillWithBots, botKeys, battleBotInput, snakeBotDir, reactionBotTap, quizBotAnswer, boatBotTap, drawBotGuess, drawBotChatter,
  fireworkBotArt, fireworkBotReadyAt, fireworkBotStars,
} from '../src/party/bots.js';

// What bots do each tick in the real-time games (see src/party/bots.js).
const BOTS = {
  battle: (sim, p, now) => { const t = (now - p.startAt) / 1000; for (const k of botKeys(p)) setInput(sim, k, ...battleBotInput(sim, k, t)); },
  snake: (sim, p) => { for (const k of botKeys(p)) { const d = snakeBotDir(sim, k); if (d) setDir(sim, k, d); } },
  boat: (sim, p, now) => {
    for (const beat of sim.beats) {
      if (beat.resolved) continue;
      for (const k of botKeys(p)) {
        if (beat.taps[k] !== undefined) continue;
        const at = boatBotTap(p.seed, k, beat.t);
        if (at !== null && now >= at) paddle(sim, k, at, now);
      }
    }
  },
  firework: (sim, p, now) => {
    for (const k of botKeys(p)) {
      if (sim.phase === 'draw' && !sim.art[k] && now >= p.startAt + fireworkBotReadyAt(p.seed, k) * 1000) fwSubmit(sim, k, fireworkBotArt(p.seed, k), now);
      if (sim.phase === 'show' && sim.order[sim.i] !== k && sim.ratings[sim.i]?.[k] === undefined) {
        const r = fireworkBotStars(p.seed, k, sim.i);
        if (now >= sim.showAt + r.at * 1000) fwRate(sim, k, sim.i, r.stars);
      }
    }
  },
};

const LIVE = {
  // Firework Show: draw, then watch and rate. Drawings go out one at a time, on request.
  firework: { tickMs: SHOW_TICK_MS, types: ['fw-submit', 'fw-rate', 'fw-art'], create: createShow, add: addSparker, step: stepShow, snapshot: showSnapshot, stats: showStats,
    summary: showSummary, isOver: showOver, afterStep: (room, sim) => room.fireworkEvents(sim),
    input: (sim, key, msg, now) => {
      if (msg.type === 'fw-submit') { const r = fwSubmit(sim, key, msg.strokes, now); return r.kind === 'saved' && { type: 'fw-saved', points: r.points }; }
      if (msg.type === 'fw-rate') { const r = fwRate(sim, key, Number(msg.i), msg.stars); return r.kind !== 'invalid' && { type: 'fw-rated', ...r }; }
      const i = Number(msg.i);
      if (sim.phase === 'show' && i === sim.i) return { type: 'fw-art', i, art: artFor(sim, i) };
      return null;
    } },
  boat: { tickMs: RACE_TICK_MS, types: ['paddle'], create: createRace, add: addRower, step: stepRace, snapshot: raceSnapshot, stats: raceStats,
    summary: raceSummary, isOver: raceOver,
    input: (sim, key, msg, now) => { const r = paddle(sim, key, Number(msg.t), now); return r && { type: 'paddle-result', q: r.q }; } },
  battle: { tickMs: 50, types: ['input'], create: createBattle, add: addShip, step: sim => stepBattle(sim, 0.05), snapshot: battleSnapshot, stats: battleStats,
    input: (sim, key, msg) => { if (msg.type === 'input') setInput(sim, key, Number(msg.mx), Number(msg.my)); } },
  snake: { tickMs: SNAKE_TICK_MS, types: ['dir'], create: createSnakeGame, add: addSnake, step: stepSnake, snapshot: snakeSnapshot, stats: snakeStats,
    input: (sim, key, msg) => { if (msg.type === 'dir') setDir(sim, key, String(msg.d)); } },
  market: { tickMs: MARKET_TICK_MS, types: ['cook', 'plate', 'trash', 'serve', 'toss'], create: createMarket, add: addCook, step: stepMarket, snapshot: marketSnapshot, stats: marketStats,
    summary: marketSummary, restore: (sim, p, now) => restoreMarket(sim, p.summary, (now - p.startAt) / MARKET_TICK_MS),
    input: (sim, key, msg) => marketAct(sim, key, msg) },
};
const DUO_BOARD_SIZE = 5;

const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const MEDALS = ['🥇', '🥈', '🥉'];

export class PartyRoom {
  constructor(ctx, env, { now = () => Date.now(), fetch: fetchImpl = (...a) => fetch(...a) } = {}) {
    this.ctx = ctx;
    this.env = env;
    this.now = now;
    this.http = fetchImpl;
    this.party = undefined; // loaded lazily (the object may have been evicted)
    this.timeline = null;
    this.battle = null;     // live Ship Battle / Snake Arena simulation (in memory only)
    this.ticker = null;
    this.quiz = null;       // Brain Race questions (with answers: never sent early)
    this.quizTicker = null;
    this.quizSent = { q: -1, r: -1 };
    this.drawTicker = null;
    this.syncQs = null;     // In Sync questions for this party
    this.syncTicker = null;
  }

  async load() {
    if (this.party === undefined) this.party = (await this.ctx.storage.get('party')) || null;
    if (this.party && !this.timeline) this.timeline = timelineFor(this.party);
    return this.party;
  }

  async save() { await this.ctx.storage.put('party', this.party); }

  async tg(method, body) {
    try {
      const res = await this.http(`https://api.telegram.org/bot${this.env.BOT_TOKEN}/${method}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      return await res.json();
    } catch (e) { return { ok: false, description: e.message }; }
  }

  broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) { try { ws.send(data); } catch { /* closed */ } }
  }

  stateMsg() { return { type: 'state', party: publicState(this.party), now: this.now() }; }

  // ---------- HTTP from the main Worker ----------
  async fetch(request) {
    const url = new URL(request.url);
    await this.load();
    const body = request.method === 'POST' ? await request.json() : {};

    if (url.pathname === '/create') {
      if (isActive(this.party)) return Response.json({ created: false, party: publicState(this.party) });
      this.stopBattle(); this.stopQuiz(); this.stopDraw(); this.stopSync(); this.stopBots(); this.syncQs = null; this.quiz = null; this.quizSent = { q: -1, r: -1 };
      this.party = createParty({ id: crypto.randomUUID().slice(0, 8), chat: body.chat, seed: crypto.randomUUID(), secret: crypto.randomUUID(), now: this.now(), joinSeconds: body.joinSeconds, game: body.game });
      this.timeline = timelineFor(this.party);
      await this.save();
      await this.ctx.storage.setAlarm(this.party.startAt);
      return Response.json({ created: true, party: publicState(this.party) });
    }
    if (url.pathname === '/set-message') {
      if (this.party) { this.party.messageId = body.messageId; await this.save(); }
      return Response.json({ ok: true });
    }
    if (url.pathname === '/lookup') {
      const p = this.party;
      const match = isActive(p) && String(p.messageId) === url.searchParams.get('messageId');
      return Response.json({ party: match ? publicState(p) : null });
    }
    if (url.pathname === '/state') return Response.json({ party: publicState(this.party), now: this.now() });
    if (url.pathname === '/duo-board') return Response.json({ week: weekKey(new Date(this.now())), boards: await this.duoBoards() });

    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
      const user = JSON.parse(request.headers.get('X-Arcade-User') || 'null');
      if (!user || !this.party || this.party.id !== user.partyId) return new Response('no such party', { status: 404 });
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ key: user.key, name: user.name });
      const joined = join(this.party, user, this.now());
      if (joined.ok) await this.save();
      const live = LIVE[this.party.game];
      if (joined.ok && live && this.party.status === 'running' && this.ensureBattle()) live.add(this.battle, user.key, user.name);
      server.send(JSON.stringify({ ...this.stateMsg(), you: user.key, joinError: joined.ok ? null : joined.reason }));
      if (joined.ok) this.broadcast(this.stateMsg());
      if (this.party.game === 'draw' && this.party.status === 'running' && this.party.draw) {
        this.ensureDraw();
        server.send(JSON.stringify(this.roundMsg(user.key)));
        if (this.party.draw.strokes.length) server.send(JSON.stringify({ type: 'strokes', ops: this.party.draw.strokes }));
      }
      if (this.party.game === 'quiz' && this.party.status === 'running' && this.ensureQuiz()) {
        const ph = phaseAt(this.party.startAt, this.now());
        if (ph.phase === 'question') server.send(JSON.stringify(questionMsg(this.quiz, ph)));
      }
      if (this.party.game === 'sync' && this.party.status === 'running' && this.ensureSync() && this.party.sync.round?.phase === 'question') {
        server.send(JSON.stringify(syncRoundMsg(this.party, this.syncQs)));
      }
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response('not found', { status: 404 });
  }

  // ---------- WebSocket messages (hibernation API) ----------
  async webSocketMessage(ws, raw) {
    await this.load();
    let msg;
    try { msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw)); } catch { return; }
    const me = ws.deserializeAttachment() || {};
    const p = this.party;
    if (msg.type === 'ping') { ws.send(JSON.stringify({ type: 'pong', c: msg.c, s: this.now() })); return; }
    if (!p) return;
    this.ensureBots(); // after a restart, the bots pick up where they were
    if (msg.type === 'fw-gif') { this.fireworkGif(me.key, msg); return; }
    if (LIVE[p.game]?.types.includes(msg.type)) {
      if (p.status === 'running' && this.ensureBattle()) {
        const reply = LIVE[p.game].input(this.battle, me.key, msg, this.now());
        if (reply) ws.send(JSON.stringify(reply));
      }
      return;
    }
    if (msg.type === 'pick') {
      if (p.game !== 'sync' || !this.ensureSync()) return;
      const r = syncPick(p, me.key, msg.i, msg.c, this.now());
      if (r.kind === 'invalid') return;
      if (r.kind === 'locked') await this.save();
      ws.send(JSON.stringify({ type: 'sync-locked', i: msg.i, c: msg.c }));
      this.broadcast({ type: 'sync-partner', i: msg.i, locked: Object.keys(p.sync.picks[msg.i] || {}) });
      if (r.both) await this.syncTick();
      return;
    }
    if (p.game === 'draw' && (msg.type === 'stroke' || msg.type === 'undo' || msg.type === 'clear' || msg.type === 'guess')) {
      const d = p.draw;
      if (p.status === 'running') this.ensureDraw(); // after a restart, pick the rounds back up
      if (p.status !== 'running' || !d || d.phase !== 'drawing') return;
      const artist = d.order[d.round];
      if (msg.type === 'guess') {
        if (me.key === artist) return;
        const text = String(msg.text || '').slice(0, 40);
        const r = drawGuess(p, me.key, text, this.now());
        if (r.kind === 'ignored') return;
        if (r.kind === 'right') {
          await this.save();
          ws.send(JSON.stringify({ type: 'you-guessed', pts: r.pts, first: r.first, word: d.words[d.round] }));
          this.broadcast({ type: 'guessed', key: me.key, name: me.name, pts: r.pts, first: r.first, party: publicState(p) });
          if (guessersLeft(p) === 0) await this.drawTick(true);
        } else if (r.kind === 'close') {
          ws.send(JSON.stringify({ type: 'close-guess', text })); // only you see a near miss; it would give the word away
        } else {
          this.broadcast({ type: 'chat', name: me.name, key: me.key, text }); // wrong guesses are part of the fun
        }
        return;
      }
      if (me.key !== artist) return; // only the artist draws
      let op;
      if (msg.type === 'stroke') {
        const pts = Array.isArray(msg.pts) ? msg.pts.slice(0, 400).map(n => Math.max(0, Math.min(800, Math.round(Number(n) || 0)))) : [];
        const used = d.strokes.reduce((n, o) => n + (o.pts ? o.pts.length : 0), 0);
        if (pts.length < 2 || used + pts.length > MAX_STROKE_POINTS) return;
        op = { t: 'stroke', id: Number(msg.id) || 0, c: /^#[0-9a-f]{6}$/i.test(msg.c) ? msg.c : '#1b1b2f', w: Math.max(2, Math.min(28, Number(msg.w) || 5)), pts };
      } else op = { t: msg.type, id: Number(msg.id) || 0 };
      if (op.t === 'clear') d.strokes = [];
      else if (op.t === 'undo') { const id = d.strokes.filter(o => o.t === 'stroke').at(-1)?.id; d.strokes = d.strokes.filter(o => o.id !== id); op.id = id; }
      else d.strokes.push(op);
      for (const sock of this.ctx.getWebSockets()) { if (sock !== ws) { try { sock.send(JSON.stringify({ type: 'strokes', ops: [op] })); } catch { /* closed */ } } }
      return;
    }
    if (msg.type === 'answer') {
      if (p.game !== 'quiz' || !this.ensureQuiz()) return;
      const r = quizAnswer(p, this.quiz, me.key, msg.i, msg.c, this.now());
      if (r.kind === 'invalid') return;
      if (r.kind !== 'already') await this.save();
      ws.send(JSON.stringify({ type: 'locked', i: msg.i, c: msg.c }));
      const answered = Object.keys(p.answers?.[msg.i] || {}).length;
      this.broadcast({ type: 'answered', i: msg.i, count: answered, of: Object.keys(p.players).length });
      return;
    }
    if (msg.type === 'crew' && p.game === 'boat' && p.status === 'lobby' && p.players[me.key]) {
      const c = Number(msg.c);
      if (Number.isInteger(c) && c >= 0 && c < CREWS.length) { p.players[me.key].crew = c; await this.save(); this.broadcast(this.stateMsg()); }
      return;
    }
    if (msg.type === 'start-now') {
      const r = startNow(p, me.key, this.now());
      if (!r.ok) { ws.send(JSON.stringify({ type: 'notice', text: r.reason })); return; }
      await this.save();
      await this.ctx.storage.setAlarm(p.startAt);
      this.broadcast(this.stateMsg());
      return;
    }
    if (msg.type === 'hit') {
      const r = hit(p, this.timeline, me.key, msg.i, msg.age, this.now());
      if (r.kind === 'invalid') return;
      await this.save();
      if (r.kind === 'taken') { ws.send(JSON.stringify({ type: 'taken', i: msg.i, by: r.by })); return; }
      this.broadcast({ type: 'event', kind: r.kind, i: msg.i, key: me.key, name: me.name, points: r.points, party: publicState(p) });
    } else if (msg.type === 'miss') {
      if (miss(p, me.key).kind === 'invalid') return;
      await this.save();
      this.broadcast({ type: 'event', kind: 'miss', key: me.key, name: me.name, points: -25, party: publicState(p) });
    } else if (msg.type === 'hello') {
      ws.send(JSON.stringify({ ...this.stateMsg(), you: me.key }));
    }
  }

  async webSocketClose(ws, code) { try { ws.close(code, 'bye'); } catch { /* already closed */ } }
  async webSocketError() { /* the client will reconnect */ }

  // ---------- real-time loop (Ship Battle, Snake Arena) ----------
  ensureBattle() {
    if (this.battle) return true;
    const p = this.party;
    const live = p && LIVE[p.game];
    if (!live || p.status !== 'running') return false;
    // (Re)build the arena; after a restart everyone respawns but keeps their score.
    this.battle = live.create(p.seed, p);
    for (const [key, pl] of Object.entries(p.players)) {
      const unit = live.add(this.battle, key, pl.name);
      if (unit) Object.assign(unit, { score: pl.score || 0, kos: pl.kos || 0, downs: pl.downs || 0, hits: pl.hits || 0, ...(p.game === 'snake' ? { food: pl.hits || 0 } : {}) });
    }
    live.restore?.(this.battle, p, this.now());
    this.liveTicks = 0;
    this.ticker = setInterval(() => this.liveTick(), live.tickMs);
    return true;
  }

  /** One tick of a real-time game: bots move, the simulation steps, everyone gets the new state. */
  liveTick() {
    const p = this.party, live = LIVE[p?.game];
    if (!this.battle || !live) return;
    BOTS[p.game]?.(this.battle, p, this.now());
    live.step(this.battle, this.now());
    live.afterStep?.(this, this.battle);
    this.broadcast({ type: 'snap', t: this.now(), ...live.snapshot(this.battle) });
    if (live.isOver?.(this.battle)) { this.finishParty().catch(e => console.log('finish', e.message)); return; }
    if (++this.liveTicks % Math.round(2000 / live.tickMs) === 0) { this.copyBattleStats(); this.save(); } // keep scores safe
  }

  liveSnap() { const live = LIVE[this.party?.game]; return live && this.battle ? { type: 'snap', t: this.now(), ...live.snapshot(this.battle) } : null; }

  copyBattleStats() {
    const live = LIVE[this.party?.game];
    if (!this.battle || !live) return;
    for (const [key, st] of Object.entries(live.stats(this.battle))) {
      const pl = this.party.players[key];
      if (pl) Object.assign(pl, { score: st.score, kos: st.kos, downs: st.downs, hits: st.hits });
    }
    if (live.summary) this.party.summary = live.summary(this.battle);
  }

  stopBattle() {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
    this.battle = null;
  }

  // ---------- Brain Race loop ----------
  ensureQuiz() {
    const p = this.party;
    if (!p || p.game !== 'quiz') return false;
    if (!this.quiz) this.quiz = buildQuiz(p.secret || p.seed);
    if (p.status === 'running' && !this.quizTicker) this.quizTicker = setInterval(() => this.quizTick(), 200);
    return true;
  }

  quizTick() {
    const p = this.party;
    if (!p || p.status !== 'running') return;
    const ph = phaseAt(p.startAt, this.now());
    if (ph.phase === 'question' && this.quizSent.q < ph.i) {
      this.quizSent.q = ph.i;
      this.broadcast(questionMsg(this.quiz, ph));
    }
    if ((ph.phase === 'reveal' || (ph.phase === 'question' && ph.i > this.quizSent.r + 1)) && this.quizSent.r < (ph.phase === 'reveal' ? ph.i : ph.i - 1)) {
      const i = ph.phase === 'reveal' ? ph.i : ph.i - 1;
      this.quizSent.r = i;
      const answers = p.answers?.[i] || {};
      const first = Object.entries(answers).find(([, a]) => a.first);
      this.broadcast({
        type: 'reveal', i, n: QUESTIONS, correct: this.quiz[i].correct,
        answers: Object.fromEntries(Object.entries(answers).map(([k, a]) => [k, { ok: a.ok, pts: a.pts, first: a.first }])),
        firstName: first ? p.players[first[0]]?.name : null, party: publicState(p),
      });
    }
  }

  stopQuiz() {
    if (this.quizTicker) clearInterval(this.quizTicker);
    this.quizTicker = null;
  }

  // ---------- In Sync rounds ----------
  ensureSync() {
    const p = this.party;
    if (!p || p.game !== 'sync') return false;
    if (!this.syncQs) this.syncQs = buildSync(p.secret || p.seed);
    if (p.status === 'running' && !p.sync) startSync(p, this.now());
    if (p.status === 'running' && !this.syncTicker) this.syncTicker = setInterval(() => { this.syncTick().catch(e => console.log('syncTick', e.message)); }, 200);
    return true;
  }

  async syncTick() {
    const p = this.party;
    if (!p || p.status !== 'running' || !p.sync) return;
    const out = syncAdvance(p, this.now());
    if (out.reveal) {
      await this.save();
      const q = this.syncQs[out.reveal.i];
      this.broadcast({ type: 'sync-reveal', ...out.reveal, o: q.o, matches: p.sync.matches, n: SYNC_ROUNDS, party: publicState(p) });
    }
    if (out.open !== undefined) { await this.save(); this.broadcast(syncRoundMsg(p, this.syncQs)); }
    if (out.done) { this.stopSync(); await this.finishParty(); }
  }

  stopSync() { if (this.syncTicker) clearInterval(this.syncTicker); this.syncTicker = null; }

  // ---------- Duo Mode weekly board (kept in this room's storage) ----------
  async duoBoards() {
    const week = weekKey(new Date(this.now()));
    return (await this.ctx.storage.get(`duo:${week}`)) || {};
  }

  /** Remember this duo's score if it's one of the week's best. Returns the game's board. */
  async recordDuo(p) {
    const week = weekKey(new Date(this.now()));
    const boards = (await this.ctx.storage.get(`duo:${week}`)) || {};
    const keys = pairOf(p);
    const id = [...keys].sort().join('+');
    const names = keys.map(k => p.players[k]?.name || '?');
    const score = p.players[keys[0]]?.score || 0;
    const list = (boards[p.game] ||= []);
    const old = list.find(e => e.id === id);
    if (old) { if (score > old.score) Object.assign(old, { score, names }); } else list.push({ id, names, score });
    list.sort((a, b) => b.score - a.score);
    boards[p.game] = list.slice(0, DUO_BOARD_SIZE);
    await this.ctx.storage.put(`duo:${week}`, boards);
    return boards[p.game];
  }

  // ---------- Draw & Guess rounds ----------
  roundMsg(forKey) {
    const p = this.party, d = p.draw;
    const artist = d.order[d.round];
    const shown = d.hint ? [hintIndex(p.seed, d.round, d.words[d.round])] : [];
    return {
      type: 'round', i: d.round, n: d.order.length, phase: d.phase, artist, artistName: p.players[artist]?.name || '?',
      endsAt: d.phase === 'drawing' ? d.roundEnd : d.revealEnd, mask: maskWord(d.words[d.round] || '', shown),
      ...(forKey === artist || d.phase === 'reveal' ? { word: d.words[d.round] } : {}),
      guessed: Object.keys(d.guessed),
    };
  }

  sendRound() {
    for (const ws of this.ctx.getWebSockets()) {
      const me = ws.deserializeAttachment() || {};
      try { ws.send(JSON.stringify(this.roundMsg(me.key))); } catch { /* closed */ }
    }
  }

  ensureDraw() {
    if (this.drawTicker || this.party?.game !== 'draw' || this.party.status !== 'running') return;
    this.drawTicker = setInterval(() => { this.drawTick(false).catch(e => console.log('drawTick', e.message)); }, 250);
  }

  stopDraw() { if (this.drawTicker) clearInterval(this.drawTicker); this.drawTicker = null; }

  async drawTick(everyoneGuessed) {
    const p = this.party, d = p?.draw;
    if (!d || p.status !== 'running') return;
    const now = this.now();
    if (d.phase === 'drawing') {
      const artist = d.order[d.round];
      const artistHere = this.ctx.getWebSockets().some(ws => (ws.deserializeAttachment() || {}).key === artist);
      const absent = !artistHere && now - d.roundStart > 4000 && !d.strokes.length;
      if (!d.hint && now >= d.roundStart + (d.roundEnd - d.roundStart) * HINT_AT && [...d.words[d.round]].filter(c => c !== ' ').length >= 4) {
        d.hint = true; this.sendRound();
      }
      if (everyoneGuessed || now >= d.roundEnd || absent) {
        d.phase = 'reveal'; d.revealEnd = now + 4000; d.skipped = absent;
        await this.save();
        this.broadcast({ type: 'reveal', i: d.round, word: d.words[d.round], skipped: absent, artistName: p.players[artist]?.name, party: publicState(p) });
        this.sendRound();
      }
    } else if (now >= d.revealEnd) {
      if (d.round + 1 >= d.order.length) { this.stopDraw(); await this.finishParty(); return; }
      beginRound(p, now);
      await this.save();
      this.broadcast({ type: 'strokes', ops: [{ t: 'clear' }] });
      this.sendRound();
    }
  }

  // ---------- bots in the turn-based games (Reaction Tap, Brain Race, Draw & Guess) ----------
  ensureBots() {
    const p = this.party;
    if (this.botTicker || !p || p.status !== 'running' || !botKeys(p).length || LIVE[p.game]) return;
    if (!['reaction', 'quiz', 'draw'].includes(p.game)) return;
    this.botDone ||= new Set();
    this.botTicker = setInterval(() => { this.botTick().catch(e => console.log('botTick', e.message)); }, 100);
  }

  stopBots() { if (this.botTicker) clearInterval(this.botTicker); this.botTicker = null; this.botDone = null; }

  async botTick() {
    const p = this.party, now = this.now();
    if (!p || p.status !== 'running') { this.stopBots(); return; }
    const once = id => (this.botDone.has(id) ? false : (this.botDone.add(id), true));
    if (p.game === 'reaction') {
      const t = (now - p.startAt) / 1000;
      for (let i = 0; i < this.timeline.length; i++) {
        const tg = this.timeline[i];
        if (tg.t > t) break;
        if (t > tg.t + tg.life) continue;
        for (const k of botKeys(p)) {
          const age = reactionBotTap(p.seed, k, i, tg);
          if (age === null || t - tg.t < age || !once(`r:${k}:${i}`)) continue;
          const r = hit(p, this.timeline, k, i, age, now);
          if (r.kind !== 'hit' && r.kind !== 'fake') continue;
          await this.save();
          this.broadcast({ type: 'event', kind: r.kind, i, key: k, name: p.players[k].name, points: r.points, party: publicState(p) });
        }
      }
    } else if (p.game === 'quiz') {
      if (!this.ensureQuiz()) return;
      const ph = phaseAt(p.startAt, now);
      if (ph.phase !== 'question') return;
      for (const k of botKeys(p)) {
        const a = quizBotAnswer(p.seed, k, ph.i, this.quiz[ph.i].correct);
        if (!a || now < ph.opensAt + a.at * 1000 || !once(`q:${k}:${ph.i}`)) continue;
        const r = quizAnswer(p, this.quiz, k, ph.i, a.c, now);
        if (r.kind === 'invalid' || r.kind === 'already') continue;
        await this.save();
        this.broadcast({ type: 'answered', i: ph.i, count: Object.keys(p.answers?.[ph.i] || {}).length, of: Object.keys(p.players).length });
      }
    } else if (p.game === 'draw') {
      const d = p.draw;
      if (!d || d.phase !== 'drawing') return;
      const into = (now - d.roundStart) / 1000, word = d.words[d.round];
      for (const k of botKeys(p)) {
        if (k === d.order[d.round] || d.guessed[k] != null) continue;
        // now and then a wrong guess in the chat, like people do
        for (const [n, at] of [[0, 6], [1, 16]]) {
          if (into >= at + (k.charCodeAt(k.length - 1) % 4) && once(`c:${k}:${d.round}:${n}`) && (now + n + k.length) % 3 === 0) {
            this.broadcast({ type: 'chat', name: p.players[k].name, key: k, text: drawBotChatter(p.seed, k, d.round, n, word) });
          }
        }
        const at = drawBotGuess(p.seed, k, d.round);
        // bots only "recognise" a drawing that exists: a few strokes, and some time after the first one
        const lines = d.strokes.filter(o => o.t === 'stroke');
        if (lines.length < 3 || d.firstStrokeAt == null) { if (lines.length && d.firstStrokeAt == null) d.firstStrokeAt = now; continue; }
        if (at === null || (now - d.firstStrokeAt) / 1000 < at - 4 || !once(`g:${k}:${d.round}`)) continue;
        const r = drawGuess(p, k, word, now);
        if (r.kind !== 'right') continue;
        await this.save();
        this.broadcast({ type: 'guessed', key: k, name: p.players[k].name, pts: r.pts, first: r.first, party: publicState(p) });
        if (guessersLeft(p) === 0) { await this.drawTick(true); return; }
      }
    }
  }

  // ---------- timers ----------
  async alarm() {
    await this.load();
    const p = this.party;
    if (!p) return;
    if (p.status === 'lobby') {
      const status = start(p);
      if (status === 'running') fillWithBots(p, this.now()); // fewer than 4 people? bots take the empty seats
      await this.save();
      this.broadcast(this.stateMsg());
      if (status === 'running') {
        if (LIVE[p.game]) { this.ensureBattle(); this.broadcast(this.liveSnap()); }
        if (p.game === 'quiz') { this.quizSent = { q: -1, r: -1 }; this.ensureQuiz(); this.quizTick(); }
        if (p.game === 'sync') { this.ensureSync(); await this.save(); this.broadcast(syncRoundMsg(p, this.syncQs)); }
        if (p.game === 'draw') { setupDraw(p, this.now()); await this.save(); this.broadcast(this.stateMsg()); this.ensureDraw(); await this.drawTick(false); }
        this.ensureBots();
        await this.ctx.storage.setAlarm(LIVE[p.game] ? p.endAt : p.endAt + 1500); // taps get a little grace (and a backstop for Draw & Guess)
      } else {
        const names = Object.values(p.players).map(x => x.name);
        if (isDuo(p)) {
          const g = PARTY_GAMES[p.game];
          await this.tg('sendMessage', {
            chat_id: p.chat, parse_mode: 'HTML',
            text: `${g.emoji} ${g.title} cancelled: ${names.length ? `only <b>${esc(names[0])}</b> joined` : 'nobody joined'}. It's a game for 2.\nSend /duo again and ask your partner to tap <b>Join</b>.`,
          });
          return;
        }
        await this.tg('sendMessage', {
          chat_id: p.chat, parse_mode: 'HTML',
          text: `⚡ Party cancelled: ${names.length ? `only <b>${esc(names[0])}</b> joined` : 'nobody joined'}. It needs at least ${minPlayersFor(p)} players.\nTry /party again when more people are on a break.`,
        });
      }
    } else if (p.status === 'running') {
      await this.finishParty();
    }
  }

  async finishParty() {
    const p = this.party;
    if (!p || p.status !== 'running') return;
    {
      this.stopDraw(); this.stopBots();
      if (LIVE[p.game]) { this.copyBattleStats(); this.stopBattle(); }
      if (p.game === 'quiz') { this.ensureQuiz(); this.quizTick(); this.stopQuiz(); }
      if (p.game === 'sync') { this.stopSync(); p.summary = syncSummary(p); }
      const res = finish(p);
      if (isDuo(p)) {
        await this.save();
        this.broadcast(this.stateMsg());
        await this.postDuoResults(p);
        return;
      }
      await this.save();
      this.broadcast(this.stateMsg());
      if (p.game === 'boat') { await this.postRaceResults(p); return; }
      if (p.game === 'firework') { await this.fireworkPosted(); await this.postShowResults(p); return; }
      const g = PARTY_GAMES[p.game || 'reaction'];
      const detail = r => (p.game === 'battle'
        ? `${r.kos} ${r.kos === 1 ? 'KO' : 'KOs'} · knocked out ${r.downs}×`
        : p.game === 'snake'
        ? `${r.score} pts · ${r.hits} food · ${r.kos} ${r.kos === 1 ? 'KO' : 'KOs'}`
        : p.game === 'quiz'
        ? `${r.score.toLocaleString('en-US')} (${r.hits}/${QUESTIONS} right)`
        : p.game === 'draw'
        ? `${r.score.toLocaleString('en-US')} pts · guessed ${r.hits} ${r.hits === 1 ? 'drawing' : 'drawings'}`
        : `${r.score.toLocaleString('en-US')} (${r.hits} hits${r.fakes ? `, ${r.fakes} fakes` : ''})`);
      const lines = res.slice(0, 10).map(r => `${MEDALS[r.place - 1] || `${r.place}.`} <b>${esc(r.name)}</b> · ${detail(r)}`);
      await this.tg('sendMessage', {
        chat_id: p.chat, parse_mode: 'HTML',
        text: [`${g.emoji} <b>${g.title} Party results</b> · ${res.length} players${botKeys(p).length ? ` (${botKeys(p).length} 🤖)` : ''}`, '', ...lines, '', res[0] ? `🎉 <b>${esc(res[0].name)}</b> wins the party!` : '', 'Rematch? Send /party'].join('\n'),
      });
    }
  }
}

// Water Festival race results: boats in finishing order, best paddler, best sync.
PartyRoom.prototype.postRaceResults = async function postRaceResults(p) {
  const s = p.summary || { boats: [] };
  const time = b => (b.ms ? `${(b.ms / 1000).toFixed(1)} s` : `${Math.round(b.x / 10)}% of the course`);
  const lines = s.boats.map(b => `${MEDALS[b.place - 1] || `${b.place}.`} <b>${esc(b.name)}</b>${s.mode === 'crews' ? ` (${esc(b.members.join(', '))})` : ''} · ${time(b)}`);
  const win = s.boats[0];
  await this.tg('sendMessage', {
    chat_id: p.chat, parse_mode: 'HTML',
    text: [
      `🚣 <b>Water Festival Boat Race</b> · ${Object.keys(p.players).length} paddlers`, '', ...lines, '',
      win ? `🎉 <b>${esc(win.name)}</b> ${s.mode === 'crews' ? 'crew wins' : 'wins'} the race!` : '',
      s.best ? `🏅 Best paddler: <b>${esc(s.best.name)}</b>, ${s.best.pct}% on the beat` : '',
      s.sync ? `🥁 Best sync: <b>${esc(s.sync.name)}</b>, ${s.sync.streak} perfect strokes together` : '',
      'Rematch? Send /party',
    ].filter(Boolean).join('\n'),
  });
};

// ---------- Firework Show: each firework goes to the group as a GIF ----------
// A player's screen renders the GIF (the artist's if they are here) when the
// firework launches; when its rating time ends the room posts it to the group.
const GIF_WAIT_MS = 8000, MAX_GIF_BYTES = 3 * 1024 * 1024;
const starLine = a => `${'★'.repeat(Math.round(a))}${'☆'.repeat(5 - Math.round(a))}`;

PartyRoom.prototype.fireworkEvents = function fireworkEvents(sim) {
  for (const e of sim.events) {
    if (e.e === 'show') this.requestFireworkGif(sim, e.i);
    if (e.e === 'rated') {
      const job = { ...e, total: sim.order.length, solo: Object.keys(sim.players).length <= 1 };
      this.fwChain = (this.fwChain || Promise.resolve()).then(() => this.postFirework(job)).catch(err => console.log('firework gif', err.message));
    }
  }
};

PartyRoom.prototype.requestFireworkGif = function requestFireworkGif(sim, i) {
  const artist = sim.order[i], art = artFor(sim, i);
  const sockets = this.ctx.getWebSockets().filter(ws => { try { return !!ws.deserializeAttachment()?.key; } catch { return false; } });
  const pick = sockets.find(ws => ws.deserializeAttachment().key === artist) || sockets[0];
  this.fwGifs ||= {};
  this.fwAsk ||= {};
  if (!pick || !art) return;
  this.fwAsk[i] = pick.deserializeAttachment().key;
  try { pick.send(JSON.stringify({ type: 'fw-render', i, art, seed: `${this.party.seed}:${i}` })); } catch { /* closed */ }
};

PartyRoom.prototype.fireworkGif = function fireworkGif(key, msg) {
  const i = Number(msg.i);
  if (!this.fwAsk || this.fwAsk[i] !== key || this.fwGifs[i] || typeof msg.data !== 'string' || msg.data.length > MAX_GIF_BYTES * 1.4) return;
  let bytes;
  try { bytes = fromBase64(msg.data); } catch { return; }
  if (isGif(bytes) && bytes.length <= MAX_GIF_BYTES) this.fwGifs[i] = bytes;
};

PartyRoom.prototype.postFirework = async function postFirework(job) {
  const p = this.party;
  if (!p) return;
  for (let waited = 0; !this.fwGifs?.[job.i] && waited < GIF_WAIT_MS && this.fwAsk?.[job.i]; waited += 250) await new Promise(r => setTimeout(r, 250));
  const caption = [
    job.total === 1 ? `🎆 <b>A firework</b> by <b>${esc(job.name)}</b>` : `🎆 <b>Firework ${job.i + 1} of ${job.total}</b> · by <b>${esc(job.name)}</b>`,
    job.solo ? 'Solo show for the Water Festival! Want ratings? Play /party fireworks together.' : job.n ? `${starLine(job.avg)} ${job.avg.toFixed(1)} from ${job.n} ${job.n === 1 ? 'rating' : 'ratings'}` : 'No ratings',
  ].join('\n');
  const gif = this.fwGifs?.[job.i];
  if (gif) {
    const res = await this.tgFile('sendAnimation', { chat_id: p.chat, caption, parse_mode: 'HTML' }, 'animation', gif, 'firework.gif', 'image/gif');
    delete this.fwGifs[job.i];
    if (res?.ok !== false) return;
  }
  await this.tg('sendMessage', { chat_id: p.chat, parse_mode: 'HTML', text: caption });
};

// Results wait (a little) for the last fireworks to reach the group first.
PartyRoom.prototype.fireworkPosted = async function fireworkPosted() {
  const chain = this.fwChain;
  this.fwChain = null;
  if (chain) await Promise.race([chain, new Promise(r => setTimeout(r, GIF_WAIT_MS + 4000))]);
  this.fwGifs = {}; this.fwAsk = {};
};

PartyRoom.prototype.tgFile = async function tgFile(method, fields, fileField, bytes, filename, type) {
  try {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, String(v));
    form.append(fileField, new Blob([bytes], { type }), filename);
    const res = await this.http(`https://api.telegram.org/bot${this.env.BOT_TOKEN}/${method}`, { method: 'POST', body: form });
    return await res.json();
  } catch (e) { return { ok: false, description: e.message }; }
};

// Firework Show results: the drawings ranked by their average stars.
PartyRoom.prototype.postShowResults = async function postShowResults(p) {
  const s = p.summary || { ranked: [], noArt: [] };
  if (Object.keys(p.players).length <= 1) { // a solo show: the GIF says it all
    if (!s.drew) await this.tg('sendMessage', { chat_id: p.chat, parse_mode: 'HTML', text: '🎆 The firework show ended without a drawing. Try again: /party fireworks' });
    return;
  }
  const stars = a => `${'★'.repeat(Math.round(a))}${'☆'.repeat(5 - Math.round(a))}`;
  let place = 0;
  const lines = s.ranked.slice(0, 10).map((r, i, arr) => {
    if (i === 0 || r.avg !== arr[i - 1].avg) place = i + 1;
    return `${MEDALS[place - 1] || `${place}.`} <b>${esc(r.name)}</b> · ${stars(r.avg)} ${r.avg.toFixed(1)} (${r.n} ${r.n === 1 ? 'rating' : 'ratings'})`;
  });
  const win = s.ranked[0];
  await this.tg('sendMessage', {
    chat_id: p.chat, parse_mode: 'HTML',
    text: [
      `🎆 <b>Water Festival Firework Show</b> · ${s.drew} ${s.drew === 1 ? 'firework' : 'fireworks'}`, '',
      ...(lines.length ? lines : ['Nobody drew a firework this time. 🌙']), '',
      win && win.n ? `🎉 <b>${esc(win.name)}</b> made the crowd's favourite firework!` : null,
      s.fan ? `👏 Most generous critic: <b>${esc(s.fan.name)}</b> rated ${s.fan.given} fireworks` : null,
      s.noArt.length ? `🙈 Didn't draw: ${s.noArt.map(esc).join(', ')}` : null,
      'Another show? Send /party fireworks',
    ].filter(x => x !== null).join('\n'),
  });
};

// Duo results: one team, one score, plus the week's best duos.
PartyRoom.prototype.postDuoResults = async function postDuoResults(p) {
  const g = PARTY_GAMES[p.game];
  const keys = pairOf(p);
  const names = keys.map(k => p.players[k]?.name || '?');
  const score = p.players[keys[0]]?.score || 0;
  const s = p.summary || {};
  const board = keys.length === 2 ? await this.recordDuo(p) : [];
  const id = [...keys].sort().join('+');
  const line = p.game === 'sync'
    ? `${s.matches || 0}/${SYNC_ROUNDS} in sync (${s.percent || 0}%) · ${score.toLocaleString('en-US')} pts${s.best >= 3 ? ` · best streak ${s.best}` : ''}`
    : `$${score.toLocaleString('en-US')} in tips · ${s.served || 0} served${s.walked ? ` · ${s.walked} walked out` : ''}${s.burned ? ` · ${s.burned} burned` : ''}`;
  const verdict = p.game === 'sync'
    ? (s.percent >= 75 ? 'Practically one brain. 🧠' : s.percent >= 50 ? 'Nicely in tune!' : 'Lots to talk about over lunch. 😄')
    : (s.walked === 0 && s.served > 0 ? 'Not one hungry customer left. ⭐' : s.served >= 15 ? 'The busiest stall in the market!' : 'Every great stall starts small. 🍜');
  const top = board.slice(0, 3).map((e, i) => `${MEDALS[i]} ${esc(e.names.join(' ♥ '))} · ${p.game === 'sync' ? `${e.score.toLocaleString('en-US')} pts` : `$${e.score.toLocaleString('en-US')}`}${e.id === id ? ' ← you' : ''}`);
  await this.tg('sendMessage', {
    chat_id: p.chat, parse_mode: 'HTML',
    text: [`${g.emoji} <b>${g.title}</b> · <b>${esc(names.join(' ♥ '))}</b>`, line, verdict, '', ...(top.length ? ["🏆 <b>This week's top duos</b>", ...top, ''] : []), 'Play again? Send /duo'].join('\n'),
  });
};

export { PARTY_SECONDS };

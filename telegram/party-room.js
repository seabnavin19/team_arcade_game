// One live party room per Telegram group (a Cloudflare Durable Object).
// Players connect with WebSockets; alarms start and end the round; the room
// posts the lobby, a cancel notice, and the results in the group.

import { createParty, join, hit, miss, start, startNow, finish, timelineFor, publicState, isActive, MIN_PLAYERS, PARTY_SECONDS, PARTY_GAMES } from '../src/party/rules.js';
import { createBattle, addShip, setInput, step as stepBattle, snapshot as battleSnapshot, battleStats } from '../src/party/battle.js';
import { createSnakeGame, addSnake, setDir, step as stepSnake, snapshot as snakeSnapshot, snakeStats, TICK_MS as SNAKE_TICK_MS } from '../src/party/snake.js';

import { setupDraw, beginRound, guess as drawGuess, guessersLeft, maskWord, hintIndex, HINT_AT, MAX_STROKE_POINTS } from '../src/party/draw.js';
import { buildQuiz, phaseAt, answer as quizAnswer, questionMsg, QUESTIONS } from '../src/party/quiz.js';

// Real-time party games the room simulates itself, and how.
const LIVE = {
  battle: { tickMs: 50, create: createBattle, add: addShip, step: sim => stepBattle(sim, 0.05), snapshot: battleSnapshot, stats: battleStats,
    input: (sim, key, msg) => { if (msg.type === 'input') setInput(sim, key, Number(msg.mx), Number(msg.my)); } },
  snake: { tickMs: SNAKE_TICK_MS, create: createSnakeGame, add: addSnake, step: stepSnake, snapshot: snakeSnapshot, stats: snakeStats,
    input: (sim, key, msg) => { if (msg.type === 'dir') setDir(sim, key, String(msg.d)); } },
};

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
      this.stopBattle(); this.stopQuiz(); this.stopDraw(); this.quiz = null; this.quizSent = { q: -1, r: -1 };
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
    if (msg.type === 'input' || msg.type === 'dir') {
      if (LIVE[p.game] && p.status === 'running' && this.ensureBattle()) LIVE[p.game].input(this.battle, me.key, msg);
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
    this.battle = live.create(p.seed);
    for (const [key, pl] of Object.entries(p.players)) {
      const unit = live.add(this.battle, key, pl.name);
      if (unit) Object.assign(unit, { score: pl.score || 0, kos: pl.kos || 0, downs: pl.downs || 0, hits: pl.hits || 0, ...(p.game === 'snake' ? { food: pl.hits || 0 } : {}) });
    }
    let n = 0;
    const every2s = Math.round(2000 / live.tickMs);
    this.ticker = setInterval(() => {
      if (!this.battle) return;
      live.step(this.battle);
      this.broadcast({ type: 'snap', t: this.now(), ...live.snapshot(this.battle) });
      if (++n % every2s === 0) { this.copyBattleStats(); this.save(); } // keep scores safe
    }, live.tickMs);
    return true;
  }

  liveSnap() { const live = LIVE[this.party?.game]; return live && this.battle ? { type: 'snap', t: this.now(), ...live.snapshot(this.battle) } : null; }

  copyBattleStats() {
    const live = LIVE[this.party?.game];
    if (!this.battle || !live) return;
    for (const [key, st] of Object.entries(live.stats(this.battle))) {
      const pl = this.party.players[key];
      if (pl) Object.assign(pl, { score: st.score, kos: st.kos, downs: st.downs, hits: st.hits });
    }
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

  // ---------- timers ----------
  async alarm() {
    await this.load();
    const p = this.party;
    if (!p) return;
    if (p.status === 'lobby') {
      const status = start(p);
      await this.save();
      this.broadcast(this.stateMsg());
      if (status === 'running') {
        if (LIVE[p.game]) { this.ensureBattle(); this.broadcast(this.liveSnap()); }
        if (p.game === 'quiz') { this.quizSent = { q: -1, r: -1 }; this.ensureQuiz(); this.quizTick(); }
        if (p.game === 'draw') { setupDraw(p, this.now()); await this.save(); this.broadcast(this.stateMsg()); this.ensureDraw(); await this.drawTick(false); }
        await this.ctx.storage.setAlarm(LIVE[p.game] ? p.endAt : p.endAt + 1500); // taps get a little grace (and a backstop for Draw & Guess)
      } else {
        const names = Object.values(p.players).map(x => x.name);
        await this.tg('sendMessage', {
          chat_id: p.chat, parse_mode: 'HTML',
          text: `⚡ Party cancelled: ${names.length ? `only <b>${esc(names[0])}</b> joined` : 'nobody joined'}. It needs at least ${MIN_PLAYERS} players.\nTry /party again when more people are on a break.`,
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
      this.stopDraw();
      if (LIVE[p.game]) { this.copyBattleStats(); this.stopBattle(); }
      if (p.game === 'quiz') { this.ensureQuiz(); this.quizTick(); this.stopQuiz(); }
      const res = finish(p);
      await this.save();
      this.broadcast(this.stateMsg());
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
        text: [`${g.emoji} <b>${g.title} Party results</b> · ${res.length} players`, '', ...lines, '', res[0] ? `🎉 <b>${esc(res[0].name)}</b> wins the party!` : '', 'Rematch? Send /party'].join('\n'),
      });
    }
  }
}

export { PARTY_SECONDS };

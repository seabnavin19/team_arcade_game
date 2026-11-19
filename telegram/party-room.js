// One live party room per Telegram group (a Cloudflare Durable Object).
// Players connect with WebSockets; alarms start and end the round; the room
// posts the lobby, a cancel notice, and the results in the group.

import { createParty, join, hit, miss, start, finish, timelineFor, publicState, isActive, MIN_PLAYERS, PARTY_SECONDS, PARTY_GAMES } from '../src/party/rules.js';
import { createBattle, addShip, setInput, step as stepBattle, snapshot, battleStats } from '../src/party/battle.js';

const TICK_MS = 50; // Ship Battle runs 20 times a second

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
    this.battle = null;     // live Ship Battle simulation (in memory only)
    this.ticker = null;
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
      this.stopBattle();
      this.party = createParty({ id: crypto.randomUUID().slice(0, 8), chat: body.chat, seed: crypto.randomUUID(), now: this.now(), joinSeconds: body.joinSeconds, game: body.game });
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
      if (joined.ok && this.party.game === 'battle' && this.party.status === 'running') this.ensureBattle() && addShip(this.battle, user.key, user.name);
      server.send(JSON.stringify({ ...this.stateMsg(), you: user.key, joinError: joined.ok ? null : joined.reason }));
      if (joined.ok) this.broadcast(this.stateMsg());
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
    if (msg.type === 'input') {
      if (p.game === 'battle' && p.status === 'running' && this.ensureBattle()) setInput(this.battle, me.key, Number(msg.mx), Number(msg.my));
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

  // ---------- Ship Battle loop ----------
  ensureBattle() {
    if (this.battle) return true;
    const p = this.party;
    if (!p || p.game !== 'battle' || p.status !== 'running') return false;
    // (Re)build the arena; after a restart everyone respawns but keeps their score.
    this.battle = createBattle(p.seed);
    for (const [key, pl] of Object.entries(p.players)) {
      const ship = addShip(this.battle, key, pl.name);
      if (ship) Object.assign(ship, { kos: pl.kos || 0, downs: pl.downs || 0, hits: pl.hits || 0 });
    }
    let n = 0;
    this.ticker = setInterval(() => {
      if (!this.battle) return;
      stepBattle(this.battle, TICK_MS / 1000);
      this.broadcast({ type: 'snap', t: this.now(), ...snapshot(this.battle) });
      if (++n % 40 === 0) { this.copyBattleStats(); this.save(); } // keep scores safe every 2 s
    }, TICK_MS);
    return true;
  }

  copyBattleStats() {
    if (!this.battle || !this.party) return;
    for (const [key, st] of Object.entries(battleStats(this.battle))) {
      const pl = this.party.players[key];
      if (pl) Object.assign(pl, { score: st.score, kos: st.kos, downs: st.downs, hits: st.hits });
    }
  }

  stopBattle() {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
    this.battle = null;
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
        if (p.game === 'battle') { this.ensureBattle(); this.broadcast({ type: 'snap', t: this.now(), ...snapshot(this.battle) }); }
        await this.ctx.storage.setAlarm(p.game === 'battle' ? p.endAt : p.endAt + 1500); // taps get a little grace
      } else {
        const names = Object.values(p.players).map(x => x.name);
        await this.tg('sendMessage', {
          chat_id: p.chat, parse_mode: 'HTML',
          text: `⚡ Party cancelled: ${names.length ? `only <b>${esc(names[0])}</b> joined` : 'nobody joined'}. It needs at least ${MIN_PLAYERS} players.\nTry /party again when more people are on a break.`,
        });
      }
    } else if (p.status === 'running') {
      if (p.game === 'battle') { this.copyBattleStats(); this.stopBattle(); }
      const res = finish(p);
      await this.save();
      this.broadcast(this.stateMsg());
      const g = PARTY_GAMES[p.game || 'reaction'];
      const detail = r => (p.game === 'battle'
        ? `${r.kos} ${r.kos === 1 ? 'KO' : 'KOs'} · knocked out ${r.downs}×`
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

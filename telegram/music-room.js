// One music room per Telegram group (a Cloudflare Durable Object).
// Listeners connect with WebSockets and share one YouTube queue. The room
// keeps the clock: every phone or computer plays "video X from second N".
// One alarm covers both "this song has ended" and "nobody here for a day".

import {
  createMusic, parseVideoId, addSong, removeSong, pause, resume, voteSkip, recheckVotes,
  setDuration, clientEnded, unplayable, advance, nextAlarmAt, onAlarm, onListenersChanged, publicMusic, MESSAGES,
} from '../src/music/rules.js';

const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const MAX_CARDS = 5;

export class MusicRoom {
  constructor(ctx, env, { now = () => Date.now(), fetch: fetchImpl = (...a) => fetch(...a) } = {}) {
    this.ctx = ctx;
    this.env = env;
    this.now = now;
    this.http = fetchImpl;
    this.music = undefined; // loaded lazily (the object may have been evicted)
  }

  async load() {
    if (this.music === undefined) this.music = (await this.ctx.storage.get('music')) || createMusic();
    return this.music;
  }

  /** Distinct listeners (one per person, however many tabs), optionally ignoring a closing socket. */
  listeners(except) {
    const seen = new Map();
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      const u = ws.deserializeAttachment?.();
      if (u?.key && !seen.has(u.key)) seen.set(u.key, { key: u.key, name: u.name });
    }
    return [...seen.values()];
  }

  stateMsg(except) { return { type: 'state', music: publicMusic(this.music, this.now()), listeners: this.listeners(except) }; }

  broadcast(msg, except) {
    const data = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) { if (ws !== except) { try { ws.send(data); } catch { /* closed */ } } }
  }

  /** After any change: save, announce a new song, tell everyone, re-arm the alarm. */
  async commit(prevNowId, except) {
    await this.ctx.storage.put('music', this.music);
    const cur = this.music.now;
    if (cur && cur.id !== prevNowId) await this.announce(cur);
    this.broadcast(this.stateMsg(except), except);
    const at = nextAlarmAt(this.music);
    if (at == null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(at);
  }

  async announce(song) {
    if (this.env.MUSIC_ANNOUNCE !== 'now-playing') return;
    const cards = await this.ctx.storage.get('cards');
    if (!cards?.chat) return;
    try {
      await this.http(`https://api.telegram.org/bot${this.env.BOT_TOKEN}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: cards.chat, parse_mode: 'HTML', text: `🎵 Now playing: <b>${esc(song.title)}</b> (added by ${esc(song.addedBy.name)})` }),
      });
    } catch { /* the group message is optional */ }
  }

  /** Title from YouTube's oEmbed. null = can't be played outside YouTube. */
  async lookupTitle(videoId) {
    try {
      const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`;
      const res = await this.http(url);
      if ([401, 403, 404].includes(res.status)) return null;
      if (!res.ok) return 'YouTube video';
      const data = await res.json();
      return String(data.title || 'YouTube video').slice(0, 120);
    } catch { return 'YouTube video'; }
  }

  // ---------- HTTP from the main Worker ----------
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/set-card') {
      const body = await request.json();
      const cards = (await this.ctx.storage.get('cards')) || { chat: null, ids: [] };
      cards.chat = body.chat;
      cards.ids = [...cards.ids.filter(id => id !== body.messageId), body.messageId].slice(-MAX_CARDS);
      await this.ctx.storage.put('cards', cards);
      return Response.json({ ok: true });
    }
    if (url.pathname === '/is-card') {
      const cards = await this.ctx.storage.get('cards');
      return Response.json({ card: !!cards?.ids.includes(Number(url.searchParams.get('messageId'))) });
    }
    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
      const user = JSON.parse(request.headers.get('X-Arcade-User') || 'null');
      if (!user?.key) return new Response('who are you?', { status: 400 });
      const [client, server] = Object.values(new WebSocketPair());
      await this.connect(server, user);
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response('not found', { status: 404 });
  }

  /** A new listener: accept the socket, resume if the room was paused because it was empty. */
  async connect(ws, user) {
    await this.load();
    this.ctx.acceptWebSocket(ws);
    ws.serializeAttachment({ key: user.key, name: user.name });
    const prev = this.music.now?.id;
    onListenersChanged(this.music, this.listeners().length, this.now());
    await this.commit(prev, ws);
    ws.send(JSON.stringify({ ...this.stateMsg(), you: user.key }));
  }

  // ---------- WebSocket messages (hibernation API) ----------
  async webSocketMessage(ws, raw) {
    await this.load();
    let msg;
    try { msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw)); } catch { return; }
    const me = ws.deserializeAttachment() || {};
    const m = this.music, now = this.now();
    let prev = m.now?.id; // what was playing before this message (re-read after any await)
    const notice = text => ws.send(JSON.stringify({ type: 'notice', text }));
    const keys = () => this.listeners().map(l => l.key);

    switch (msg.type) {
      case 'ping': ws.send(JSON.stringify({ type: 'pong', c: msg.c, s: now })); return;
      case 'add': {
        const videoId = parseVideoId(msg.url);
        if (!videoId) return notice(MESSAGES.notLink);
        const title = await this.lookupTitle(videoId);
        if (title == null) return notice(MESSAGES.blocked);
        prev = this.music.now?.id; // the song may have changed during the lookup
        const entry = { id: crypto.randomUUID().slice(0, 8), videoId, title, seconds: null, addedBy: { key: me.key, name: me.name } };
        const r = addSong(this.music, entry, this.now());
        if (!r.ok) return notice(r.reason);
        break;
      }
      case 'remove': if (!removeSong(m, String(msg.id), me.key).ok) return; break;
      case 'pause': pause(m, now, { manual: true }); break;
      case 'resume': resume(m, now); break;
      case 'skip': voteSkip(m, me.key, keys(), now, String(msg.id)); break;
      case 'duration': {
        const r = setDuration(m, String(msg.id), msg.seconds);
        if (!r.changed) return;
        if (r.tooLong) { const title = m.now.title; advance(m, now); this.broadcast({ type: 'notice', text: MESSAGES.tooLong(title) }); }
        break;
      }
      case 'ended': if (!clientEnded(m, String(msg.id), now)) return; break;
      case 'unplayable': {
        const skipped = unplayable(m, String(msg.id), msg.code, now);
        if (!skipped) return;
        this.broadcast({ type: 'notice', text: MESSAGES.unplayable(skipped.title) });
        break;
      }
      default: return;
    }
    await this.commit(prev);
  }

  async webSocketClose(ws, code) {
    await this.load();
    const prev = this.music.now?.id;
    const left = this.listeners(ws);
    recheckVotes(this.music, left.map(l => l.key), this.now());
    onListenersChanged(this.music, left.length, this.now());
    await this.commit(prev, ws);
    try { ws.close(code, 'bye'); } catch { /* already closed */ }
  }

  async webSocketError() { /* the client reconnects */ }

  async alarm() {
    await this.load();
    const prev = this.music.now?.id;
    onAlarm(this.music, this.now());
    await this.commit(prev);
  }
}

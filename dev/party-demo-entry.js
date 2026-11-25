// Local preview of any party game, no server needed: you play with the party's
// real bots (they fill a game up to 4).
// It runs the real game server (telegram/party-room.js) inside the page, with
// pretend network lag. Build: node dev/party-demo.mjs, then open
// dist/party-demo.html#battle (or #snake, #reaction, #quiz, #boat, #firework,
// #draw, #sync, #market). With no game named it shows a picker.

import css from '../src/ui/arcade.css';
import { createPartyApp } from '../src/party/party-app.js';
import { createSound } from '../src/core/sound.js';
import { join, PARTY_GAMES } from '../src/party/rules.js';
import { PartyRoom } from '../telegram/party-room.js';

const style = document.createElement('style');
style.textContent = css;
document.head.appendChild(style);
document.body.classList.add('ta-fullpage');

const LAG = 150; // round trip, ms (pretend network)
const later = f => setTimeout(f, LAG / 2);
const game = location.hash.slice(1);
const mount = document.getElementById('team-arcade');

if (!PARTY_GAMES[game]) {
  mount.innerHTML = `<div class="ta ta-party"><h2 style="margin:0 0 12px">Party games preview</h2><p class="ta-muted">Pick a game to play against bot players.</p>
    <div style="display:grid;gap:8px;grid-template-columns:repeat(auto-fill,minmax(190px,1fr))">${Object.entries(PARTY_GAMES).map(([k, g]) => `<a class="ta-btn" style="text-align:left" href="#${k}">${g.emoji} ${g.title}</a>`).join('')}</div></div>`;
  window.addEventListener('hashchange', () => location.reload());
} else boot();

async function boot() {
  window.addEventListener('hashchange', () => location.reload());
  // the Durable Object's world: storage, alarms, sockets
  const store = new Map(), sockets = [];
  let alarmTimer = null;
  const ctx = {
    storage: {
      get: async k => structuredClone(store.get(k)),
      put: async (k, v) => { store.set(k, structuredClone(v)); },
      setAlarm: async t => { clearTimeout(alarmTimer); alarmTimer = setTimeout(() => room.alarm(), Math.max(0, t - Date.now())); },
    },
    getWebSockets: () => sockets, acceptWebSocket: ws => sockets.push(ws),
  };
  const telegram = async () => new Response(JSON.stringify({ ok: true, result: { message_id: 1, username: 'demo' } }));
  const room = new PartyRoom(ctx, { BOT_TOKEN: '1:demo' }, { fetch: telegram });
  const duo = !!PARTY_GAMES[game].duo;
  await room.fetch(new Request('http://demo/create', { method: 'POST', body: JSON.stringify({ chat: 1, game, joinSeconds: 4 }) }));

  // what the Worker does for /ws, minus the real socket
  async function connect(user, deliver) {
    const server = { att: null, send: d => later(() => deliver(d)), serializeAttachment(a) { this.att = a; }, deserializeAttachment() { return this.att; }, close() {} };
    ctx.acceptWebSocket(server);
    server.serializeAttachment({ key: user.key, name: user.name });
    join(room.party, { ...user, partyId: room.party.id }, Date.now());
    await room.save();
    server.send(JSON.stringify({ ...room.stateMsg(), you: user.key, joinError: null }));
    room.broadcast(room.stateMsg());
    return raw => later(() => room.webSocketMessage(server, raw));
  }

  // Non-Duo games: the room's own bots fill the seats when it starts (src/party/bots.js).
  // Duo games need a partner, so a stand-in one joins (and just watches).
  if (duo) await connect({ key: 'partner', name: 'Sophea' }, () => {});

  class FakeWS {
    constructor() {
      this.readyState = 0;
      connect({ key: 'me', name: 'You' }, d => this.onmessage?.({ data: d })).then(s => { this.toRoom = s; this.readyState = 1; this.onopen?.(); });
    }
    send(raw) { this.toRoom?.(raw); }
    close() {}
  }
  createPartyApp(mount, { api: 'http://demo', token: 'demo', sound: createSound(), WebSocketImpl: FakeWS, onExit: () => { location.hash = ''; location.reload(); } });
}

// Local preview of Ship Battle with bot ships and pretend network lag, no server needed.
// Build and open:  node dev/battle-demo.mjs  → dist/battle-demo.html?lag=150
// It runs the real battle simulation in the page at the server's 20 updates a
// second, and delays every message by half the round-trip (?lag= ms).

import css from '../src/ui/arcade.css';
import { createPartyApp } from '../src/party/party-app.js';
import { createSound } from '../src/core/sound.js';
import { createParty, join, start, finish, publicState } from '../src/party/rules.js';
import { createBattle, addShip, setInput, step, snapshot, battleStats } from '../src/party/battle.js';

const style = document.createElement('style');
style.textContent = css;
document.head.appendChild(style);
document.body.classList.add('ta-fullpage');

const LAG = Number(new URLSearchParams(location.search).get('lag') ?? 150);
const ME = 'me', BOTS = [['b1', 'Sophea'], ['b2', 'Dara'], ['b3', 'Vuthy']];
const later = f => setTimeout(f, LAG / 2);

class FakeWS {
  constructor() { this.readyState = 1; setTimeout(() => { this.onopen?.(); boot(this); }, 50); }
  send(raw) { const m = JSON.parse(raw); later(() => onClient(m)); }
  close() {}
}

let ws, p, sim;
const out = m => later(() => ws.onmessage?.({ data: JSON.stringify(m) }));
const state = () => out({ type: 'state', party: publicState(p), now: Date.now(), you: ME });

function boot(socket) {
  ws = socket;
  p = createParty({ id: 'demo', chat: 1, seed: 'demo-seed', secret: 's', now: Date.now(), joinSeconds: 2, game: 'battle' });
  join(p, { key: ME, name: 'You' }, Date.now());
  for (const [k, n] of BOTS) join(p, { key: k, name: n }, Date.now());
  state();
  setTimeout(begin, Math.max(0, p.startAt - Date.now()));
}

function begin() {
  start(p);
  sim = createBattle(p.seed);
  for (const [k, pl] of Object.entries(p.players)) addShip(sim, k, pl.name);
  state();
  let t = 0;
  const tick = setInterval(() => {
    if (Date.now() >= p.endAt) { clearInterval(tick); finish(p); state(); return; }
    t += 0.05;
    BOTS.forEach(([k], i) => setInput(sim, k, Math.cos(t * 0.7 + i * 2), Math.sin(t * 0.9 + i)));
    step(sim, 0.05);
    for (const [k, st] of Object.entries(battleStats(sim))) Object.assign(p.players[k], st);
    out({ type: 'snap', t: Date.now(), ...snapshot(sim) });
  }, 50);
}

function onClient(m) {
  if (m.type === 'ping') out({ type: 'pong', c: m.c, s: Date.now() });
  if (m.type === 'input' && sim) setInput(sim, ME, m.mx, m.my);
}

createPartyApp(document.getElementById('team-arcade'), { api: 'http://demo', token: 'demo', sound: createSound(), WebSocketImpl: FakeWS, onExit: () => location.reload() });

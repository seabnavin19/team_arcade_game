// Local preview of the Water Festival Boat Race with bot paddlers, no server needed.
// Build and open:  node dev/boat-demo.mjs  → dist/boat-demo.html  (?bots=2 for a solo race)
// It runs the real race rules in the page and fakes the party room's messages.

import css from '../src/ui/arcade.css';
import { createPartyApp } from '../src/party/party-app.js';
import { createSound } from '../src/core/sound.js';
import { createParty, join, start, finish, publicState } from '../src/party/rules.js';
import { createRace, addRower, paddle, step, snapshot, raceStats, raceSummary, TICK_MS } from '../src/party/boat.js';

const style = document.createElement('style');
style.textContent = css;
document.head.appendChild(style);
document.body.classList.add('ta-fullpage');

const ME = 'me';
const BOTS = [['Dara', 70], ['Sokha', 110], ['Lina', 90], ['Bopha', 140], ['Vanna', 100], ['Rithy', 120], ['Chenda', 80]]
  .slice(0, Math.max(1, Math.min(7, Number(new URLSearchParams(location.search).get('bots')) || 5)));

class FakeWS {
  constructor() { this.readyState = 1; setTimeout(() => { this.onopen?.(); boot(this); }, 50); }
  send(raw) { onClient(JSON.parse(raw)); }
  close() {}
}

let ws, p, sim, timer;
const out = m => setTimeout(() => ws.onmessage?.({ data: JSON.stringify(m) }), 0);
const state = () => out({ type: 'state', party: publicState(p), now: Date.now(), you: ME });
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 1.6;

function boot(socket) {
  ws = socket;
  p = createParty({ id: 'demo', chat: 1, seed: String(Math.random()), secret: String(Math.random()), now: Date.now(), joinSeconds: 45, game: 'boat' });
  join(p, { key: ME, name: 'You' }, Date.now());
  state();
  BOTS.forEach(([name], i) => setTimeout(() => {
    if (p.status !== 'lobby') return;
    join(p, { key: 'bot' + i, name }, Date.now());
    if (BOTS.length >= 3) p.players['bot' + i].crew = i % 2; // bots pick crews, you can join either
    state();
  }, 500 + i * 450));
  boot.t = setTimeout(begin, p.startAt - Date.now());
}

const planned = new Map(); // "bot|beat" → tap time
function bots(now) {
  for (const bt of sim.beats) BOTS.forEach(([, wobble], i) => {
    const id = i + '|' + bt.t;
    if (!planned.has(id)) planned.set(id, Math.random() < 0.06 ? Infinity : bt.t + gauss() * wobble);
    const at = planned.get(id);
    if (at !== null && now >= at) { paddle(sim, 'bot' + i, at, now); planned.set(id, null); }
  });
}

function begin() {
  clearTimeout(boot.t);
  for (const [i] of BOTS.entries()) if (!p.players['bot' + i]) join(p, { key: 'bot' + i, name: BOTS[i][0] }, Date.now());
  start(p);
  state();
  sim = createRace(p.seed, p);
  for (const [k, pl] of Object.entries(p.players)) addRower(sim, k, pl.name);
  timer = setInterval(() => {
    const now = Date.now();
    bots(now);
    step(sim, now);
    out({ type: 'snap', t: now, ...snapshot(sim) });
    if (sim.over) {
      clearInterval(timer);
      for (const [k, st] of Object.entries(raceStats(sim))) Object.assign(p.players[k], st);
      p.summary = raceSummary(sim);
      finish(p); state();
    }
  }, TICK_MS);
}

function onClient(m) {
  if (m.type === 'ping') { out({ type: 'pong', c: m.c, s: Date.now() }); return; }
  if (m.type === 'crew' && p.status === 'lobby') { p.players[ME].crew = Number(m.c); state(); return; }
  if (m.type === 'start-now' && p.status === 'lobby') {
    const len = p.endAt - p.startAt; p.startAt = Date.now() + 3000; p.endAt = p.startAt + len; p.startedBy = 'You'; state();
    clearTimeout(boot.t); boot.t = setTimeout(begin, 3000); return;
  }
  if (m.type === 'paddle' && sim && !sim.over) {
    const r = paddle(sim, ME, Number(m.t), Date.now());
    if (r) out({ type: 'paddle-result', q: r.q });
  }
}

createPartyApp(document.getElementById('team-arcade'), {
  api: 'http://demo', token: 'demo', sound: createSound(), onExit: () => location.reload(), WebSocketImpl: FakeWS,
});

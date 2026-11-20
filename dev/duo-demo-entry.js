// Local preview of Duo Mode with a bot partner, no server needed.
// Build and open:  node dev/duo-demo.mjs  → dist/duo-demo.html?game=sync (or ?game=market)
// It runs the real game rules in the page and fakes the party room's messages.

import css from '../src/ui/arcade.css';
import { createPartyApp } from '../src/party/party-app.js';
import { createSound } from '../src/core/sound.js';
import { createParty, join, start, finish, publicState } from '../src/party/rules.js';
import { buildSync, startSync, pick, advance, roundMsg, syncSummary, ROUNDS } from '../src/party/sync.js';
import { createMarket, addCook, act, step, snapshot, marketStats, marketSummary, cookKey, DISHES, TICK_MS } from '../src/party/market.js';

const style = document.createElement('style');
style.textContent = css;
document.head.appendChild(style);
document.body.classList.add('ta-fullpage');

const game = new URLSearchParams(location.search).get('game') === 'market' ? 'market' : 'sync';
const ME = 'me', BOT = 'bot';

class FakeWS {
  constructor() {
    this.readyState = 1;
    setTimeout(() => { this.onopen?.(); boot(this); }, 50);
  }
  send(raw) { onClient(JSON.parse(raw)); }
  close() {}
}

let ws, p, qs, sim, timer;
const out = m => setTimeout(() => ws.onmessage?.({ data: JSON.stringify(m) }), 0);
const state = () => out({ type: 'state', party: publicState(p), now: Date.now(), you: ME });

function boot(socket) {
  ws = socket;
  p = createParty({ id: 'demo', chat: 1, seed: String(Math.random()), secret: String(Math.random()), now: Date.now(), joinSeconds: 4, game });
  join(p, { key: ME, name: 'You' }, Date.now());
  state();
  setTimeout(() => { join(p, { key: BOT, name: 'Sophea' }, Date.now()); state(); }, 1200);
  boot.t = setTimeout(begin, p.startAt - Date.now());
}

function begin() {
  start(p);
  state();
  if (game === 'sync') {
    qs = buildSync(p.secret);
    startSync(p, Date.now());
    out(roundMsg(p, qs));
    botPick(0);
    timer = setInterval(syncTick, 200);
  } else {
    sim = createMarket(p.seed);
    addCook(sim, ME, 'You'); addCook(sim, BOT, 'Sophea');
    timer = setInterval(marketTick, TICK_MS);
  }
}

// ---------- In Sync ----------
function botPick(i) {
  setTimeout(() => {
    const mine = p.sync?.picks[i]?.[ME];
    const c = mine && Math.random() < 0.65 ? mine.c : Math.floor(Math.random() * 4);
    if (pick(p, BOT, i, c, Date.now()).kind === 'locked') out({ type: 'sync-partner', i, locked: Object.keys(p.sync.picks[i]) });
  }, 1500 + Math.random() * 4000);
}
function syncTick() {
  const r = advance(p, Date.now());
  if (r.reveal) out({ type: 'sync-reveal', ...r.reveal, o: qs[r.reveal.i].o, matches: p.sync.matches, n: ROUNDS, party: publicState(p) });
  if (r.open !== undefined) { out(roundMsg(p, qs)); botPick(r.open); }
  if (r.done) { clearInterval(timer); p.summary = syncSummary(p); finish(p); state(); }
}

// ---------- Night Market ----------
let botCd = 0;
function marketBot() {
  if (--botCd > 0) return;
  botCd = 6 + Math.floor(Math.random() * 6); // a bit slower than a person
  if (cookKey(sim) === BOT) {
    // cook: plate anything ready, else cook what a waiting customer wants
    const ready = sim.burners.findIndex(b => b && !b.burned && b.t >= DISHES[b.d].cook);
    if (ready >= 0) return act(sim, BOT, { type: 'plate', b: ready });
    const burned = sim.burners.findIndex(b => b && b.burned);
    if (burned >= 0) return act(sim, BOT, { type: 'trash', b: burned });
    const want = sim.seats.filter(Boolean).map(c => c.d).find(d => sim.counter.filter(x => x === d).length + sim.burners.filter(b => b && b.d === d).length < sim.seats.filter(c => c && c.d === d).length);
    if (want !== undefined) act(sim, BOT, { type: 'cook', d: want });
  } else {
    for (let s = 0; s < sim.seats.length; s++) {
      if (!sim.seats[s]) continue;
      const c = sim.counter.indexOf(sim.seats[s].d);
      if (c >= 0) return act(sim, BOT, { type: 'serve', c, s });
    }
  }
}
function marketTick() {
  marketBot();
  step(sim);
  out({ type: 'snap', t: Date.now(), ...snapshot(sim) });
  if (Date.now() >= p.endAt) {
    clearInterval(timer);
    const st = marketStats(sim);
    for (const k of Object.keys(st)) Object.assign(p.players[k], st[k]);
    p.summary = marketSummary(sim);
    finish(p); state();
  }
}

// ---------- messages from the screen ----------
function onClient(m) {
  if (m.type === 'ping') { out({ type: 'pong', c: m.c, s: Date.now() }); return; }
  if (m.type === 'start-now') { const len = p.endAt - p.startAt; p.startAt = Date.now() + 3000; p.endAt = p.startAt + len; p.startedBy = 'You'; state(); clearTimeout(boot.t); boot.t = setTimeout(begin, 3000); return; }
  if (m.type === 'pick' && game === 'sync') {
    const r = pick(p, ME, m.i, m.c, Date.now());
    if (r.kind === 'locked') { out({ type: 'sync-locked', i: m.i, c: m.c }); out({ type: 'sync-partner', i: m.i, locked: Object.keys(p.sync.picks[m.i]) }); }
    return;
  }
  if (game === 'market' && sim) act(sim, ME, m);
}

createPartyApp(document.getElementById('team-arcade'), {
  api: 'http://demo', token: 'demo', sound: createSound(), onExit: () => location.reload(), WebSocketImpl: FakeWS,
});

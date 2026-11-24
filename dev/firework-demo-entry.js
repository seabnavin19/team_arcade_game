// Local preview of the Water Festival Firework Show with bot players, no server needed.
// Build and open:  node dev/firework-demo.mjs  → dist/firework-demo.html  (?bots=4&lobby=5&draw=20)
// It runs the real show rules in the page and fakes the party room's messages.

import css from '../src/ui/arcade.css';
import { createPartyApp } from '../src/party/party-app.js';
import { createSound } from '../src/core/sound.js';
import { createParty, join, start, finish, publicState } from '../src/party/rules.js';
import { fromBase64 } from '../src/party/firework-gif.js';
import { createShow, addSparker, submit, rate, artFor, step, snapshot, showStats, showSummary, COLORS, TICK_MS } from '../src/party/firework.js';

const style = document.createElement('style');
style.textContent = css;
document.head.appendChild(style);
document.body.classList.add('ta-fullpage');

const ME = 'me';

// A pretend Telegram group under the game, showing what the bot posts.
const feed = document.createElement('section');
feed.innerHTML = `<style>
  .tg-feed{max-width:520px;margin:18px auto 40px;padding:0 12px;font:15px/1.4 system-ui,sans-serif;color:#e8e6ff}
  .tg-feed h2{font-size:15px;font-weight:700;margin:0 0 10px;color:#9fd3ff;display:flex;gap:8px;align-items:center}
  .tg-feed .room{background:#0e1621;border:1px solid #1f2f3f;border-radius:14px;padding:12px;min-height:80px;display:flex;flex-direction:column;gap:10px}
  .tg-feed .empty{color:#6c7883;font-size:13px;text-align:center;padding:18px 0}
  .tg-feed .msg{align-self:flex-start;max-width:100%;background:#182533;border-radius:12px 12px 12px 4px;overflow:hidden;animation:pop .35s ease-out}
  .tg-feed .msg img{display:block;width:100%;max-width:400px;height:auto}
  .tg-feed .msg p{margin:0;padding:8px 12px;white-space:pre-line}
  .tg-feed .bot{color:#64b5ef;font-weight:700;font-size:13px;padding:8px 12px 0}
  @keyframes pop{from{transform:translateY(8px);opacity:0}}
  @media (prefers-reduced-motion:reduce){.tg-feed .msg{animation:none}}
</style><div class="tg-feed"><h2>📨 Your Telegram group</h2><div class="room"><div class="empty">Each firework is posted here as a GIF when its rating time ends.</div></div></div>`;
document.body.appendChild(feed);
const room = feed.querySelector('.room');
function post(html, gif) {
  room.querySelector('.empty')?.remove();
  const m = document.createElement('div'); m.className = 'msg';
  m.innerHTML = `<div class="bot">Team Arcade Bot</div>${gif ? `<img alt="Firework GIF" src="${URL.createObjectURL(new Blob([gif], { type: 'image/gif' }))}">` : ''}<p>${html}</p>`;
  room.appendChild(m);
}
const gifs = {};
const stars = a => '★'.repeat(Math.round(a)) + '☆'.repeat(5 - Math.round(a));
const escH = t => String(t).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
let chain = Promise.resolve();
function postFirework(e, total) {
  chain = chain.then(async () => {
    for (let w = 0; !gifs[e.i] && w < 8000; w += 250) await new Promise(r => setTimeout(r, 250));
    post(`🎆 <b>Firework ${e.i + 1} of ${total}</b> · by <b>${escH(e.name)}</b>\n${e.n ? `${stars(e.avg)} ${e.avg.toFixed(1)} from ${e.n} ${e.n === 1 ? 'rating' : 'ratings'}` : 'No ratings'}`, gifs[e.i]);
  });
}
const q = new URLSearchParams(location.search);
const BOTS = ['Dara', 'Sokha', 'Lina', 'Bopha', 'Vanna'].slice(0, Math.max(1, Math.min(5, Number(q.get('bots')) || 3)));

// Bot drawings: a lotus, a star, a heart, a smiley, a spiral.
const poly = (f, n, c) => ({ c, pts: Array.from({ length: n + 1 }, (_, i) => f((i / n) * Math.PI * 2)).flat().map(Math.round) });
const BOT_ART = [
  [0, 1, 2, 3, 4].map(k => poly(a => [400 + Math.sin(a) * 40 + Math.cos(k * 1.26) * 70, 230 - Math.abs(Math.cos(a)) * 90 + Math.sin(k * 1.26) * 10], 30, COLORS[4])).concat([poly(a => [400 + Math.cos(a) * 140, 300 + Math.sin(a) * 10], 40, COLORS[2])]),
  [poly(a => { const r = Math.round(a / (Math.PI / 5)) % 2 ? 60 : 140; return [400 + Math.sin(a) * r, 230 - Math.cos(a) * r]; }, 10, COLORS[1])],
  [poly(a => [400 + 130 * Math.pow(Math.sin(a), 3), 210 - (100 * Math.cos(a) - 40 * Math.cos(2 * a) - 18 * Math.cos(3 * a) - 8 * Math.cos(4 * a))], 60, COLORS[0])],
  [poly(a => [400 + Math.cos(a) * 120, 230 + Math.sin(a) * 120], 50, COLORS[1]), poly(a => [360 + Math.cos(a) * 12, 200 + Math.sin(a) * 12], 12, COLORS[3]), poly(a => [440 + Math.cos(a) * 12, 200 + Math.sin(a) * 12], 12, COLORS[3]), { c: COLORS[5], pts: Array.from({ length: 21 }, (_, i) => [340 + i * 6, 270 + Math.sin((i / 20) * Math.PI) * 35]).flat().map(Math.round) }],
  [{ c: COLORS[6], pts: Array.from({ length: 120 }, (_, i) => [400 + Math.cos(i / 6) * i * 1.2, 230 + Math.sin(i / 6) * i * 1.2]).flat().map(Math.round) }],
];

class FakeWS {
  constructor() { this.readyState = 1; setTimeout(() => { this.onopen?.(); boot(this); }, 50); }
  send(raw) { onClient(JSON.parse(raw)); }
  close() {}
}

let ws, p, sim, timer;
const out = m => setTimeout(() => ws.onmessage?.({ data: JSON.stringify(m) }), 0);
const state = () => out({ type: 'state', party: publicState(p), now: Date.now(), you: ME });

function boot(socket) {
  ws = socket;
  p = createParty({ id: 'demo', chat: 1, seed: String(Math.random()), now: Date.now(), joinSeconds: Number(q.get('lobby')) || 8, game: 'firework' });
  join(p, { key: ME, name: 'You' }, Date.now());
  BOTS.forEach((name, i) => join(p, { key: 'bot' + i, name }, Date.now()));
  state();
  boot.t = setTimeout(begin, p.startAt - Date.now());
}

function begin() {
  clearTimeout(boot.t);
  start(p); state();
  sim = createShow(p.seed, p);
  if (q.get('draw')) sim.drawEnd = p.startAt + Number(q.get('draw')) * 1000;
  for (const [k, pl] of Object.entries(p.players)) addSparker(sim, k, pl.name);
  BOTS.forEach((_, i) => setTimeout(() => submit(sim, 'bot' + i, BOT_ART[i % BOT_ART.length], Date.now()), 3000 + i * 1500));
  const rated = new Set();
  timer = setInterval(() => {
    const now = Date.now();
    if (sim.phase === 'show') BOTS.forEach((_, i) => {
      const id = `${i}|${sim.i}`;
      if (!rated.has(id) && now - sim.showAt > 3000 + i * 700) { rated.add(id); rate(sim, 'bot' + i, sim.i, 2 + Math.floor(Math.random() * 4)); }
    });
    step(sim, now);
    for (const e of sim.events) {
      if (e.e === 'show') out({ type: 'fw-render', i: e.i, art: artFor(sim, e.i), seed: `${p.seed}:${e.i}` }); // this screen makes the GIF
      if (e.e === 'rated') postFirework(e, sim.order.length);
    }
    out({ type: 'snap', t: now, ...snapshot(sim) });
    if (sim.over) {
      clearInterval(timer);
      for (const [k, st] of Object.entries(showStats(sim))) Object.assign(p.players[k], st);
      p.summary = showSummary(sim);
      finish(p); state();
      const s = p.summary;
      chain = chain.then(() => post(`🎆 <b>Water Festival Firework Show</b> · ${s.drew} fireworks\n\n${s.ranked.map((r, i) => `${['🥇', '🥈', '🥉'][i] || `${i + 1}.`} <b>${escH(r.name)}</b> · ${stars(r.avg)} ${r.avg.toFixed(1)}`).join('\n')}${s.ranked[0] ? `\n\n🎉 <b>${escH(s.ranked[0].name)}</b> made the crowd's favourite firework!` : ''}`));
    }
  }, TICK_MS);
}

function onClient(m) {
  if (m.type === 'ping') { out({ type: 'pong', c: m.c, s: Date.now() }); return; }
  if (m.type === 'start-now' && p.status === 'lobby') {
    const len = p.endAt - p.startAt; p.startAt = Date.now() + 3000; p.endAt = p.startAt + len; p.startedBy = 'You'; state();
    clearTimeout(boot.t); boot.t = setTimeout(begin, 3000); return;
  }
  if (!sim) return;
  if (m.type === 'fw-submit') { const r = submit(sim, ME, m.strokes, Date.now()); if (r.kind === 'saved') out({ type: 'fw-saved', points: r.points }); }
  if (m.type === 'fw-rate') { const r = rate(sim, ME, Number(m.i), m.stars); if (r.kind !== 'invalid') out({ type: 'fw-rated', ...r }); }
  if (m.type === 'fw-gif') { try { gifs[Number(m.i)] = fromBase64(m.data); } catch { /* ignore */ } }
  if (m.type === 'fw-art' && sim.phase === 'show' && Number(m.i) === sim.i) out({ type: 'fw-art', i: sim.i, art: artFor(sim, sim.i) });
}

createPartyApp(document.getElementById('team-arcade'), {
  api: 'http://demo', token: 'demo', sound: createSound(), onExit: () => location.reload(), WebSocketImpl: FakeWS,
});

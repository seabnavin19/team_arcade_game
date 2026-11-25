// The live party screen: lobby → synced Reaction Tap round → results.

import { timelineFor, PARTY_GAMES } from './rules.js';
import { createBattleView } from './battle-view.js';
import { createHeatView, heatLayout } from './heat-view.js';
import { PARTY_SIZE } from './bots.js';
import { fitLayout, fromScreen, createSpace } from './screen-fit.js';
import { createQuizView } from './quiz-view.js';
import { createSnakeView } from './snake-view.js';
import { createDrawView } from './draw-view.js';
import { QUESTIONS } from './quiz.js';
import { createSyncView } from './sync-view.js';
import { createMarketView } from './market-view.js';
import { createBoatView, crewLobbyHtml } from './boat-view.js';
import { assignCrews } from './boat.js';
import { createFireworkView } from './firework-view.js';
import { ROUNDS as SYNC_ROUNDS } from './sync.js';
import { radiusAt, W, H, DURATION } from '../games/reaction.js';
import { createLoop } from '../core/loop.js';
import { createInput } from '../core/input.js';
import { C, MONO, glowCircle, drawHud, Particles, FloatText } from '../games/draw.js';
import { ICONS } from '../ui/icons.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PLAYER_COLORS = [C.magenta, C.yellow, C.lime, '#a98bff', '#ff7a59', '#59c3ff', '#f0e6c8'];
const MEDALS = ['🥇', '🥈', '🥉'];
const fmt = n => Math.round(n).toLocaleString('en-US');

export function createPartyApp(root, { api, token, sound, onExit, WebSocketImpl = globalThis.WebSocket }) {
  root.innerHTML = `
    <div class="ta ta-party" data-ta>
      <header class="ta-top">
        <div class="ta-brand"><span class="ta-brand-a">TEAM</span><span class="ta-brand-b">ARCADE</span></div>
        <div class="ta-week" data-mode>⚡ Live party</div>
        <button class="ta-iconbtn" data-sound type="button"></button>
      </header>
      <section class="ta-party-lobby" data-lobby>
        <h2 class="ta-party-title" data-title>Party</h2>
        <div class="ta-party-count" data-count>…</div>
        <div class="ta-party-sub" data-sub>Connecting…</div>
        <ul class="ta-party-players" data-players></ul>
        <div data-crews></div>
        <button class="ta-btn ta-party-start" type="button" data-startnow hidden>▶ Start now</button>
        <div class="ta-party-note" data-note></div>
        <p class="ta-party-rules" data-rules></p>
        <p class="ta-party-controls" data-controls></p>
      </section>
      <section class="ta-party-game" data-game hidden>
        <div class="ta-draw-top" data-drawtop hidden></div>
        <div class="ta-live-row">
        <div class="ta-canvas-wrap" data-canvaswrap><canvas data-canvas tabindex="0"></canvas><div class="ta-overlay" data-overlay></div></div>
        <div class="ta-side">
        <div class="ta-boat" data-boat hidden></div>
        <div class="ta-fw" data-fw hidden></div>
        <div class="ta-quiz" data-quiz hidden></div>
        <div class="ta-quiz ta-duo" data-duo hidden></div>
        <div class="ta-draw-ui" data-drawui hidden></div>
        <div class="ta-dpad" data-dpad hidden>
          <button type="button" data-d="up" aria-label="Up">▲</button>
          <button type="button" data-d="left" aria-label="Left">◀</button>
          <button type="button" data-d="right" aria-label="Right">▶</button>
          <button type="button" data-d="down" aria-label="Down">▼</button>
        </div>
        </div>
        </div>
        <ol class="ta-party-board" data-board></ol>
        <p class="ta-rotate">Tip: turn your phone sideways for a bigger game.</p>
      </section>
      <section class="ta-party-results" data-results hidden></section>
    </div>`;
  const $ = s => root.querySelector(`[data-${s}]`);
  const el = { root: $('ta'), fw: $('fw'), boat: $('boat'), crews: $('crews'), mode: $('mode'), duo: $('duo'), drawtop: $('drawtop'), drawui: $('drawui'), dpad: $('dpad'), canvaswrap: $('canvaswrap'), quiz: $('quiz'), startnow: $('startnow'), note: $('note'), title: $('title'), rules: $('rules'), controls: $('controls'), lobby: $('lobby'), count: $('count'), sub: $('sub'), players: $('players'), game: $('game'), canvas: $('canvas'), overlay: $('overlay'), board: $('board'), results: $('results'), sound: $('sound') };

  const renderSound = () => { el.sound.innerHTML = sound.on ? ICONS.sound : ICONS.muted; el.sound.title = sound.on ? 'Sound on' : 'Sound off'; };
  el.sound.addEventListener('click', () => { sound.toggle(); renderSound(); });
  el.crews.addEventListener('click', e => { const b = e.target.closest('[data-crew]'); if (b) send({ type: 'crew', c: Number(b.dataset.crew) }); });
  el.startnow.addEventListener('click', () => { el.startnow.disabled = true; send({ type: 'start-now' }); });
  renderSound();

  // ---------- state ----------
  let party = null, me = null, timeline = null, offset = 0, bestRtt = Infinity;
  let ws = null, retries = 0, closed = false, fatal = null;
  const hidden = new Set();          // targets gone for me (tapped by anyone, or my fake)
  const takenAt = new Map();         // target → when someone else took it (for "too slow!")
  const colorOf = new Map();
  const parts = new Particles(), floats = new FloatText();
  const serverNow = () => Date.now() + offset;
  const color = key => { if (!colorOf.has(key)) colorOf.set(key, PLAYER_COLORS[colorOf.size % PLAYER_COLORS.length]); return colorOf.get(key); };

  // ---------- network ----------
  const wsUrl = `${api.replace(/^http/, 'ws')}/party/ws?t=${encodeURIComponent(token)}`;
  function connect() {
    if (closed) return;
    try { ws = new WebSocketImpl(wsUrl); } catch { scheduleReconnect(); return; }
    ws.onopen = () => { retries = 0; for (let i = 0; i < 4; i++) setTimeout(() => send({ type: 'ping', c: Date.now() }), i * 250); };
    ws.onmessage = e => { try { onMessage(JSON.parse(e.data)); } catch { /* ignore bad message */ } };
    ws.onclose = () => { if (!closed && party?.status !== 'done' && party?.status !== 'cancelled') scheduleReconnect(); };
  }
  function scheduleReconnect() {
    if (++retries > 10) { fatal = "Lost connection to the party. Check your internet, then tap Join the party again."; render(); return; }
    el.sub.textContent = 'Reconnecting…';
    setTimeout(connect, Math.min(4000, 500 * retries));
  }
  const send = m => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };

  function onMessage(m) {
    if (m.type === 'pong') {
      const rtt = Date.now() - m.c;
      if (rtt < bestRtt) { bestRtt = rtt; offset = m.s + rtt / 2 - Date.now(); }
      return;
    }
    if (m.type === 'state') {
      if (m.you) me = m.you;
      if (m.joinError) fatal = m.joinError;
      if (bestRtt === Infinity && m.now) offset = m.now - Date.now(); // rough until pings return
      setParty(m.party);
    } else if (m.type === 'event') {
      setParty(m.party);
      const tg = timeline?.[m.i];
      if (m.kind === 'hit' && tg) {
        hidden.add(m.i);
        if (m.key !== me) takenAt.set(m.i, performance.now());
        parts.burst(tg.x, tg.y, m.key === me ? C.cyan : color(m.key), 16);
        floats.add(tg.x, tg.y - 12, m.key === me ? `+${m.points}` : m.name, m.key === me ? C.lime : color(m.key));
        if (m.key === me) sound.hit();
      } else if (m.kind === 'fake' && m.key === me && tg) {
        parts.burst(tg.x, tg.y, C.red, 18); floats.add(tg.x, tg.y - 12, `${m.points}`, C.red); sound.bad();
      }
    } else if (['round', 'strokes', 'chat', 'guessed', 'you-guessed', 'close-guess', 'reveal'].includes(m.type) && drawView) {
      if (m.party) setParty(m.party);
      drawView.onMessage(m);
    } else if (m.type === 'sync-round') { syncView?.onRound(m);
    } else if (m.type === 'sync-locked') { syncView?.onLocked(m);
    } else if (m.type === 'sync-partner') { syncView?.onPartner(m);
    } else if (m.type === 'sync-reveal') { setParty(m.party); syncView?.onReveal(m);
    } else if (m.type === 'question') { quizView?.onQuestion(m);
    } else if (m.type === 'locked') { quizView?.onLocked(m);
    } else if (m.type === 'answered') { quizView?.onAnswered(m);
    } else if (m.type === 'reveal') { setParty(m.party); quizView?.onReveal(m);
    } else if (m.type === 'notice') {
      el.note.textContent = m.text; el.startnow.disabled = false;
    } else if (m.type === 'paddle-result') { boatView?.onResult(m);
    } else if (m.type === 'fw-art' || m.type === 'fw-saved' || m.type === 'fw-rated' || m.type === 'fw-render') { fwView?.onMessage(m);
    } else if (m.type === 'snap') {
      if (fwView) { fwView.onSnap(m); return; }
      if (boatView) { boatView.onSnap(m); return; }
      if (marketView) { marketView.onSnap(m); if (party) party.players.forEach(pl => { pl.score = m.tips; }); if (performance.now() - lastBoard > 400) { lastBoard = performance.now(); render(); } return; }
      battle?.onSnap(m);
      liveBattleScores(m);
    } else if (m.type === 'taken') {
      const tg = timeline?.[m.i];
      if (tg) floats.add(tg.x, tg.y - 12, 'too slow!', C.muted);
    }
  }

  // During a battle the scores arrive in the 20-per-second updates, not as
  // separate events, so keep the live scoreboard in step from those.
  let lastBoard = 0;
  function liveBattleScores(m) {
    if (!party) return;
    if (m.ships) for (const sh of m.ships) {
      const pl = party.players.find(p => p.key === m.who[sh[0]]);
      if (pl) { pl.kos = sh[8]; pl.downs = sh[9]; pl.score = sh[8]; }
    }
    if (m.cars) for (const c of m.cars) {
      const pl = party.players.find(p => p.key === m.who[c[0]]);
      if (pl) { pl.score = c[6]; pl.downs = pl.downs || 0; }
    }
    if (m.snakes) for (const sn of m.snakes) {
      const pl = party.players.find(p => p.key === m.who[sn[0]]);
      if (pl) { pl.score = sn[2]; pl.downs = pl.downs || 0; }
    }
    party.players.sort((a, b) => b.score - a.score || a.downs - b.downs);
    let place = 0;
    party.players.forEach((p, i, arr) => { if (i === 0 || p.score !== arr[i - 1].score || p.downs !== arr[i - 1].downs) place = i + 1; p.place = place; });
    if (performance.now() - lastBoard > 400) { lastBoard = performance.now(); render(); }
  }

  function setParty(p) {
    if (!p) return;
    const first = !party || party.id !== p.id;
    party = p;
    if (first && !PARTY_GAMES[p.game]) {
      // The server started a game this copy of the page doesn't know: it's out of date.
      fatal = 'This party uses a game your screen doesn’t have yet. Tap Reload to get the newest version.';
      render();
      const btn = document.createElement('button');
      btn.className = 'ta-btn'; btn.type = 'button'; btn.textContent = 'Reload';
      btn.addEventListener('click', () => { const u = new URL(location.href); u.searchParams.set('v', String(Date.now())); location.replace(u.toString()); });
      el.results.querySelector('.ta-result-actions')?.prepend(btn);
      return;
    }
    if (first) {
      timeline = timelineFor(p); hidden.clear();
      const g = PARTY_GAMES[p.game] || PARTY_GAMES.reaction;
      el.title.textContent = g.duo ? `${g.emoji} ${g.title}` : `${g.emoji} ${g.title} Party`;
      el.mode.textContent = g.duo ? '💞 Duo Mode' : '⚡ Live party';
      el.rules.textContent = g.pitch;
      el.controls.textContent = p.game === 'heat'
        ? 'Controls: arrow keys or WASD: ▲ gas, ▼ brake (hold to reverse), ◀ ▶ steer. On a phone the same arrows are on screen: ◀ ▶ bottom left, ▲ ▼ bottom right. Press two at once to steer while driving.'
        : p.game === 'battle'
        ? 'Controls: move with the mouse, arrow keys or WASD. On a phone, put your thumb down anywhere and drag: it works like a joystick.'
        : p.game === 'quiz' ? 'Controls: tap an answer, or press 1–4. You get one try per puzzle.'
        : p.game === 'snake' ? 'Controls: arrow keys or WASD. On a phone, swipe on the board or use the arrow buttons.'
        : p.game === 'draw' ? 'When it’s your turn, draw with your mouse or finger. Otherwise type your guesses. 3 rounds, and players take turns drawing.'
        : p.game === 'sync' ? 'Controls: tap an answer, or press 1–4. Your partner can’t see your pick until the reveal.'
        : p.game === 'boat' ? 'Controls: tap Paddle (or the river, or press Space) on each drum beat. Watch the shrinking ring: tap when it closes.'
        : p.game === 'firework' ? 'Draw with your mouse or finger and pick colours. Then watch the show and tap 1–5 stars for each firework (not your own).'
        : p.game === 'market' ? 'Cook: tap a dish (or press 1–3) to start it, then tap it when it’s ready. Server: tap a customer to hand them their dish.'
        : 'Controls: click or tap the targets.';
      el.canvaswrap.hidden = p.game === 'quiz' || !!g.duo;
      el.quiz.hidden = p.game !== 'quiz';
      el.duo.hidden = !g.duo;
      if (p.game === 'sync' && !syncView) syncView = createSyncView(el.duo, { send, serverNow, getMe: () => me, getParty: () => party, sound, input });
      el.boat.hidden = p.game !== 'boat';
      el.board.hidden = p.game === 'boat' || p.game === 'firework'; // firework ratings stay secret until the end
      el.fw.hidden = p.game !== 'firework';
      if (p.game === 'firework' && !fwView) fwView = createFireworkView({ ctx, panel: el.fw, input, send, serverNow, getParty: () => party, getMe: () => me, sound });
      if (p.game === 'boat' && !boatView) boatView = createBoatView({ ctx, panel: el.boat, input, send, serverNow, getParty: () => party, getMe: () => me, sound, parts, floats });
      if (p.game === 'market' && !marketView) marketView = createMarketView(el.duo, { send, serverNow, getMe: () => me, getParty: () => party, sound });
      if (p.game === 'quiz' && !quizView) quizView = createQuizView(el.quiz, { send, serverNow, getMe: () => me, sound, input });
      if (p.game === 'battle' && !battle) battle = createBattleView({ ctx, input, send, serverNow, getParty: () => party, getMe: () => me, color, sound, parts, view: screenView, rtt: () => bestRtt });
      el.drawtop.hidden = el.drawui.hidden = p.game !== 'draw';
      if (p.game === 'draw' && !drawView) drawView = createDrawView({ ctx, top: el.drawtop, ui: el.drawui, input, send, serverNow, getMe: () => me, sound });
      if (p.game === 'heat' && !battle) battle = createHeatView({ ctx, input, send, serverNow, getParty: () => party, getMe: () => me, color, sound, parts, floats, view: screenView, rtt: () => bestRtt });
      if (p.game === 'snake' && !battle) battle = createSnakeView({ ctx, input, send, serverNow, getParty: () => party, getMe: () => me, color, sound, parts, floats, dpad: el.dpad, view: screenView });
      let touchOnly = false;
      try { touchOnly = !window.matchMedia('(any-pointer: fine)').matches; } catch { /* old browser */ }
      el.dpad.hidden = !(p.game === 'snake' && touchOnly);
    }
    for (const [i] of Object.entries(p.claimed || {})) hidden.add(Number(i));
    p.players.forEach(pl => color(pl.key));
    render();
  }

  // ---------- screens ----------
  function render() {
    const status = fatal ? 'error' : party?.status || 'connecting';
    el.lobby.hidden = !(status === 'lobby' || status === 'connecting');
    el.game.hidden = status !== 'running';
    const live = status === 'running';
    if (el.root.classList.contains('is-live') !== live) { el.root.classList.toggle('is-live', live); el.root.classList.toggle('is-live-canvas', live && !el.canvaswrap.hidden); fitCanvas(); }
    el.results.hidden = !(status === 'done' || status === 'cancelled' || status === 'error');

    if (party) {
      const list = party.players.map(pl => `<li style="--c:${color(pl.key)}" class="${pl.key === me ? 'is-me' : ''}">${esc(pl.name)}</li>`).join('');
      el.players.innerHTML = list || '<li class="ta-muted">Nobody yet…</li>';
      const n = party.players.length;
      const inLobby = party.status === 'lobby';
      el.crews.innerHTML = party.game === 'boat' && inLobby ? crewLobbyHtml(party, me, assignCrews) : '';
      const startingSoon = inLobby && party.startedBy;
      const seats = PARTY_SIZE - n;
      el.sub.textContent = party.duo ? `${n} of 2 players in · one team, one score`
        : `${n} ${n === 1 ? 'player' : 'players'} in${inLobby && seats > 0 ? ` · 🤖 ${seats} ${seats === 1 ? 'bot' : 'bots'} will join to make ${PARTY_SIZE}` : ''}`;
      el.startnow.hidden = !(inLobby && !startingSoon && n >= (party.minPlayers || 1) && party.players.some(p => p.key === me));
      el.note.textContent = startingSoon ? `${party.startedBy} started the ${party.duo ? 'game' : 'party'}!` : (inLobby && n < (party.minPlayers || 1) ? 'Waiting for your partner to tap Join the duo…' : '');
      if (party.duo) {
        const team = party.players.map(pl => esc(pl.key === me ? 'You' : pl.name)).join(' ♥ ');
        const sc = party.players[0]?.score || 0;
        el.board.innerHTML = `<li class="is-me ta-duo-team" style="--c:var(--magenta)"><span class="ta-name">${team}</span><span class="ta-score">${party.game === 'market' ? `$${fmt(sc)}` : fmt(sc)}</span></li>`;
      } else {
      const val = pl => (party.game === 'heat' ? `$${(pl.score || 0).toLocaleString('en-US')}` : party.game === 'battle' ? `${pl.kos || 0} KO` : party.game === 'snake' ? `${pl.score} pts` : fmt(pl.score));
      el.board.innerHTML = party.players.map(pl => `
        <li class="${pl.key === me ? 'is-me' : ''}" style="--c:${color(pl.key)}"><span class="ta-place">${pl.place}</span><span class="ta-name">${esc(pl.name)}</span><span class="ta-score">${val(pl)}</span></li>`).join('');
      }
    }
    if (status === 'error') showResults(`<p class="ta-warn">${esc(fatal)}</p>`);
    if (status === 'cancelled') showResults(party.duo
      ? '<p>Your partner didn’t join in time, so the game was cancelled.<br>Send <b>/duo</b> in the group to try again.</p>'
      : '<p>Not enough players joined, so the party was cancelled.<br>Send <b>/party</b> in the group to try again.</p>');
    if (status === 'done' && party.duo) {
      const names = party.players.map(p => esc(p.key === me ? 'You' : p.name)).join(' ♥ ');
      const sc = party.players[0]?.score || 0, s = party.summary || {};
      const big = party.game === 'sync' ? `${s.percent || 0}%` : `$${fmt(sc)}`;
      const label = party.game === 'sync' ? 'In sync' : 'Tips earned together';
      const meta = party.game === 'sync'
        ? `${s.matches || 0} of ${SYNC_ROUNDS} matched · ${fmt(sc)} points${s.best >= 3 ? ` · best streak ${s.best}` : ''}`
        : `${s.served || 0} served · ${s.walked || 0} walked out · ${s.burned || 0} burned`;
      showResults(`<div class="ta-result-label">${label}</div><div class="ta-result-score">${big}</div><div class="ta-result-meta">${names}</div><p class="ta-result-status">${meta}</p><p class="ta-muted">The week’s top duos are in the group. Send <b>/duo board</b> to see them.</p>`);
    } else if (status === 'done' && party.game === 'boat') {
      const s = party.summary || { boats: [] };
      const myName = party.players.find(p => p.key === me)?.name;
      const myBoat = s.boats.find(b => (s.mode === 'crews' ? b.members.includes(myName) : b.name === myName));
      const time = b => (b.ms ? `${(b.ms / 1000).toFixed(1)} s` : `${Math.round(b.x / 10)}%`);
      showResults(`
        <div class="ta-result-label">${s.boats[0] ? `${esc(s.boats[0].name)} ${s.mode === 'crews' ? 'crew wins' : 'wins'}` : 'Race over'}</div>
        <div class="ta-result-score">${myBoat ? (MEDALS[myBoat.place - 1] || `#${myBoat.place}`) : '🚣'}</div>
        <div class="ta-result-meta">${myBoat ? `${s.mode === 'crews' ? `Your crew ${esc(myBoat.name)}` : 'You'} finished ${myBoat.place === 1 ? 'first' : `#${myBoat.place}`}${myBoat.ms ? ` in ${time(myBoat)}` : ''}` : ''}</div>
        <ol class="ta-party-final">${s.boats.map(b => `<li class="${b === myBoat ? 'is-me' : ''}"><span>${MEDALS[b.place - 1] || `${b.place}.`}</span><span class="ta-name">${esc(b.name)}${s.mode === 'crews' ? ` <small class="ta-muted">${esc(b.members.join(', '))}</small>` : ''}</span><span class="ta-score">${time(b)}</span></li>`).join('')}</ol>
        ${s.best ? `<p class="ta-result-status">🏅 Best paddler: <b>${esc(s.best.name)}</b>, ${s.best.pct}% on the beat</p>` : ''}
        ${s.sync ? `<p class="ta-result-status">🥁 Best sync: <b>${esc(s.sync.name)}</b>, ${s.sync.streak} strokes together</p>` : ''}`);
    } else if (status === 'done' && party.game === 'firework') {
      const s = party.summary || { ranked: [] };
      const myName = party.players.find(p => p.key === me)?.name;
      const stars = a => `${'★'.repeat(Math.round(a))}<span class="ta-muted">${'★'.repeat(5 - Math.round(a))}</span>`;
      let place = 0;
      const rows = s.ranked.map((r, i, arr) => { if (i === 0 || r.avg !== arr[i - 1].avg) place = i + 1; return { ...r, place }; });
      const mine = rows.find(r => r.name === myName);
      showResults(`
        <div class="ta-result-label">${rows[0] ? `Crowd favourite: ${esc(rows[0].name)}` : 'The show is over'}</div>
        <div class="ta-result-score">${mine ? (MEDALS[mine.place - 1] || `#${mine.place}`) : '🎆'}</div>
        <div class="ta-result-meta">${!mine ? 'You didn’t launch a firework this time.' : mine.n ? `Your firework: ${mine.avg.toFixed(1)} ★ from ${mine.n} ${mine.n === 1 ? 'rating' : 'ratings'}` : 'Your firework was sent to the group as a GIF 🎆'}</div>
        <ol class="ta-party-final">${rows.map(r => `<li class="${r === mine ? 'is-me' : ''}"><span>${MEDALS[r.place - 1] || `${r.place}.`}</span><span class="ta-name">${esc(r.name)}</span><span class="ta-score">${r.n ? `${stars(r.avg)} ${r.avg.toFixed(1)}` : '<span class="ta-muted">no ratings</span>'}</span></li>`).join('')}</ol>
        ${s.fan ? `<p class="ta-result-status">👏 Most generous critic: <b>${esc(s.fan.name)}</b> (${s.fan.given} ratings)</p>` : ''}`);
    } else if (status === 'done') {
      const mine = party.players.find(p => p.key === me);
      showResults(`
        ${mine ? `<div class="ta-result-label">You finished</div><div class="ta-result-score">${MEDALS[mine.place - 1] || `#${mine.place}`}</div><div class="ta-result-meta">${detail(mine)}</div>` : ''}
        <ol class="ta-party-final">${party.players.map(p => `<li class="${p.key === me ? 'is-me' : ''}"><span>${MEDALS[p.place - 1] || `${p.place}.`}</span><span class="ta-name">${esc(p.name)}</span><span class="ta-score">${party.game === 'heat' ? `$${(p.score || 0).toLocaleString('en-US')}` : party.game === 'battle' ? `${p.kos || 0} KO` : party.game === 'snake' ? `${p.score} pts` : fmt(p.score)}</span></li>`).join('')}</ol>`);
    }
  }
  function detail(pl) {
    if (party.game === 'quiz') return `${fmt(pl.score)} points · ${pl.hits}/${QUESTIONS} right`;
    if (party.game === 'draw') return `${fmt(pl.score)} points · guessed ${pl.hits} ${pl.hits === 1 ? 'drawing' : 'drawings'}`;
    if (party.game === 'heat') return `$${(pl.score || 0).toLocaleString('en-US')} banked · ${pl.hits || 0} grabs · ${pl.kos || 0} steals · busted ${pl.downs || 0}×`;
    if (party.game === 'snake') return `${pl.score} points · ${pl.hits || 0} food · ${pl.kos || 0} ${pl.kos === 1 ? 'KO' : 'KOs'} · crashed ${pl.downs || 0}×`;
    return party.game === 'battle'
      ? `${pl.kos || 0} ${pl.kos === 1 ? 'KO' : 'KOs'} · knocked out ${pl.downs || 0}× · ${pl.hits || 0} hits`
      : `${fmt(pl.score)} points · ${pl.hits} hits${pl.fakes ? ` · ${pl.fakes} fakes` : ''}`;
  }
  function showResults(html) {
    el.results.innerHTML = `<div class="ta-result">${html}<div class="ta-result-actions"><button class="ta-btn" type="button" data-exit>Back to arcade</button></div></div>`;
    el.results.querySelector('[data-exit]').addEventListener('click', exit);
  }

  // ---------- the game ----------
  const ctx = (() => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    el.canvas.width = W * dpr; el.canvas.height = H * dpr;
    const c = el.canvas.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); return c;
  })();
  const input = createInput(el.canvas, { width: W, height: H, captureAllKeys: false });

  // While a game runs it fills the screen: the canvas is sized to the space
  // left over. Arena games (Ship Battle, Snake, Reaction Tap) also turn
  // sideways on an upright phone; games with drawings or a river stay landscape.
  const ROTATES = new Set(['battle', 'snake', 'reaction']);
  const screenView = { portrait: false, sw: W, sh: H, css: 1 };
  const space = createSpace(ctx, screenView);
  input.setMap((u, v) => fromScreen(screenView, u, v));
  function fitCanvas() {
    if (!el.root.classList.contains('is-live-canvas')) return;
    const bw = el.canvaswrap.clientWidth, bh = el.canvaswrap.clientHeight;
    if (!bw || !bh) return;
    // Street Heat follows your car, so it simply shows more street on a bigger or taller screen
    Object.assign(screenView, party?.game === 'heat' ? heatLayout(bw, bh) : fitLayout(bw, bh, { rotate: ROTATES.has(party?.game) }));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = Math.floor(screenView.sw * screenView.css), ch = Math.floor(screenView.sh * screenView.css);
    el.canvas.style.width = `${cw}px`; el.canvas.style.height = `${ch}px`;
    const pw = Math.round(cw * dpr), ph = Math.round(ch * dpr);
    if (el.canvas.width !== pw || el.canvas.height !== ph) { el.canvas.width = pw; el.canvas.height = ph; }
  }
  let resizeObs = null;
  try { resizeObs = new ResizeObserver(fitCanvas); resizeObs.observe(el.canvaswrap); } catch { /* old browser */ }
  window.addEventListener('resize', fitCanvas);
  window.addEventListener('orientationchange', fitCanvas);
  let battle = null;
  let quizView = null;
  let boatView = null;
  let fwView = null;
  let drawView = null;
  let syncView = null;
  let marketView = null;
  input.on('pointerdown', pt => {
    if (party?.status !== 'running' || party.game !== 'reaction') return;
    const t = (serverNow() - party.startAt) / 1000;
    for (let i = timeline.length - 1; i >= 0; i--) {
      const tg = timeline[i], age = t - tg.t;
      if (age < 0 || age > tg.life || hidden.has(i)) continue;
      if (Math.hypot(pt.x - tg.x, pt.y - tg.y) <= radiusAt(tg, age) + 6) {
        if (tg.fake) hidden.add(i); // gone for me only; others may still fall for it
        send({ type: 'hit', i, age: Math.round(age * 1000) / 1000 });
        return;
      }
    }
    // Tapping a target someone else grabbed a moment ago is "too slow", not a miss.
    const nowMs = performance.now();
    for (const [i, at] of takenAt) {
      const tg = timeline[i];
      if (nowMs - at < 700 && Math.hypot(pt.x - tg.x, pt.y - tg.y) <= tg.r + 8) { floats.add(tg.x, tg.y - 12, 'too slow!', C.muted); return; }
    }
    send({ type: 'miss' });
    floats.add(pt.x, pt.y, '−25', C.muted); sound.miss();
  });

  let lastBeep = null;
  const loop = createLoop({
    update(dt) {
      parts.update(dt); floats.update(dt);
      if (battle && party?.status === 'running') battle.update(dt);
      if (quizView && party?.status === 'running') quizView.update();
      if (drawView && party?.status === 'running') drawView.update();
      if (syncView && party?.status === 'running') syncView.update();
      if (marketView && party?.status === 'running') marketView.update();
      if (fwView && party?.status === 'running') fwView.update(dt);
      if (party?.status === 'lobby') {
        const left = Math.max(0, Math.ceil((party.startAt - serverNow()) / 1000));
        el.count.textContent = left > 0 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : 'GO!';
        if (left <= 3 && left > 0 && left !== lastBeep) { lastBeep = left; sound.tick(); }
      } else if (!party) el.count.textContent = '…';
    },
    render() {
      if (party?.status !== 'running') return;
      if (party.game === 'battle' || party.game === 'snake' || party.game === 'heat') { battle?.render(); return; }
      if (party.game === 'quiz' || party.duo) return;
      space.world(); // scale to the canvas size (these games are never sideways)
      if (party.game === 'boat') { boatView?.render(); return; }
      if (party.game === 'firework') { fwView?.render(); return; }
      if (party.game === 'draw') { drawView?.render(); return; }
      // Reaction Tap (may be sideways on an upright phone)
      const t = (serverNow() - party.startAt) / 1000;
      space.screen();
      ctx.fillStyle = C.bg; ctx.fillRect(0, 0, screenView.sw, screenView.sh);
      space.world();
      ctx.strokeStyle = 'rgba(141,136,179,0.07)'; ctx.lineWidth = 1;
      for (let x = 0; x <= W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 56); ctx.lineTo(x, H); ctx.stroke(); }
      timeline.forEach((tg, i) => {
        const age = t - tg.t;
        if (age < 0 || age > tg.life || hidden.has(i)) return;
        glowCircle(ctx, tg.x, tg.y, radiusAt(tg, age) * Math.min(1, age / 0.08), tg.fake ? C.red : C.cyan, tg.fake);
      });
      parts.draw(ctx); space.floats(floats.list, MONO);
      space.screen();
      const mine = party.players.find(p => p.key === me);
      const lead = party.players[0];
      drawHud(ctx, screenView.sw, {
        left: `YOU ${fmt(mine?.score || 0)}${mine ? `  #${mine.place}` : ''}`,
        right: `${screenView.sw >= 600 && lead && lead.key !== me ? `LEAD ${lead.name.slice(0, 10)} ` : ''}${Math.max(0, Math.ceil(DURATION - t))}s`,
        progress: Math.min(1, Math.max(0, t / DURATION)),
      });
    },
  });

  function exit() {
    closed = true; loop.stop(); input.destroy();
    resizeObs?.disconnect(); window.removeEventListener('resize', fitCanvas); window.removeEventListener('orientationchange', fitCanvas); try { ws?.close(); } catch { /* ignore */ } onExit?.();
  }

  loop.start();
  connect();
  render();
  return { exit, get party() { return party; } };
}

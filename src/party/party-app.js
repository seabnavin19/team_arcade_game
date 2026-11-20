// The live party screen: lobby → synced Reaction Tap round → results.

import { timelineFor, PARTY_GAMES } from './rules.js';
import { createBattleView } from './battle-view.js';
import { createQuizView } from './quiz-view.js';
import { createSnakeView } from './snake-view.js';
import { QUESTIONS } from './quiz.js';
import { radiusAt, W, H, DURATION } from '../games/reaction.js';
import { createLoop } from '../core/loop.js';
import { createInput } from '../core/input.js';
import { C, glowCircle, drawHud, Particles, FloatText } from '../games/draw.js';
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
        <div class="ta-week">⚡ Live party</div>
        <button class="ta-iconbtn" data-sound type="button"></button>
      </header>
      <section class="ta-party-lobby" data-lobby>
        <h2 class="ta-party-title" data-title>Party</h2>
        <div class="ta-party-count" data-count>…</div>
        <div class="ta-party-sub" data-sub>Connecting…</div>
        <ul class="ta-party-players" data-players></ul>
        <button class="ta-btn ta-party-start" type="button" data-startnow hidden>▶ Start now</button>
        <div class="ta-party-note" data-note></div>
        <p class="ta-party-rules" data-rules></p>
        <p class="ta-party-controls" data-controls></p>
      </section>
      <section class="ta-party-game" data-game hidden>
        <div class="ta-canvas-wrap" data-canvaswrap><canvas data-canvas tabindex="0"></canvas><div class="ta-overlay" data-overlay></div></div>
        <div class="ta-quiz" data-quiz hidden></div>
        <div class="ta-dpad" data-dpad hidden>
          <button type="button" data-d="up" aria-label="Up">▲</button>
          <button type="button" data-d="left" aria-label="Left">◀</button>
          <button type="button" data-d="right" aria-label="Right">▶</button>
          <button type="button" data-d="down" aria-label="Down">▼</button>
        </div>
        <ol class="ta-party-board" data-board></ol>
        <p class="ta-rotate">Tip: turn your phone sideways for a bigger game.</p>
      </section>
      <section class="ta-party-results" data-results hidden></section>
    </div>`;
  const $ = s => root.querySelector(`[data-${s}]`);
  const el = { dpad: $('dpad'), canvaswrap: $('canvaswrap'), quiz: $('quiz'), startnow: $('startnow'), note: $('note'), title: $('title'), rules: $('rules'), controls: $('controls'), lobby: $('lobby'), count: $('count'), sub: $('sub'), players: $('players'), game: $('game'), canvas: $('canvas'), overlay: $('overlay'), board: $('board'), results: $('results'), sound: $('sound') };

  const renderSound = () => { el.sound.innerHTML = sound.on ? ICONS.sound : ICONS.muted; el.sound.title = sound.on ? 'Sound on' : 'Sound off'; };
  el.sound.addEventListener('click', () => { sound.toggle(); renderSound(); });
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
    } else if (m.type === 'question') { quizView?.onQuestion(m);
    } else if (m.type === 'locked') { quizView?.onLocked(m);
    } else if (m.type === 'answered') { quizView?.onAnswered(m);
    } else if (m.type === 'reveal') { setParty(m.party); quizView?.onReveal(m);
    } else if (m.type === 'notice') {
      el.note.textContent = m.text; el.startnow.disabled = false;
    } else if (m.type === 'snap') {
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
    if (first) {
      timeline = timelineFor(p); hidden.clear();
      const g = PARTY_GAMES[p.game] || PARTY_GAMES.reaction;
      el.title.textContent = `${g.emoji} ${g.title} Party`;
      el.rules.textContent = g.pitch;
      el.controls.textContent = p.game === 'battle'
        ? 'Controls: move with the mouse, arrow keys or WASD. On a phone, drag anywhere to steer.'
        : p.game === 'quiz' ? 'Controls: tap an answer, or press 1–4. You get one try per puzzle.'
        : p.game === 'snake' ? 'Controls: arrow keys or WASD. On a phone, swipe on the board or use the arrow buttons.'
        : 'Controls: click or tap the targets.';
      el.canvaswrap.hidden = p.game === 'quiz';
      el.quiz.hidden = p.game !== 'quiz';
      if (p.game === 'quiz' && !quizView) quizView = createQuizView(el.quiz, { send, serverNow, getMe: () => me, sound, input });
      if (p.game === 'battle' && !battle) battle = createBattleView({ ctx, input, send, serverNow, getParty: () => party, getMe: () => me, color, sound, parts, floats });
      if (p.game === 'snake' && !battle) battle = createSnakeView({ ctx, input, send, serverNow, getParty: () => party, getMe: () => me, color, sound, parts, floats, dpad: el.dpad });
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
    el.results.hidden = !(status === 'done' || status === 'cancelled' || status === 'error');

    if (party) {
      const list = party.players.map(pl => `<li style="--c:${color(pl.key)}" class="${pl.key === me ? 'is-me' : ''}">${esc(pl.name)}</li>`).join('');
      el.players.innerHTML = list || '<li class="ta-muted">Nobody yet…</li>';
      const n = party.players.length;
      const inLobby = party.status === 'lobby';
      const startingSoon = inLobby && party.startedBy;
      el.sub.textContent = `${n} ${n === 1 ? 'player' : 'players'} in · needs at least 2`;
      el.startnow.hidden = !(inLobby && !startingSoon && n >= 2 && party.players.some(p => p.key === me));
      el.note.textContent = startingSoon ? `${party.startedBy} started the party!` : (inLobby && n < 2 ? 'Waiting for one more player…' : '');
      const val = pl => (party.game === 'battle' ? `${pl.kos || 0} KO` : party.game === 'snake' ? `${pl.score} pts` : fmt(pl.score));
      el.board.innerHTML = party.players.map(pl => `
        <li class="${pl.key === me ? 'is-me' : ''}" style="--c:${color(pl.key)}"><span class="ta-place">${pl.place}</span><span class="ta-name">${esc(pl.name)}</span><span class="ta-score">${val(pl)}</span></li>`).join('');
    }
    if (status === 'error') showResults(`<p class="ta-warn">${esc(fatal)}</p>`);
    if (status === 'cancelled') showResults('<p>Not enough players joined, so the party was cancelled.<br>Send <b>/party</b> in the group to try again.</p>');
    if (status === 'done') {
      const mine = party.players.find(p => p.key === me);
      showResults(`
        ${mine ? `<div class="ta-result-label">You finished</div><div class="ta-result-score">${MEDALS[mine.place - 1] || `#${mine.place}`}</div><div class="ta-result-meta">${detail(mine)}</div>` : ''}
        <ol class="ta-party-final">${party.players.map(p => `<li class="${p.key === me ? 'is-me' : ''}"><span>${MEDALS[p.place - 1] || `${p.place}.`}</span><span class="ta-name">${esc(p.name)}</span><span class="ta-score">${party.game === 'battle' ? `${p.kos || 0} KO` : party.game === 'snake' ? `${p.score} pts` : fmt(p.score)}</span></li>`).join('')}</ol>`);
    }
  }
  function detail(pl) {
    if (party.game === 'quiz') return `${fmt(pl.score)} points · ${pl.hits}/${QUESTIONS} right`;
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
  let battle = null;
  let quizView = null;
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
      if (party?.status === 'lobby') {
        const left = Math.max(0, Math.ceil((party.startAt - serverNow()) / 1000));
        el.count.textContent = left > 0 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : 'GO!';
        if (left <= 3 && left > 0 && left !== lastBeep) { lastBeep = left; sound.tick(); }
      } else if (!party) el.count.textContent = '…';
    },
    render() {
      if (party?.status !== 'running') return;
      if (party.game === 'battle' || party.game === 'snake') { battle?.render(); return; }
      if (party.game === 'quiz') return;
      const t = (serverNow() - party.startAt) / 1000;
      ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(141,136,179,0.07)'; ctx.lineWidth = 1;
      for (let x = 0; x <= W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 56); ctx.lineTo(x, H); ctx.stroke(); }
      timeline.forEach((tg, i) => {
        const age = t - tg.t;
        if (age < 0 || age > tg.life || hidden.has(i)) return;
        glowCircle(ctx, tg.x, tg.y, radiusAt(tg, age) * Math.min(1, age / 0.08), tg.fake ? C.red : C.cyan, tg.fake);
      });
      parts.draw(ctx); floats.draw(ctx);
      const mine = party.players.find(p => p.key === me);
      const lead = party.players[0];
      drawHud(ctx, W, {
        left: `YOU ${fmt(mine?.score || 0)}${mine ? `  #${mine.place}` : ''}`,
        right: `${lead && lead.key !== me ? `LEAD ${lead.name.slice(0, 10)} ` : ''}${Math.max(0, Math.ceil(DURATION - t))}s`,
        progress: Math.min(1, Math.max(0, t / DURATION)),
      });
    },
  });

  function exit() { closed = true; loop.stop(); input.destroy(); try { ws?.close(); } catch { /* ignore */ } onExit?.(); }

  loop.start();
  connect();
  render();
  return { exit, get party() { return party; } };
}

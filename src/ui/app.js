// The arcade hub: game cards, leaderboards, and the play overlay.

import { GAMES } from '../games/index.js';
import { weekKey, previousWeekKey, weekLabel, dayKey } from '../core/time.js';
import { rankBoard, championBoard } from '../core/ranking.js';
import { createInput } from '../core/input.js';
import { ICONS } from './icons.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ordinal = n => `#${n}`;

export function createApp(root, { store, user, sound, offline = false, touchOnly = false, notes: noteText = {}, now = () => new Date() }) {
  const state = {
    week: weekKey(now()),
    boards: {},          // gameId -> board (this week)
    lastBoards: {},      // gameId -> board (last week)
    tab: 'champion',
    viewOnly: !user,
    loading: true,
    error: null,
    session: null,       // the open game, if any
  };

  root.innerHTML = `
    <div class="ta" data-ta>
      <header class="ta-top">
        <div class="ta-brand"><span class="ta-brand-a">TEAM</span><span class="ta-brand-b">ARCADE</span></div>
        <div class="ta-week" data-week></div>
        <button class="ta-iconbtn" data-sound type="button"></button>
      </header>
      <div class="ta-stats" data-stats></div>
      <div class="ta-cards" data-cards></div>
      <section class="ta-boards">
        <div class="ta-tabs" role="tablist" data-tabs></div>
        <ol class="ta-list" data-list></ol>
        <div class="ta-last" data-last></div>
      </section>
      <div class="ta-note" data-note></div>
      <div class="ta-stage" data-stage hidden>
        <div class="ta-stage-bar">
          <span class="ta-stage-title" data-stage-title></span>
          <span class="ta-stage-hint">Esc to quit</span>
          <button class="ta-iconbtn" data-full type="button" title="Full screen">${ICONS.full}</button>
          <button class="ta-btn ta-btn-ghost" data-quit type="button">Quit</button>
        </div>
        <div class="ta-canvas-wrap"><canvas data-canvas tabindex="0"></canvas>
          <div class="ta-overlay" data-overlay></div>
        </div>
        <p class="ta-rotate">Tip: turn your phone sideways for a bigger game.</p>
      </div>
    </div>`;

  const $ = sel => root.querySelector(`[data-${sel}]`);
  const el = {
    week: $('week'), sound: $('sound'), stats: $('stats'), cards: $('cards'), tabs: $('tabs'), list: $('list'),
    last: $('last'), note: $('note'), stage: $('stage'), stageTitle: $('stage-title'), canvas: $('canvas'),
    overlay: $('overlay'), full: $('full'), quit: $('quit'), app: $('ta'),
  };

  // ---------- derived data ----------
  const ranked = boards => Object.fromEntries(GAMES.map(g => [g.id, rankBoard(boards[g.id], g.better)]));
  const myRow = rows => (user ? rows.find(r => r.key === user.key) : null);

  // ---------- rendering ----------
  function renderSound() {
    el.sound.innerHTML = sound.on ? ICONS.sound : ICONS.muted;
    el.sound.title = sound.on ? 'Sound on' : 'Sound off';
    el.sound.setAttribute('aria-label', el.sound.title);
  }

  function render() {
    el.week.textContent = `${weekLabel(state.week)} · resets Monday`;
    const r = ranked(state.boards);
    const champ = championBoard(r);
    const me = myRow(champ);
    const top = champ[0];
    el.stats.innerHTML = state.loading
      ? `<span class="ta-muted">Loading scores…</span>`
      : `<span>🏆 Champion: <b>${top ? `${esc(top.name)}</b> <span class="ta-muted">(${top.score} pts)</span>` : '—</b>'}</span>
         <span>${user ? `You: <b>${me ? `${ordinal(me.place)}</b> <span class="ta-muted">(${me.score} pts)</span>` : `not ranked yet</b>`}` : '<span class="ta-muted">Playing as guest</span>'}</span>
         ${user ? `<span class="ta-muted ta-hello">Hi, ${esc(user.name)}</span>` : ''}`;

    el.cards.innerHTML = GAMES.map(g => {
      const rows = r[g.id];
      const best = rows[0], mine = myRow(rows);
      return `
        <article class="ta-card ${g.comingSoon ? 'is-soon' : ''}" data-game="${g.id}">
          <div class="ta-card-icon">${ICONS[g.id] || ''}</div>
          <h3 class="ta-card-title">${esc(g.title)}</h3>
          <p class="ta-card-blurb">${esc(g.blurb)}</p>
          <dl class="ta-card-stats">
            <div><dt>Top</dt><dd>${best ? esc(g.format(best.score)) : '—'}</dd></div>
            <div><dt>You</dt><dd>${mine ? esc(g.format(mine.score)) : '—'}</dd></div>
          </dl>
          ${g.comingSoon
            ? `<span class="ta-soon">Coming soon</span>`
            : g.needsKeyboard && touchOnly
            ? `<span class="ta-soon">Needs a keyboard · play on a computer</span>`
            : `<button class="ta-btn" type="button" data-play="${g.id}">Play <span class="ta-muted">· ${esc(g.length)}</span></button>`}
        </article>`;
    }).join('');

    const tabs = [{ id: 'champion', title: 'Champion' }, ...GAMES.map(g => ({ id: g.id, title: g.title }))];
    el.tabs.innerHTML = tabs.map(t => `<button type="button" role="tab" class="ta-tab" aria-selected="${t.id === state.tab}" data-tab="${t.id}">${esc(t.title)}</button>`).join('');

    const game = GAMES.find(g => g.id === state.tab);
    const rows = state.tab === 'champion' ? champ : r[state.tab];
    const fmt = state.tab === 'champion' ? s => `${s} pts` : game.format;
    el.list.innerHTML = rows.length
      ? rows.slice(0, 15).map(x => `
          <li class="ta-row ${user && x.key === user.key ? 'is-me' : ''} ${x.place <= 3 ? `is-p${x.place}` : ''}">
            <span class="ta-place">${x.place}</span><span class="ta-name">${esc(x.name)}</span><span class="ta-score">${esc(fmt(x.score))}</span>
          </li>`).join('')
        + (me && state.tab === 'champion' && me.place > 15 ? `<li class="ta-row is-me"><span class="ta-place">${me.place}</span><span class="ta-name">${esc(me.name)}</span><span class="ta-score">${me.score} pts</span></li>` : '')
      : `<li class="ta-empty">${state.loading ? '' : 'No scores yet this week. Be the first!'}</li>`;

    const lastChamp = championBoard(ranked(state.lastBoards))[0];
    el.last.innerHTML = lastChamp ? `Last week's champion: <b>${esc(lastChamp.name)}</b> <span class="ta-muted">(${lastChamp.score} pts)</span>` : '';

    const notes = [];
    if (offline) notes.push(noteText.offline || "Can't reach Confluence right now. You can still play, but scores won't save until you reload the page.");
    else if (state.viewOnly) notes.push(user ? (noteText.viewOnly || "You can play, but your scores aren't ranked: you need edit permission on this page.") : (noteText.guest || "You're not logged in, so scores aren't saved."));
    if (store.pending()) notes.push(`${store.pending()} score(s) waiting to be saved; they'll retry next time this page opens.`);
    if (state.error && !offline) notes.push(state.error);
    el.note.innerHTML = notes.map(esc).join('<br>');
    el.note.hidden = !notes.length;
  }

  // ---------- data ----------
  async function load() {
    state.loading = true; render();
    const prev = previousWeekKey(now());
    const [cur, last] = await Promise.all([
      Promise.all(GAMES.map(g => store.loadBoard(g.id, state.week))),
      Promise.all(GAMES.map(g => store.loadBoard(g.id, prev))),
    ]);
    GAMES.forEach((g, i) => { state.boards[g.id] = cur[i].board; state.lastBoards[g.id] = last[i].board; });
    const failed = cur.some(x => x.status !== 'ok');
    state.error = failed ? "Couldn't load all scores. Reload the page to try again." : null;
    state.loading = false;
    render();
  }

  // ---------- playing ----------
  function setupCanvas(game) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    el.canvas.width = game.width * dpr; el.canvas.height = game.height * dpr;
    el.canvas.style.aspectRatio = `${game.width} / ${game.height}`;
    const ctx = el.canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  // While playing, the game fills the window: size the canvas to the space
  // left under the bar (same shape, sharp on high-DPI screens). Games keep
  // drawing in their own 800 × 480 units; only the scale changes.
  // A phone held upright: games that have a tall layout (Drone Shooter) use it.
  function isUpright() {
    const w = window.innerWidth, h = window.innerHeight;
    return h > w * 1.15 && w < 700;
  }
  function fitCanvas() {
    const s = state.session;
    if (!s) return;
    const wrap = el.canvas.parentElement, bw = wrap.clientWidth, bh = wrap.clientHeight;
    if (!bw || !bh) return;
    const { width: gw, height: gh } = s.size;
    const css = Math.min(bw / gw, bh / gh);
    const cw = Math.floor(gw * css), ch = Math.floor(gh * css);
    el.canvas.style.width = `${cw}px`; el.canvas.style.height = `${ch}px`;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const pw = Math.round(cw * dpr), ph = Math.round(ch * dpr);
    if (el.canvas.width === pw && el.canvas.height === ph) return;
    el.canvas.width = pw; el.canvas.height = ph; // this wipes the canvas and its scale…
    s.ctx.setTransform(pw / gw, 0, 0, ph / gh, 0, 0); // …so set the scale again; the game redraws next frame
    if (!s.instance) { s.ctx.fillStyle = '#0c0a1d'; s.ctx.fillRect(0, 0, gw, gh); }
  }
  try { new ResizeObserver(() => fitCanvas()).observe(el.canvas.parentElement); } catch { /* old browser */ }
  window.addEventListener('resize', () => fitCanvas());

  function overlay(html) { el.overlay.innerHTML = html; el.overlay.hidden = !html; }

  function openGame(id) {
    const game = GAMES.find(g => g.id === id && !g.comingSoon && !(g.needsKeyboard && touchOnly));
    if (!game) return;
    closeGame();
    el.stage.hidden = false;
    el.app.classList.add('is-playing');
    el.stageTitle.textContent = game.title;
    // the field's shape is chosen once, when the game starts
    const size = game.tall && isUpright() ? game.tall : { width: game.width, height: game.height };
    el.app.classList.toggle('is-tall', size === game.tall);
    const ctx = setupCanvas(size);
    ctx.fillStyle = '#0c0a1d'; ctx.fillRect(0, 0, size.width, size.height);
    const input = createInput(el.canvas, { width: size.width, height: size.height, onEscape: () => closeGame() });
    const session = { game, size, input, ctx, instance: null, timers: [], startedAt: 0 };
    state.session = session;
    fitCanvas();
    el.stage.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    el.canvas.focus({ preventScroll: true });
    countdown(session);
  }

  function countdown(session) {
    const steps = ['3', '2', '1', 'GO!'];
    let i = 0;
    const show = () => {
      if (state.session !== session) return;
      if (i < steps.length) {
        overlay(`<div class="ta-count ${i === 3 ? 'is-go' : ''}">${steps[i]}</div><div class="ta-controls">${esc(session.game.controls)}</div>`);
        i === 3 ? sound.go() : sound.tick();
        i++;
        session.timers.push(setTimeout(show, i === 4 ? 450 : 700));
      } else {
        overlay('');
        session.startedAt = performance.now();
        session.run = !state.viewOnly && user ? store.beginRun?.(session.game.id) : undefined;
        session.instance = session.game.start(session.ctx, {
          seed: dayKey(now()), input: session.input, sound, width: session.size.width, height: session.size.height,
          onEnd: (score, meta) => finish(session, score, meta),
        });
      }
    };
    show();
  }

  async function finish(session, score, meta) {
    if (state.session !== session) return;
    const { game } = session;
    const seconds = (performance.now() - session.startedAt) / 1000;
    const check = game.plausible ? game.plausible(score, seconds, meta) : { ok: true };
    const metaLine = meta && game.describe ? game.describe(meta) : '';
    const renderResult = status => overlay(`
      <div class="ta-result">
        <div class="ta-result-label">${esc(game.title)}</div>
        <div class="ta-result-score">${esc(game.format(score))}</div>
        ${metaLine ? `<div class="ta-result-meta">${esc(metaLine)}</div>` : ''}
        <div class="ta-result-status">${status}</div>
        <div class="ta-result-actions">
          <button class="ta-btn" type="button" data-again>Play again</button>
          <button class="ta-btn ta-btn-ghost" type="button" data-back>Back to arcade</button>
        </div>
      </div>`);
    renderResult('<span class="ta-muted">Saving…</span>');

    let status;
    if (!check.ok) status = `<span class="ta-warn">${esc(check.reason || "That run looks off, so it wasn't saved.")}</span>`;
    else if (offline) status = `<span class="ta-warn">Not saved: Confluence couldn't be reached. Reload the page and try again.</span>`;
    else if (!user || state.viewOnly) status = `<span class="ta-muted">Not ranked (view only).</span>`;
    else {
      const r = await store.submit({ game: game.id, week: state.week, user, score, better: game.better, meta, run: session.run });
      if (r.board) state.boards[game.id] = r.board;
      if (r.week && r.week !== state.week) { state.week = r.week; }
      if (r.status === 'viewOnly') { state.viewOnly = true; status = `<span class="ta-muted">Not ranked: you need edit permission on this page.</span>`; }
      else if (r.status === 'queued') status = `<span class="ta-warn">Couldn't save yet, will retry next time.</span>`;
      else if (r.status === 'rejected') status = `<span class="ta-warn">${esc(r.reason || "That run looks off, so it wasn't saved.")}</span>`;
      else if (r.status === 'failed') status = `<span class="ta-warn">${esc(r.reason || "Couldn't save this score. Check your connection and try again.")}</span>`;
      else {
        const rows = rankBoard(state.boards[game.id], game.better);
        const me = myRow(rows);
        const rank = me ? ` You're <b>${ordinal(me.place)}</b> of ${rows.length} this week.` : '';
        status = r.status === 'saved'
          ? `<span class="ta-ok">✓ New personal best, saved.</span>${rank}`
          : `Your best this week: <b>${esc(game.format(me?.score ?? score))}</b>.${rank}`;
      }
    }
    if (state.session !== session) { render(); return; }
    renderResult(status);
    render();
    el.overlay.querySelector('[data-again]')?.addEventListener('click', () => openGame(game.id));
    el.overlay.querySelector('[data-back]')?.addEventListener('click', () => closeGame());
    el.overlay.querySelector('[data-again]')?.focus({ preventScroll: true });
  }

  function closeGame() {
    const s = state.session;
    if (!s) return;
    s.timers.forEach(clearTimeout);
    s.instance?.stop();
    s.input.destroy();
    state.session = null;
    overlay('');
    el.stage.hidden = true;
    el.app.classList.remove('is-playing', 'is-tall');
    el.canvas.style.width = el.canvas.style.height = '';
    if (document.fullscreenElement === el.stage) document.exitFullscreen?.();
  }

  // ---------- events ----------
  root.addEventListener('click', e => {
    const t = e.target.closest('button');
    if (!t || !root.contains(t)) return;
    if (t.dataset.play) openGame(t.dataset.play);
    else if (t.dataset.tab) { state.tab = t.dataset.tab; render(); }
    else if (t.hasAttribute('data-sound')) { sound.toggle(); renderSound(); }
    else if (t.hasAttribute('data-quit')) closeGame();
    else if (t.hasAttribute('data-full')) {
      if (document.fullscreenElement) document.exitFullscreen?.();
      else el.stage.requestFullscreen?.().catch(() => {});
    }
  });

  renderSound();
  render();
  return { load, openGame, closeGame, state };
}

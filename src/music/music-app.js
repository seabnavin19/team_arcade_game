// The music room screen: a YouTube player that follows the room's shared
// clock, the queue, and a box to paste links into. The server decides what
// plays and from which second; this screen only follows it.
//
// Built to keep going in a background tab: song changes arrive as WebSocket
// messages and player events, never from timers (browsers slow those down
// in hidden tabs).

import { driftSeek, neededVotes, playerEntryId } from './rules.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clock = s => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const YT_PLAYING = 1, YT_ENDED = 0, YT_BUFFERING = 3;

let ytReady = null;
function loadYouTube() {
  if (ytReady) return ytReady;
  ytReady = new Promise((resolve, reject) => {
    if (window.YT?.Player) { resolve(window.YT); return; }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(window.YT); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => { ytReady = null; reject(new Error('YouTube did not load')); };
    document.head.appendChild(s);
  });
  return ytReady;
}

export function createMusicApp(root, { api, token, onExit, WebSocketImpl = globalThis.WebSocket }) {
  root.innerHTML = `
    <div class="ta ta-music" data-ta>
      <header class="ta-top">
        <div class="ta-brand"><span class="ta-brand-a">TEAM</span><span class="ta-brand-b">MUSIC</span></div>
        <div class="ta-week" data-status>Connecting…</div>
        <button class="ta-btn ta-btn-ghost ta-music-exit" type="button" data-exit>← Arcade</button>
      </header>
      <section class="ta-music-stage">
        <div class="ta-music-player"><div data-player></div>
          <button class="ta-music-unlock" type="button" data-unlock>🎧 Tap to listen</button>
          <div class="ta-music-empty" data-empty hidden>Nothing playing. Paste a YouTube link below to start.</div>
        </div>
        <div class="ta-music-now">
          <div class="ta-music-title" data-title>—</div>
          <div class="ta-music-meta"><span data-time>0:00</span> · <span data-by></span></div>
          <div class="ta-music-buttons">
            <button class="ta-btn" type="button" data-pause>⏸ Pause</button>
            <button class="ta-btn ta-btn-ghost" type="button" data-skip>⏭ Skip</button>
          </div>
        </div>
      </section>
      <p class="ta-music-note" data-note></p>
      <form class="ta-music-add" data-add autocomplete="off">
        <input type="text" maxlength="300" placeholder="Paste a YouTube link…" data-url enterkeyhint="send">
        <button class="ta-btn" type="submit">Add</button>
      </form>
      <h3 class="ta-music-h">Up next</h3>
      <ol class="ta-music-queue" data-queue></ol>
      <p class="ta-music-listeners" data-listeners></p>
    </div>`;
  const $ = s => root.querySelector(`[data-${s}]`);
  const el = Object.fromEntries(['status', 'exit', 'player', 'unlock', 'empty', 'title', 'time', 'by', 'pause', 'skip', 'note', 'add', 'url', 'queue', 'listeners'].map(k => [k, $(k)]));

  // ---------- state ----------
  let music = null, listeners = [], me = null, offset = 0, bestRtt = Infinity;
  let ws = null, retries = 0, closed = false;
  let player = null, playerReady = false, unlocked = false, loadedEntry = null, durationSent = null, noteTimer = null;
  const serverNow = () => Date.now() + offset;
  const target = () => (!music?.now ? 0 : music.paused ? music.position : music.position + (serverNow() - music.serverNow) / 1000);

  // ---------- network ----------
  const wsUrl = `${api.replace(/^http/, 'ws')}/music/ws?t=${encodeURIComponent(token)}`;
  function connect() {
    if (closed) return;
    try { ws = new WebSocketImpl(wsUrl); } catch { reconnect(); return; }
    ws.onopen = () => { retries = 0; el.status.textContent = '🎵 Music room'; for (let i = 0; i < 4; i++) setTimeout(() => send({ type: 'ping', c: Date.now() }), i * 250); };
    ws.onmessage = e => { try { onMessage(JSON.parse(e.data)); } catch { /* ignore bad message */ } };
    ws.onclose = () => { if (!closed) reconnect(); };
  }
  function reconnect() {
    if (++retries > 10) { el.status.textContent = 'Disconnected'; note('Lost connection to the music room. Check your internet, then open it again from the group.', 0); return; }
    el.status.textContent = 'Reconnecting…';
    setTimeout(connect, Math.min(4000, 500 * retries));
  }
  const send = m => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };

  function onMessage(m) {
    if (m.type === 'pong') {
      const rtt = Date.now() - m.c;
      if (rtt < bestRtt) { bestRtt = rtt; offset = m.s + rtt / 2 - Date.now(); }
    } else if (m.type === 'state') {
      if (m.you) me = m.you;
      if (bestRtt === Infinity) offset = m.music.serverNow - Date.now(); // rough until pings return
      music = m.music; listeners = m.listeners || [];
      render(); sync();
    } else if (m.type === 'notice') note(m.text);
  }

  function note(text, ms = 6000) {
    el.note.textContent = text;
    clearTimeout(noteTimer);
    if (ms) noteTimer = setTimeout(() => { el.note.textContent = ''; }, ms);
  }

  // ---------- the player ----------
  function startPlayer() {
    unlocked = true;
    el.unlock.hidden = true;
    loadYouTube().then(YT => {
      if (closed || player) return;
      player = new YT.Player(el.player, {
        width: '100%', height: '100%',
        playerVars: { controls: 0, playsinline: 1, rel: 0, modestbranding: 1, disablekb: 1 },
        events: {
          onReady: () => { playerReady = true; sync(); },
          // Events are about the video this player loaded, which may not be the
          // room's current song any more (events arrive late), so label them by
          // what was loaded and drop ones from another video.
          onStateChange: e => {
            const id = playerEntryId(loadedEntry, player.getVideoData?.()?.video_id);
            if (e.data === YT_PLAYING && id && durationSent !== id) {
              const d = player.getDuration();
              if (d > 0) { durationSent = id; send({ type: 'duration', id, seconds: Math.round(d) }); }
            }
            if (e.data === YT_PLAYING && music?.paused) player.pauseVideo();
            if (e.data === YT_ENDED && id) send({ type: 'ended', id });
          },
          onError: e => {
            const id = playerEntryId(loadedEntry, player.getVideoData?.()?.video_id);
            if (id) send({ type: 'unplayable', id, code: e.data });
          },
        },
      });
    }).catch(() => { el.unlock.hidden = false; unlocked = false; note("Couldn't load YouTube. Check your connection and tap again."); });
  }

  /** Make the player match the room: right song, right second, playing or paused. */
  function sync() {
    if (!unlocked || !playerReady || !player) return;
    const now = music?.now;
    if (!now) { if (loadedEntry) { player.stopVideo(); loadedEntry = null; } return; }
    const at = target();
    if (loadedEntry?.id !== now.id) {
      loadedEntry = { id: now.id, videoId: now.videoId };
      if (music.paused) player.cueVideoById({ videoId: now.videoId, startSeconds: at });
      else player.loadVideoById({ videoId: now.videoId, startSeconds: at });
      return;
    }
    if (music.paused) { player.pauseVideo(); if (driftSeek(player.getCurrentTime(), at)) player.seekTo(at, true); return; }
    const st = player.getPlayerState();
    if (st !== YT_PLAYING && st !== YT_BUFFERING && st !== YT_ENDED) player.playVideo();
    if (st !== YT_ENDED && driftSeek(player.getCurrentTime(), at)) player.seekTo(at, true);
  }

  // ---------- screen ----------
  function render() {
    const now = music?.now;
    el.empty.hidden = !!now;
    el.title.textContent = now ? now.title : 'Nothing playing';
    el.by.textContent = now ? `added by ${now.addedBy.key === me ? 'you' : now.addedBy.name}` : '';
    el.pause.disabled = el.skip.disabled = !now;
    el.pause.textContent = music?.paused ? '▶ Play' : '⏸ Pause';
    const mine = now && now.addedBy.key === me;
    el.skip.textContent = !now || mine ? '⏭ Skip' : `⏭ Vote to skip ${music.votes}/${neededVotes(listeners.length)}`;
    el.queue.innerHTML = (music?.queue || []).map(e => `
      <li><span class="ta-music-q-title">${esc(e.title)}</span><span class="ta-muted">${e.addedBy.key === me ? 'you' : esc(e.addedBy.name)}</span>${e.addedBy.key === me ? `<button class="ta-iconbtn" type="button" data-remove="${esc(e.id)}" title="Remove" aria-label="Remove">✕</button>` : ''}</li>`).join('')
      || '<li class="ta-muted">Nothing waiting. Add a song!</li>';
    el.listeners.textContent = listeners.length ? `${listeners.length} listening: ${listeners.map(l => (l.key === me ? 'you' : l.name)).join(', ')}` : '';
    renderTime();
  }
  function renderTime() {
    const now = music?.now;
    el.time.textContent = now ? `${clock(target())}${now.seconds ? ` / ${clock(now.seconds)}` : ''}` : '0:00';
  }

  // ---------- controls ----------
  el.unlock.addEventListener('click', startPlayer);
  el.pause.addEventListener('click', () => send({ type: music?.paused ? 'resume' : 'pause' }));
  el.skip.addEventListener('click', () => { if (music?.now) send({ type: 'skip', id: music.now.id }); });
  el.queue.addEventListener('click', e => { const b = e.target.closest('[data-remove]'); if (b) send({ type: 'remove', id: b.dataset.remove }); });
  el.add.addEventListener('submit', e => {
    e.preventDefault();
    const url = el.url.value.trim();
    if (!url) return;
    send({ type: 'add', url });
    el.url.value = '';
  });
  el.exit.addEventListener('click', exit);

  // Drift check every few seconds (slower in a hidden tab, which is fine) and
  // straight away when the tab comes back.
  const tick = setInterval(() => { renderTime(); sync(); }, 3000);
  const clockTick = setInterval(renderTime, 1000);
  const onVisible = () => { if (document.visibilityState === 'visible') { renderTime(); sync(); } };
  document.addEventListener('visibilitychange', onVisible);

  function exit() {
    closed = true;
    clearInterval(tick); clearInterval(clockTick); clearTimeout(noteTimer);
    document.removeEventListener('visibilitychange', onVisible);
    try { player?.destroy(); } catch { /* ignore */ }
    try { ws?.close(); } catch { /* ignore */ }
    onExit?.();
  }

  loadYouTube().catch(() => {}); // start fetching early so the first tap starts sound quickly
  connect();
  render();
  return { exit };
}

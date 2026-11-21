// Entry point for the Telegram version, served from GitHub Pages and opened
// from the "Play" button on the game message in a Telegram group.
import css from './ui/arcade.css';
import { createTelegramStore, decodeToken } from './telegram/client.js';
import { createSound } from './core/sound.js';
import { createApp } from './ui/app.js';
import { createPartyApp } from './party/party-app.js';
import { createMusicApp } from './music/music-app.js';

async function boot() {
  const root = document.getElementById('team-arcade');
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  const params = new URLSearchParams(location.search);
  const hash = new URLSearchParams(location.hash.slice(1));
  const token = hash.get('t') || '';
  const api = (params.get('api') || '').replace(/\/$/, '');
  const claims = token ? decodeToken(token) : null;
  const user = claims && api ? { key: `tg-${claims.u}`, name: claims.n } : null;

  const sound = createSound();

  // "Join the party" link → live party screen first; "Back to arcade" → the normal hub.
  if (user && claims.p && hash.get('party') === '1') {
    createPartyApp(root, { api, token, sound, onExit: () => { history.replaceState(null, '', `${location.pathname}${location.search}#t=${token}`); startHub(); } });
    return;
  }
  // "Open music room" link → the music room.
  if (user && claims.m && hash.get('music') === '1') {
    createMusicApp(root, { api, token, onExit: () => { history.replaceState(null, '', `${location.pathname}${location.search}#t=${token}`); startHub(); } });
    return;
  }
  startHub();

  async function startHub() {
    const store = user
      ? createTelegramStore({ api, token })
      : { loadBoard: async (game, week) => ({ status: 'ok', board: { game, week, entries: {} } }), submit: async () => ({ status: 'viewOnly' }), flushQueue: async () => ({}), pending: () => 0 };

    let touchOnly = false;
    try { touchOnly = !window.matchMedia('(any-pointer: fine)').matches; } catch { /* old browser */ }

    const app = createApp(root, {
      store, user, sound, touchOnly,
      notes: {
        guest: 'Open Team Arcade from the Play button in your Telegram group so your scores count for the group.',
        offline: "Can't reach the arcade server right now. You can still play, but scores won't save.",
      },
    });
    await app.load();
    window.TeamArcade = app;
  }
}

boot();

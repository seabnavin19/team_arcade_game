// Entry point: mounts Team Arcade into <div id="team-arcade"> on a Confluence page.
import css from './ui/arcade.css';
import { detectPage, createConfluenceClient } from './core/confluence.js';
import { createScoreStore } from './core/store.js';
import { createSound } from './core/sound.js';
import { createApp } from './ui/app.js';

async function boot() {
  const root = document.getElementById('team-arcade');
  if (!root || root.dataset.mounted) return;
  root.dataset.mounted = '1';

  if (!document.getElementById('team-arcade-css')) {
    const style = document.createElement('style');
    style.id = 'team-arcade-css';
    style.textContent = css;
    document.head.appendChild(style);
  }

  const page = detectPage(window);
  const pageId = page.pageId || root.dataset.pageId;
  if (!pageId) {
    root.textContent = 'Team Arcade: open this on the published Confluence page (no page id found).';
    return;
  }
  const fetchImpl = window.TEAM_ARCADE_FETCH || window.fetch.bind(window);
  const client = createConfluenceClient({ fetch: fetchImpl, pageId, contextPath: page.contextPath });
  const store = createScoreStore({ client });
  const who = await client.currentUser();
  const user = who.status === 'ok' ? who.user : null;

  const offline = who.status === 'network' || who.status === 'error';
  const app = createApp(root, { store, user, offline, sound: createSound() });
  if (user) await store.flushQueue();
  await app.load();
  window.TeamArcade = app; // handy for debugging from the console
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

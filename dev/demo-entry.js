// Bundled into dist/demo.html: the arcade running on a fake Confluence,
// so it can be tried in any browser without Confluence.
import { createMockFetch } from './mock-confluence.js';
import { weekKey } from '../src/core/time.js';

const page = '98765';
// Use the browser's storage when allowed, otherwise keep scores in memory.
const mem = new Map();
const memStore = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) };
let storage = memStore;
try { localStorage.setItem('ta-probe', '1'); localStorage.removeItem('ta-probe'); storage = localStorage; } catch { /* blocked */ }
const key = `mockcf.${page}.team-arcade.${weekKey()}.reaction`;
try {
  if (!storage.getItem(key)) {
    const at = new Date().toISOString();
    storage.setItem(key, JSON.stringify({ key, version: { number: 1 }, value: { game: 'reaction', week: weekKey(), entries: {
      s1: { name: 'Sample player A', score: 6420, at }, s2: { name: 'Sample player B', score: 4985, at }, s3: { name: 'Sample player C', score: 3310, at },
    } } }));
  }
} catch { /* storage blocked: start empty */ }
window.TEAM_ARCADE_FETCH = createMockFetch({ storage, params: new URLSearchParams('user=you&name=You') });
await import('../src/main.js');

// Runs the Telegram version locally with a pretend Telegram and a pretend
// GitHub (scores kept in memory), so you can try it without any accounts.
//   node dev/local-telegram.mjs   →  prints a link that opens the arcade as "Dara"
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { createHandler } from '../telegram/worker.js';
import { deriveKeys, sign } from '../telegram/token.js';

const PORT = Number(process.env.PORT || 8787);
const ORIGIN = `http://localhost:${PORT}`;
const files = new Map();
const telegramLog = [];
let shaN = 0;
const res = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), { status });

async function fakeFetch(url, init = {}) {
  const u = new URL(url);
  if (u.hostname === 'api.telegram.org') {
    const method = u.pathname.split('/').pop();
    const body = init.body ? JSON.parse(init.body) : {};
    telegramLog.push({ method, body });
    if (method === 'sendMessage') console.log(`[telegram → group] ${body.text.replace(/<[^>]+>/g, '')}`);
    return res(200, { ok: true, result: method === 'getMe' ? { username: 'TeamArcadeBot' } : true });
  }
  const path = decodeURIComponent(u.pathname.replace(/^\/repos\/[^/]+\/[^/]+\/contents\//, ''));
  if (!init.method || init.method === 'GET') {
    const f = files.get(path);
    return f ? res(200, { content: f.content, sha: f.sha }) : res(404, {});
  }
  const body = JSON.parse(init.body);
  const f = files.get(path);
  if ((f && body.sha !== f.sha) || (!f && body.sha)) return res(409, {});
  files.set(path, { content: body.content, sha: `s${++shaN}` });
  console.log(`[github commit] ${body.message}`);
  return res(200, {});
}

const env = {
  BOT_TOKEN: 'local', DATA_TOKEN: 'local', ARCADE_SECRET: 'local-development-secret',
  GITHUB_REPO: 'local/repo', DATA_BRANCH: 'scores', GAME_URL: `${ORIGIN}/`, GAME_SHORT_NAME: 'arcade', ANNOUNCE: 'top3',
};
const worker = createHandler({ fetch: fakeFetch });
const ctx = { waitUntil: p => p.catch(e => console.error(e)) };
const keys = await deriveKeys(env.ARCADE_SECRET);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json' };

http.createServer(async (req, out) => {
  const url = new URL(req.url, ORIGIN);
  if (['/run', '/score', '/board', '/telegram'].includes(url.pathname) || req.method === 'OPTIONS') {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const r = await worker.fetch(new Request(url, { method: req.method, headers: req.headers, body }), env, ctx);
    out.writeHead(r.status, Object.fromEntries(r.headers)); out.end(Buffer.from(await r.arrayBuffer()));
    return;
  }
  if (url.pathname === '/play') { // pretend someone tapped Play in a group
    const name = url.searchParams.get('name') || 'Dara';
    const id = Number(url.searchParams.get('id') || 11);
    const t = await sign(keys.tokenKey, { typ: 's', u: id, n: name, c: -100123, iat: Date.now(), exp: Date.now() + 12 * 3600e3 });
    out.writeHead(302, { Location: `/?api=${encodeURIComponent(ORIGIN)}#t=${t}` }); out.end(); return;
  }
  const file = join('site', url.pathname === '/' ? 'index.html' : url.pathname);
  try { const data = await readFile(file); out.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' }); out.end(data); }
  catch { out.writeHead(404); out.end('not found'); }
}).listen(PORT, () => console.log(`Local Team Arcade (Telegram version): ${ORIGIN}/play?name=Dara  (or ?name=Sokha&id=22)`));

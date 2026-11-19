// Reads and writes JSON files in the GitHub repo (on a separate "scores"
// branch so score commits never rebuild the website).

const API = 'https://api.github.com';
const toB64 = str => { const b = new TextEncoder().encode(str); let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s); };
const fromB64 = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), c => c.charCodeAt(0)));

export function createGithub({ fetch, token, repo, branch = 'scores', baseBranch = 'main', sleep = ms => new Promise(r => setTimeout(r, ms)) }) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'team-arcade-bot',
    'Cache-Control': 'no-cache',
  };
  const req = (path, init = {}) => fetch(`${API}/repos/${repo}${path}`, { ...init, headers: { ...headers, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } });
  const contentPath = path => `/contents/${path.split('/').map(encodeURIComponent).join('/')}`;

  async function getJson(path) {
    const res = await req(`${contentPath(path)}?ref=${encodeURIComponent(branch)}`);
    if (res.status === 404) return { data: null, sha: null };
    if (!res.ok) throw new Error(`GitHub read ${path} failed: ${res.status}`);
    const file = await res.json();
    let content = file.content;
    if (!content && file.git_url) { // files over 1 MB come without inline content
      const blob = await fetch(file.git_url, { headers });
      content = (await blob.json()).content;
    }
    return { data: JSON.parse(fromB64(content)), sha: file.sha };
  }

  async function putJson(path, data, sha, message) {
    const res = await req(contentPath(path), {
      method: 'PUT',
      body: JSON.stringify({ message, branch, content: toB64(`${JSON.stringify(data, null, 1)}\n`), ...(sha ? { sha } : {}) }),
    });
    if (res.ok) return 'ok';
    if (res.status === 409 || res.status === 422) return 'conflict'; // someone else wrote first
    throw new Error(`GitHub write ${path} failed: ${res.status} ${await res.text()}`);
  }

  /**
   * Read-modify-write with retries. fn(data) returns the new data, or
   * undefined to skip writing. Resolves to { data, written }.
   */
  async function update(path, fn, message, attempts = 6) {
    for (let i = 0; i < attempts; i++) {
      if (i) await sleep(150 + Math.random() * 600);
      const { data, sha } = await getJson(path);
      const next = fn(data);
      if (next === undefined) return { data, written: false };
      if ((await putJson(path, next, sha, message)) === 'ok') return { data: next, written: true };
    }
    throw new Error(`GitHub write ${path}: too many conflicts`);
  }

  async function ensureBranch() {
    const res = await req(`/git/ref/heads/${encodeURIComponent(branch)}`);
    if (res.ok) return 'exists';
    const base = await req(`/git/ref/heads/${encodeURIComponent(baseBranch)}`);
    if (!base.ok) throw new Error(`Can't find branch ${baseBranch}: ${base.status}`);
    const { object } = await base.json();
    const made = await req('/git/refs', { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: object.sha }) });
    if (!made.ok && made.status !== 422) throw new Error(`Can't create branch ${branch}: ${made.status}`);
    return 'created';
  }

  return { getJson, putJson, update, ensureBranch };
}

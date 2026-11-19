// A fake Confluence REST API for local testing. Stores content properties in
// localStorage (shared by every tab on this origin) with real version checks,
// so two browser tabs can race each other exactly like two colleagues.
//
// URL options on the harness page:
//   ?user=dara&name=Dara   who is "logged in"
//   ?viewonly=1            writes are refused (403)
//   ?offline=1             every request fails like a dropped network
//   ?slow=800              add this many ms to each request

export function createMockFetch({ storage = localStorage, params = new URLSearchParams(location.search) } = {}) {
  const user = params.get('user') || 'dara';
  const name = params.get('name') || user.charAt(0).toUpperCase() + user.slice(1);
  const viewOnly = params.get('viewonly') === '1';
  const offline = params.get('offline') === '1';
  const slow = Number(params.get('slow') || 0);
  const k = (page, key) => `mockcf.${page}.${key}`;
  const json = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });

  return async function mockFetch(url, opts = {}) {
    if (slow) await new Promise(r => setTimeout(r, slow));
    if (offline) throw new TypeError('Failed to fetch');
    const method = (opts.method || 'GET').toUpperCase();
    const path = new URL(url, location.href).pathname.replace(/^.*\/rest\/api/, '');
    if (path === '/user/current') return json(200, { type: 'known', userKey: `key-${user}`, username: user, displayName: name });

    let m = path.match(/^\/content\/([^/]+)\/property\/([^/]+)$/);
    if (m) {
      const [, page, rawKey] = m;
      const key = decodeURIComponent(rawKey);
      const stored = JSON.parse(storage.getItem(k(page, key)) || 'null');
      if (method === 'GET') return stored ? json(200, stored) : json(404, { message: 'not found' });
      if (method === 'PUT') {
        if (viewOnly) return json(403, { message: 'no edit permission' });
        if (!stored) return json(404, { message: 'not found' });
        const body = JSON.parse(opts.body);
        if (body.version.number !== stored.version.number + 1) return json(409, { message: 'version conflict' });
        const next = { key, value: body.value, version: { number: body.version.number } };
        storage.setItem(k(page, key), JSON.stringify(next));
        return json(200, next);
      }
    }
    m = path.match(/^\/content\/([^/]+)\/property$/);
    if (m && method === 'POST') {
      if (viewOnly) return json(403, { message: 'no edit permission' });
      const body = JSON.parse(opts.body);
      if (storage.getItem(k(m[1], body.key))) return json(409, { message: 'already exists' });
      const next = { key: body.key, value: body.value, version: { number: 1 } };
      storage.setItem(k(m[1], body.key), JSON.stringify(next));
      return json(200, next);
    }
    return json(404, { message: `mock: no route for ${method} ${path}` });
  };
}

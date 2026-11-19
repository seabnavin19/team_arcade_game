// Thin client for Confluence Data Center / Server REST.
// Every call resolves to { status, ... } — it never throws — where status is
// one of: ok | notFound | conflict | forbidden | network | error.

const KNOWN = { 401: 'forbidden', 403: 'forbidden', 404: 'notFound', 409: 'conflict' };

export function detectPage(win = globalThis) {
  const doc = win.document;
  const meta = name => doc?.querySelector?.(`meta[name="${name}"]`)?.getAttribute('content') || '';
  let pageId = '';
  let contextPath = '';
  try { pageId = win.AJS?.Meta?.get?.('page-id') || ''; } catch { /* not Confluence */ }
  try { contextPath = win.AJS?.contextPath?.() ?? ''; } catch { /* not Confluence */ }
  pageId = String(pageId || meta('ajs-page-id') || '');
  contextPath = contextPath || meta('ajs-context-path') || '';
  return { pageId, contextPath };
}

export function createConfluenceClient({ fetch, pageId, contextPath = '' }) {
  if (!pageId) throw new Error('Team Arcade: no Confluence page id found');
  const base = `${contextPath}/rest/api`;
  const propUrl = key => `${base}/content/${encodeURIComponent(pageId)}/property/${encodeURIComponent(key)}`;

  async function call(url, { method = 'GET', body } = {}) {
    let res;
    try {
      res = await fetch(url, {
        method,
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          'X-Atlassian-Token': 'no-check',
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      return { status: 'network', error: err };
    }
    if (res.ok) {
      let data = null;
      try { data = await res.json(); } catch { /* empty body */ }
      return { status: 'ok', data };
    }
    // Creating a property that already exists comes back as 400 or 409
    // depending on version; treat both as "someone else got there first".
    if (method === 'POST' && (res.status === 400 || res.status === 409)) return { status: 'conflict', code: res.status };
    return { status: KNOWN[res.status] || 'error', code: res.status };
  }

  return {
    pageId,
    async currentUser() {
      const r = await call(`${base}/user/current`);
      if (r.status !== 'ok') return r;
      const u = r.data || {};
      if (u.type === 'anonymous' || !(u.userKey || u.username)) return { status: 'forbidden' };
      return { status: 'ok', user: { key: u.userKey || u.username, name: u.displayName || u.username } };
    },
    async getProperty(key) {
      const r = await call(propUrl(key));
      if (r.status !== 'ok') return r;
      return { status: 'ok', value: r.data.value, version: r.data.version?.number ?? 1 };
    },
    async createProperty(key, value) {
      return call(`${base}/content/${encodeURIComponent(pageId)}/property`, { method: 'POST', body: { key, value } });
    },
    async updateProperty(key, value, nextVersion) {
      return call(propUrl(key), {
        method: 'PUT',
        body: { key, value, version: { number: nextVersion, minorEdit: true } },
      });
    },
  };
}

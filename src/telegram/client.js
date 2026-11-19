// Score store for the Telegram version. Same interface as the Confluence
// store (loadBoard / submit / flushQueue / pending) plus beginRun, but scores
// go through the Team Arcade server, which saves them as JSON in GitHub.

export function decodeToken(token) {
  try {
    const part = token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(escape(atob(part + '==='.slice((part.length + 3) % 4))));
    return JSON.parse(json);
  } catch { return null; }
}

export function createTelegramStore({ api, token, fetch = globalThis.fetch.bind(globalThis) }) {
  let boards = null;

  async function call(path, body) {
    try {
      const res = await fetch(`${api}${path}`, body
        ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ t: token, ...body }) }
        : undefined);
      let data = null;
      try { data = await res.json(); } catch { /* no body */ }
      if (res.status === 401) return { status: 'expired', data };
      return res.ok ? { status: 'ok', data } : { status: 'error', data, code: res.status };
    } catch (error) {
      return { status: 'network', error };
    }
  }

  const loadAll = () => (boards ||= call(`/board?t=${encodeURIComponent(token)}`).then(r => {
    if (r.status !== 'ok') boards = null; // allow a retry next time
    return r;
  }));

  return {
    async loadBoard(game, week) {
      const r = await loadAll();
      const empty = { game, week, entries: {} };
      if (r.status !== 'ok') return { status: r.status, board: empty };
      const d = r.data;
      if (week === d.week) return { status: 'ok', board: d.boards[game] || empty };
      if (week === d.lastWeek) return { status: 'ok', board: d.lastBoards[game] || empty };
      return { status: 'ok', board: empty };
    },
    beginRun(game) {
      return call('/run', { game }).then(r => (r.status === 'ok' ? r.data.run : null));
    },
    async submit({ game, score, meta, run }) {
      const ticket = await run;
      if (!ticket) return { status: 'failed', reason: "Couldn't reach the arcade server when the game started, so this score can't be saved." };
      const r = await call('/score', { game, score, meta, run: ticket });
      if (r.status === 'expired') return { status: 'failed', reason: 'This game link has expired. Tap Play in the group again to get a fresh one.' };
      if (r.status === 'network') return { status: 'failed', reason: "Couldn't reach the arcade server. Check your connection and try again." };
      if (r.status !== 'ok') return { status: 'failed', reason: r.data?.reason };
      boards = null; // next load sees everyone's latest scores
      return r.data; // { status: 'saved' | 'notBest' | 'rejected', board, week, reason }
    },
    async flushQueue() { return { sent: 0, left: 0 }; },
    pending: () => 0,
  };
}

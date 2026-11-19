// Saves each player's best score per game per week as a Confluence content
// property, merging safely when several people save at the same moment.

export const MAX_ATTEMPTS = 6;
export const propKey = (week, game) => `team-arcade.${week}.${game}`;

export function isBetter(a, b, better) {
  if (b == null) return true;
  return better === 'lower' ? a < b : a > b;
}

export function emptyBoard(game, week) {
  return { game, week, entries: {} };
}

/** Returns { value, improved } without mutating the input. */
export function mergeEntry(value, { game, week, user, score, at, meta }, better) {
  const base = value && typeof value === 'object' && value.entries ? value : emptyBoard(game, week);
  const current = base.entries[user.key];
  if (current && !isBetter(score, current.score, better)) return { value: base, improved: false };
  const entry = { name: user.name, score, at };
  if (meta) entry.meta = meta;
  return { value: { ...base, entries: { ...base.entries, [user.key]: entry } }, improved: true };
}

export function createScoreStore({
  client,
  storage = globalThis.localStorage,
  sleep = ms => new Promise(r => setTimeout(r, ms)),
  random = Math.random,
  now = () => new Date(),
}) {
  const queueKey = `team-arcade.queue.${client.pageId}`;

  const readQueue = () => {
    try { return JSON.parse(storage?.getItem(queueKey) || '[]'); } catch { return []; }
  };
  const writeQueue = q => {
    try { q.length ? storage?.setItem(queueKey, JSON.stringify(q)) : storage?.removeItem(queueKey); } catch { /* storage blocked */ }
  };
  function enqueue(item) {
    const q = readQueue();
    const same = x => x.game === item.game && x.week === item.week && x.user.key === item.user.key;
    const existing = q.find(same);
    if (existing && !isBetter(item.score, existing.score, item.better)) return;
    writeQueue([...q.filter(x => !same(x)), item]);
  }

  async function loadBoard(game, week) {
    const r = await client.getProperty(propKey(week, game));
    if (r.status === 'ok') return { status: 'ok', board: r.value?.entries ? r.value : emptyBoard(game, week) };
    if (r.status === 'notFound') return { status: 'ok', board: emptyBoard(game, week) };
    return { status: r.status, board: emptyBoard(game, week) };
  }

  async function save(item) {
    const key = propKey(item.week, item.game);
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) await sleep(100 + Math.floor(random() * 500));
      const got = await client.getProperty(key);
      if (got.status === 'network' || got.status === 'error') return { status: 'failed', reason: got.status };
      if (got.status === 'forbidden') return { status: 'viewOnly' };
      const exists = got.status === 'ok';
      const { value, improved } = mergeEntry(exists ? got.value : null, item, item.better);
      if (!improved) return { status: 'notBest', board: value };
      const put = exists
        ? await client.updateProperty(key, value, got.version + 1)
        : await client.createProperty(key, value);
      if (put.status === 'ok') return { status: 'saved', board: value };
      if (put.status === 'conflict') continue; // someone saved first: re-read and merge
      if (put.status === 'forbidden') return { status: 'viewOnly' };
      return { status: 'failed', reason: put.status };
    }
    return { status: 'failed', reason: 'conflict' };
  }

  async function submit({ game, week, user, score, better, meta }) {
    const item = { game, week, user, score, better, meta, at: now().toISOString() };
    const r = await save(item);
    if (r.status === 'failed') {
      enqueue(item);
      return { status: 'queued', reason: r.reason };
    }
    return r;
  }

  async function flushQueue() {
    const q = readQueue();
    if (!q.length) return { sent: 0, left: 0 };
    const left = [];
    let sent = 0;
    for (const item of q) {
      const r = await save(item);
      if (r.status === 'failed') left.push(item);
      else sent++;
    }
    writeQueue(left);
    return { sent, left: left.length };
  }

  return { loadBoard, submit, flushQueue, pending: () => readQueue().length };
}

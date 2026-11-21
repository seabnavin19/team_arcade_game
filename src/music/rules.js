// Music room rules: the shared YouTube queue, playback position, skip votes
// and idle cleanup. Pure functions on a plain state object, so the server
// (telegram/music-room.js) only does I/O and these can be unit-tested.

export const MAX_QUEUE = 50;              // waiting songs in a room
export const MAX_PER_PERSON = 5;          // waiting songs per person
export const MAX_SECONDS = 15 * 60;       // longer songs are skipped
export const IDLE_CLEAR_MS = 24 * 3600e3; // nobody in the room this long → queue cleared
export const END_GRACE_MS = 2000;         // wait a little past a song's end before moving on
export const ENDED_SLACK_S = 5;           // a player saying "ended" this close to the end is believed
export const UNPLAYABLE_CODES = [100, 101, 150]; // YouTube player errors: removed / embedding blocked

export const MESSAGES = {
  notLink: "That doesn't look like a YouTube link.",
  blocked: "This video can't be played outside YouTube. Try a lyric or audio version.",
  queueFull: `The queue is full (${MAX_QUEUE} songs).`,
  perPerson: `You already have ${MAX_PER_PERSON} songs waiting.`,
  unplayable: title => `Skipped ${title}: it can't be played outside YouTube.`,
  tooLong: title => `Skipped ${title}: songs can be at most ${MAX_SECONDS / 60} minutes.`,
};

const HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com']);
const VIDEO_ID = /^[\w-]{11}$/;

export const createMusic = () => ({ queue: [], now: null, votes: [], manualPause: false, emptySince: null });

/** The 11-character video ID from a YouTube link, or null. */
export function parseVideoId(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  let url;
  try { url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { return null; }
  const host = url.hostname.toLowerCase();
  let id = null;
  if (host === 'youtu.be') id = url.pathname.split('/')[1];
  else if (HOSTS.has(host)) {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else if (url.pathname.startsWith('/shorts/')) id = url.pathname.split('/')[2];
  }
  return id && VIDEO_ID.test(id) ? id : null;
}

function play(m, entry, nowMs) {
  m.now = { ...entry, startedAt: nowMs, pausedAt: null };
  m.votes = [];
  m.manualPause = false;
}

export function addSong(m, entry, nowMs) {
  if (!m.now) { play(m, entry, nowMs); return { ok: true, started: true }; }
  if (m.queue.length >= MAX_QUEUE) return { ok: false, reason: MESSAGES.queueFull };
  if (m.queue.filter(e => e.addedBy.key === entry.addedBy.key).length >= MAX_PER_PERSON) return { ok: false, reason: MESSAGES.perPerson };
  m.queue.push(entry);
  return { ok: true, started: false };
}

export function removeSong(m, entryId, userKey) {
  const i = m.queue.findIndex(e => e.id === entryId);
  if (i < 0 || m.queue[i].addedBy.key !== userKey) return { ok: false };
  m.queue.splice(i, 1);
  return { ok: true };
}

/** Seconds into the playing song (held while paused). */
export function position(m, nowMs) {
  if (!m.now) return 0;
  if (m.now.pausedAt != null) return m.now.pausedAt;
  return Math.max(0, (nowMs - m.now.startedAt) / 1000);
}

export function pause(m, nowMs, { manual }) {
  if (!m.now) return;
  if (m.now.pausedAt == null) m.now.pausedAt = position(m, nowMs);
  if (manual) m.manualPause = true;
}

export function resume(m, nowMs) {
  m.manualPause = false;
  if (!m.now || m.now.pausedAt == null) return;
  m.now.startedAt = nowMs - m.now.pausedAt * 1000;
  m.now.pausedAt = null;
}

/** Start the next waiting song (or go idle). Returns what's playing now. */
export function advance(m, nowMs) {
  const next = m.queue.shift();
  if (next) play(m, next, nowMs);
  else { m.now = null; m.votes = []; m.manualPause = false; }
  return m.now;
}

export const neededVotes = listenerCount => Math.max(1, Math.ceil(listenerCount / 2));

/** A skip (or vote) for song `entryId`. Ignored if that song is no longer playing, so
    a double-click or two votes at once never skip the next song too. */
export function voteSkip(m, userKey, listenerKeys, nowMs, entryId) {
  if (!m.now || m.now.id !== entryId) return { skipped: false, votes: m.votes.length, needed: neededVotes(listenerKeys.length) };
  if (m.now.addedBy.key === userKey) { advance(m, nowMs); return { skipped: true, votes: 0, needed: 0 }; }
  if (!m.votes.includes(userKey)) m.votes.push(userKey);
  return check(m, listenerKeys, nowMs);
}

function check(m, listenerKeys, nowMs) {
  const votes = m.votes.length, needed = neededVotes(listenerKeys.length);
  if (votes > 0 && votes >= needed) { advance(m, nowMs); return { skipped: true, votes, needed }; }
  return { skipped: false, votes, needed };
}

/** After listeners change: drop votes of people who left; skip if enough votes remain. */
export function recheckVotes(m, listenerKeys, nowMs) {
  if (!m.now) return false;
  m.votes = m.votes.filter(k => listenerKeys.includes(k));
  return check(m, listenerKeys, nowMs).skipped;
}

export function setDuration(m, entryId, seconds) {
  const s = Number(seconds);
  if (!m.now || m.now.id !== entryId || !(s >= 1 && s <= 10800)) return { changed: false, tooLong: false };
  if (m.now.seconds != null && s <= m.now.seconds) return { changed: false, tooLong: false };
  m.now.seconds = s;
  return { changed: true, tooLong: s > MAX_SECONDS };
}

export function clientEnded(m, entryId, nowMs) {
  if (!m.now || m.now.id !== entryId || m.now.pausedAt != null) return false;
  const pos = position(m, nowMs);
  const ok = m.now.seconds != null ? pos >= m.now.seconds - ENDED_SLACK_S : pos >= 10;
  if (ok) advance(m, nowMs);
  return ok;
}

export function unplayable(m, entryId, code, nowMs) {
  if (!m.now || m.now.id !== entryId || !UNPLAYABLE_CODES.includes(Number(code))) return null;
  const skipped = m.now;
  advance(m, nowMs);
  return skipped;
}

function songEndsAt(m) {
  if (!m.now || m.now.pausedAt != null) return null;
  return m.now.seconds != null ? m.now.startedAt + m.now.seconds * 1000 + END_GRACE_MS : m.now.startedAt + MAX_SECONDS * 1000;
}

/** When the room's single alarm should next fire, or null. */
export function nextAlarmAt(m) {
  const times = [songEndsAt(m), m.emptySince != null ? m.emptySince + IDLE_CLEAR_MS : null].filter(t => t != null);
  return times.length ? Math.min(...times) : null;
}

export function onAlarm(m, nowMs) {
  if (m.emptySince != null && nowMs >= m.emptySince + IDLE_CLEAR_MS) {
    Object.assign(m, createMusic());
    return { advanced: false, cleared: true };
  }
  const end = songEndsAt(m);
  if (end != null && nowMs >= end) { advance(m, nowMs); return { advanced: true, cleared: false }; }
  return { advanced: false, cleared: false };
}

export function onListenersChanged(m, listenerCount, nowMs) {
  if (listenerCount === 0) {
    pause(m, nowMs, { manual: false });
    if (m.emptySince == null) m.emptySince = nowMs;
  } else {
    m.emptySince = null;
    if (!m.manualPause) resume(m, nowMs);
  }
}

export const publicMusic = (m, nowMs) => ({
  now: m.now, queue: m.queue, votes: m.votes.length,
  paused: !!m.now && m.now.pausedAt != null, position: position(m, nowMs), serverNow: nowMs,
});

/** Client: is the player far enough from the shared position to jump? */
export const driftSeek = (playerSeconds, targetSeconds) => Math.abs(playerSeconds - targetSeconds) > 1.5;

/**
 * Client: which song a player event (playing, ended, error) is about. Uses the
 * song this player loaded, not the room's current one, and drops events from a
 * different video (a late event from the previous song).
 */
export function playerEntryId(loaded, playerVideoId) {
  if (!loaded) return null;
  if (playerVideoId && playerVideoId !== loaded.videoId) return null;
  return loaded.id;
}

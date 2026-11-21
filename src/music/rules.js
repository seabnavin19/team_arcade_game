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

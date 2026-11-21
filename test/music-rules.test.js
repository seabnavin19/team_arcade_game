import { describe, it, expect } from 'vitest';
import { parseVideoId, createMusic, addSong, removeSong, MESSAGES, MAX_QUEUE, MAX_PER_PERSON } from '../src/music/rules.js';

const ID = 'dQw4w9WgXcQ';
const DARA = { key: 'tg-1', name: 'Dara' };
const SOKHA = { key: 'tg-2', name: 'Sokha' };
let n = 0;
const entry = (by = DARA, extra = {}) => ({ id: `e${++n}`, videoId: ID, title: `Song ${n}`, seconds: null, addedBy: by, ...extra });

describe('parseVideoId', () => {
  it.each([
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}&list=PL1&t=30`,
    `https://youtu.be/${ID}?si=abc`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://music.youtube.com/watch?v=${ID}`,
    `https://www.youtube.com/shorts/${ID}`,
    `  youtu.be/${ID}  `,
  ])('reads the video from %s', url => expect(parseVideoId(url)).toBe(ID));

  it.each([
    'https://www.youtube.com/playlist?list=PL1',
    'https://vimeo.com/123',
    'hello',
    'https://youtube.com/watch?v=short',
    `https://evil.com/watch?v=${ID}`,
    '',
  ])('rejects %s', url => expect(parseVideoId(url)).toBeNull());
});

describe('queue', () => {
  it('the first song starts at once, the next one waits', () => {
    const m = createMusic();
    expect(addSong(m, entry(), 1000)).toEqual({ ok: true, started: true });
    expect(m.now.startedAt).toBe(1000);
    expect(m.now.pausedAt).toBeNull();
    expect(m.queue).toHaveLength(0);
    expect(addSong(m, entry(SOKHA), 2000)).toEqual({ ok: true, started: false });
    expect(m.queue).toHaveLength(1);
  });

  it(`stops at ${MAX_QUEUE} waiting songs`, () => {
    const m = createMusic();
    addSong(m, entry(), 0); // playing
    for (let i = 0; i < MAX_QUEUE; i++) expect(addSong(m, entry({ key: `k${i}`, name: 'X' }), 0).ok).toBe(true);
    expect(addSong(m, entry(SOKHA), 0)).toEqual({ ok: false, reason: MESSAGES.queueFull });
  });

  it(`allows ${MAX_PER_PERSON} waiting songs per person (the playing one doesn't count)`, () => {
    const m = createMusic();
    addSong(m, entry(), 0);
    for (let i = 0; i < MAX_PER_PERSON; i++) expect(addSong(m, entry(), 0).ok).toBe(true);
    expect(addSong(m, entry(), 0)).toEqual({ ok: false, reason: MESSAGES.perPerson });
    expect(addSong(m, entry(SOKHA), 0).ok).toBe(true);
  });

  it('only the person who added a waiting song can remove it', () => {
    const m = createMusic();
    const playing = entry(); addSong(m, playing, 0);
    const waiting = entry(); addSong(m, waiting, 0);
    expect(removeSong(m, waiting.id, SOKHA.key)).toEqual({ ok: false });
    expect(removeSong(m, playing.id, DARA.key)).toEqual({ ok: false });
    expect(removeSong(m, waiting.id, DARA.key)).toEqual({ ok: true });
    expect(m.queue).toHaveLength(0);
  });
});

import { position, pause, resume, advance, neededVotes, voteSkip, recheckVotes, setDuration, clientEnded, unplayable, nextAlarmAt, onAlarm, onListenersChanged, publicMusic, driftSeek, IDLE_CLEAR_MS } from '../src/music/rules.js';

const T = 1_000_000;
function room(...adders) {
  const m = createMusic();
  const entries = adders.map(by => entry(by));
  entries.forEach(e => addSong(m, e, T));
  return { m, entries };
}

describe('position, pause and resume', () => {
  it('counts from the start, holds while paused, continues after resume', () => {
    const { m } = room(DARA);
    expect(position(m, T + 42_000)).toBe(42);
    pause(m, T + 42_000, { manual: true });
    expect(position(m, T + 100_000)).toBe(42);
    expect(m.manualPause).toBe(true);
    resume(m, T + 100_000);
    expect(m.manualPause).toBe(false);
    expect(position(m, T + 110_000)).toBe(52);
  });
  it('is 0 with nothing playing', () => expect(position(createMusic(), T)).toBe(0));
});

describe('skip votes', () => {
  it('needs half of the listeners, rounded up, at least 1', () => {
    expect(neededVotes(3)).toBe(2);
    expect(neededVotes(4)).toBe(2);
    expect(neededVotes(1)).toBe(1);
    expect(neededVotes(0)).toBe(1);
  });
  it('skips once enough different people vote', () => {
    const { m, entries } = room(DARA, DARA);
    const L = ['tg-1', 'tg-2', 'tg-3'];
    expect(voteSkip(m, 'tg-2', L, T, m.now.id)).toEqual({ skipped: false, votes: 1, needed: 2 });
    expect(voteSkip(m, 'tg-2', L, T, m.now.id)).toEqual({ skipped: false, votes: 1, needed: 2 });
    expect(voteSkip(m, 'tg-3', L, T + 5000, m.now.id).skipped).toBe(true);
    expect(m.now.id).toBe(entries[1].id);
    expect(m.now.startedAt).toBe(T + 5000);
    expect(m.votes).toEqual([]);
  });
  it('the person who added the song skips it at once', () => {
    const { m } = room(DARA);
    expect(voteSkip(m, 'tg-1', ['tg-1', 'tg-2', 'tg-3', 'tg-4'], T, m.now.id).skipped).toBe(true);
    expect(m.now).toBeNull();
  });
  it('two votes out of four listeners is enough', () => {
    const { m, entries } = room(DARA, DARA);
    voteSkip(m, 'tg-2', ['tg-1', 'tg-2', 'tg-3', 'tg-4'], T, m.now.id);
    expect(voteSkip(m, 'tg-3', ['tg-1', 'tg-2', 'tg-3', 'tg-4'], T, m.now.id).skipped).toBe(true);
    expect(m.now.id).toBe(entries[1].id);
  });
  it('re-check after leaving can complete a skip', () => {
    const { m, entries } = room(DARA, DARA);
    voteSkip(m, 'tg-2', ['tg-1', 'tg-2', 'tg-3', 'tg-4', 'tg-5'], T, m.now.id); // 1 of 3 needed
    expect(recheckVotes(m, ['tg-9', 'tg-3', 'tg-4'], T)).toBe(false); // tg-2 left: vote dropped
    expect(m.votes).toEqual([]);
    voteSkip(m, 'tg-3', ['tg-1', 'tg-3', 'tg-4', 'tg-5'], T, m.now.id); // 1 of 2
    expect(recheckVotes(m, ['tg-1', 'tg-3'], T)).toBe(true); // 1 of 1
    expect(m.now.id).toBe(entries[1].id);
  });
});

describe('song length', () => {
  it('takes the first sane length, and later only longer ones', () => {
    const { m, entries } = room(DARA, DARA);
    const id = entries[0].id;
    expect(setDuration(m, id, 0).changed).toBe(false);
    expect(setDuration(m, id, 20000).changed).toBe(false);
    expect(setDuration(m, id, 200)).toEqual({ changed: true, tooLong: false });
    expect(setDuration(m, id, 150).changed).toBe(false);
    expect(setDuration(m, id, 210).changed).toBe(true);
    expect(m.now.seconds).toBe(210);
    expect(setDuration(m, entries[1].id, 100).changed).toBe(false); // not playing
    expect(setDuration(m, id, 1000)).toEqual({ changed: true, tooLong: true });
  });
  it('believes "ended" only near the real end of the playing song', () => {
    const { m, entries } = room(DARA, DARA);
    setDuration(m, entries[0].id, 200);
    expect(clientEnded(m, entries[0].id, T + 100_000)).toBe(false);
    expect(clientEnded(m, 'stale', T + 199_000)).toBe(false);
    expect(clientEnded(m, entries[0].id, T + 196_000)).toBe(true);
    expect(m.now.id).toBe(entries[1].id);
  });
  it('with an unknown length, believes "ended" after 10 seconds', () => {
    const { m, entries } = room(DARA);
    expect(clientEnded(m, entries[0].id, T + 5000)).toBe(false);
    expect(clientEnded(m, entries[0].id, T + 10_000)).toBe(true);
  });
  it('skips a song the player cannot play', () => {
    const { m, entries } = room(DARA, DARA);
    expect(unplayable(m, entries[0].id, 2, T)).toBeNull();
    expect(unplayable(m, 'stale', 150, T)).toBeNull();
    expect(unplayable(m, entries[0].id, 150, T).id).toBe(entries[0].id);
    expect(m.now.id).toBe(entries[1].id);
  });
});

describe('alarms and listeners', () => {
  it('sets the alarm for the end of the song plus grace', () => {
    const { m, entries } = room(DARA);
    setDuration(m, entries[0].id, 200);
    expect(nextAlarmAt(m)).toBe(T + 202_000);
  });
  it('pauses when everyone leaves and clears after a day', () => {
    const { m } = room(DARA, DARA);
    onListenersChanged(m, 0, T + 30_000);
    expect(m.now.pausedAt).toBe(30);
    expect(nextAlarmAt(m)).toBe(T + 30_000 + IDLE_CLEAR_MS);
    expect(onAlarm(m, T + 30_000 + IDLE_CLEAR_MS)).toEqual({ advanced: false, cleared: true });
    expect(m.now).toBeNull();
    expect(m.queue).toEqual([]);
    expect(nextAlarmAt(m)).toBeNull();
  });
  it('resumes when someone comes back, unless it was paused on purpose', () => {
    const { m } = room(DARA);
    onListenersChanged(m, 0, T + 30_000);
    onListenersChanged(m, 1, T + 90_000);
    expect(m.emptySince).toBeNull();
    expect(position(m, T + 95_000)).toBe(35);
    pause(m, T + 95_000, { manual: true });
    onListenersChanged(m, 0, T + 100_000);
    onListenersChanged(m, 1, T + 200_000);
    expect(m.now.pausedAt).toBe(35);
  });
  it('moves to the next song when the end alarm fires', () => {
    const { m, entries } = room(DARA, DARA);
    setDuration(m, entries[0].id, 200);
    expect(onAlarm(m, T + 100_000)).toEqual({ advanced: false, cleared: false });
    expect(onAlarm(m, T + 202_000)).toEqual({ advanced: true, cleared: false });
    expect(m.now.id).toBe(entries[1].id);
    expect(advance(m, T + 300_000)).toBeNull();
  });
});

describe('what listeners see', () => {
  it('shows the playing song, the queue, votes and position', () => {
    const { m } = room(DARA, SOKHA);
    voteSkip(m, 'tg-3', ['tg-1', 'tg-2', 'tg-3', 'tg-4', 'tg-5'], T, m.now.id);
    const s = publicMusic(m, T + 7000);
    expect(s).toMatchObject({ votes: 1, paused: false, position: 7, serverNow: T + 7000 });
    expect(s.now.addedBy.name).toBe('Dara');
    expect(s.queue[0].addedBy.name).toBe('Sokha');
  });
  it('drift over 1.5 seconds means seek', () => {
    expect(driftSeek(10, 11.4)).toBe(false);
    expect(driftSeek(10, 11.6)).toBe(true);
    expect(driftSeek(12, 10)).toBe(true);
  });
});

describe('stale skips', () => {
  it("a double-click by the adder doesn't also skip the next song", () => {
    const { m, entries } = room(DARA, SOKHA);
    const L = ['tg-1', 'tg-2'];
    expect(voteSkip(m, 'tg-1', L, T, entries[0].id).skipped).toBe(true);
    expect(voteSkip(m, 'tg-1', L, T, entries[0].id).skipped).toBe(false);
    expect(m.now.id).toBe(entries[1].id);
  });
  it('two votes at once skip only the song they were for', () => {
    const { m, entries } = room(DARA, DARA, DARA);
    const L = ['tg-1', 'tg-2', 'tg-3'];
    voteSkip(m, 'tg-2', L, T, entries[0].id);
    voteSkip(m, 'tg-3', L, T, entries[0].id); // skips song 1
    expect(voteSkip(m, 'tg-2', L, T, entries[0].id).skipped).toBe(false); // late duplicate
    expect(m.now.id).toBe(entries[1].id);
    expect(m.votes).toEqual([]);
  });
});

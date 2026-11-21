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

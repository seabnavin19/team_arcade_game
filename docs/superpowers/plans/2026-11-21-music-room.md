# Music Room Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/music` room per Telegram group where anyone adds YouTube links to a shared queue and everyone hears the same song at the same point.

**Architecture:** Pure queue/playback rules in `src/music/rules.js` (unit-tested). A new `MusicRoom` Durable Object (`telegram/music-room.js`, one per group, separate from `PartyRoom`) holds that state in storage, talks to clients over hibernating WebSockets, checks links with YouTube oEmbed and uses one alarm for song ends and idle cleanup. The Worker adds `/music`, a music card link (`m` claim, `#…&music=1`) and `GET /music/ws`. The page gets a `createMusicApp` screen that drives YouTube's IFrame player from server state.

**Tech Stack:** Plain ES modules, Cloudflare Workers + Durable Objects (SQLite-backed, key/value `ctx.storage`), Vitest, esbuild, YouTube IFrame Player API, YouTube oEmbed.

**Spec:** `docs/superpowers/specs/2026-11-20-music-room-design.md`

## Global Constraints

- No ytdl, no audio download or re-hosting, no YouTube Data API key, no external database.
- Free Cloudflare plan: new DO class via migration tag `v2`, `new_sqlite_classes = ["MusicRoom"]`, binding `MUSIC`.
- Reuse the existing game card (`GAME_SHORT_NAME`); no new BotFather game.
- Limits: 50 songs in the queue, 5 queued songs per person, 15 minutes max length, 24 h idle before the queue is cleared. Constants at the top of `src/music/rules.js`.
- Skip: the adder skips instantly; others vote; skipped when votes ≥ `max(1, ceil(listeners / 2))`.
- Group messages off by default: `MUSIC_ANNOUNCE = "off"` in `telegram/wrangler.toml` (`"now-playing"` turns them on).
- Desktop-first screen; music must keep going in a background tab (song changes are driven by WebSocket messages and player events, not client timers).
- User-facing copy (exact):
  - not a link: `That doesn't look like a YouTube link.`
  - blocked: `This video can't be played outside YouTube. Try a lyric or audio version.`
  - queue full: `The queue is full (50 songs).`
  - per person: `You already have 5 songs waiting.`
  - skipped unplayable: `Skipped <title>: it can't be played outside YouTube.`
  - skipped too long: `Skipped <title>: songs can be at most 15 minutes.`
  - private chat: `Music rooms are for groups: add me to your team group and send /music there.`
  - announce: `🎵 Now playing: <b><title></b> (added by <name>)`

## Review Focus

1. Links with extra parts (`watch?v=ID&list=…&t=30`, `youtu.be/ID?si=…`, `/shorts/ID`, `music.youtube.com`) should play the video; playlists-only links and other sites are rejected. Test in Task 1.
2. One person with two tabs open counts as one listener and one vote. Test in Task 3.
3. A listener leaving can make the vote threshold met; the song should then skip. Test in Task 3.
4. A `duration`/`ended`/`unplayable` message for a song that's no longer playing is ignored. Test in Task 2.
5. The room being evicted mid-song resumes from storage at the right position. Test in Task 3.

---

### Task 1: Queue rules and link parsing

**Files:**
- Create: `src/music/rules.js`
- Test: `test/music-rules.test.js`

**Interfaces:**
- Produces:
  - constants `MAX_QUEUE = 50`, `MAX_PER_PERSON = 5`, `MAX_SECONDS = 900`, `IDLE_CLEAR_MS = 86_400_000`, `END_GRACE_MS = 2000`, `ENDED_SLACK_S = 5`, `UNPLAYABLE_CODES = [100, 101, 150]`, `MESSAGES` (object holding the copy strings above, title-taking ones as functions).
  - `createMusic() -> { queue: Entry[], now: Playing|null, votes: string[], manualPause: false, emptySince: null }`
  - `Entry = { id: string, videoId: string, title: string, seconds: number|null, addedBy: { key, name } }`
  - `Playing = Entry & { startedAt: number, pausedAt: number|null }` (`pausedAt` is a position in seconds; `startedAt` is server ms at position 0)
  - `parseVideoId(url: string) -> string|null`
  - `addSong(m, entry: Entry, nowMs) -> { ok: true, started: boolean } | { ok: false, reason: string }` (starts it at once if nothing is playing)
  - `removeSong(m, entryId, userKey) -> { ok: boolean }` (queued songs only, only by `addedBy.key`)

- [ ] **Step 1: Install dependencies** — `npm install`, then `npm test`. Expected: all existing tests pass.
- [ ] **Step 2: Write failing tests** in `test/music-rules.test.js`:
  - `parseVideoId` returns `'dQw4w9WgXcQ'` for each of: `https://www.youtube.com/watch?v=dQw4w9WgXcQ`, `https://youtube.com/watch?v=dQw4w9WgXcQ&list=PL1&t=30`, `https://youtu.be/dQw4w9WgXcQ?si=abc`, `https://m.youtube.com/watch?v=dQw4w9WgXcQ`, `https://music.youtube.com/watch?v=dQw4w9WgXcQ`, `https://www.youtube.com/shorts/dQw4w9WgXcQ`, `  youtu.be/dQw4w9WgXcQ  ` (no scheme, spaces).
  - returns `null` for `https://www.youtube.com/playlist?list=PL1`, `https://vimeo.com/123`, `hello`, `https://youtube.com/watch?v=short`, `https://evil.com/watch?v=dQw4w9WgXcQ`.
  - `addSong` to an empty room → `{ ok: true, started: true }`, `m.now.startedAt === nowMs`, `m.queue` empty; second add → `started: false`, queued.
  - 51st song → `{ ok: false, reason: MESSAGES.queueFull }`; 6th waiting song from the same key → `MESSAGES.perPerson` (the playing song doesn't count toward 5).
  - `removeSong` by the adder removes; by someone else → `{ ok: false }`; with the playing entry's id → `{ ok: false }`.
- [ ] **Step 3: Run** `npx vitest run test/music-rules.test.js` — Expected: FAIL (module not found).
- [ ] **Step 4: Implement** the produced exports. `parseVideoId`: parse with `new URL` (prefix `https://` if no scheme), accept hosts `youtube.com`, `www.`, `m.`, `music.` and `youtu.be`; the ID must match `/^[\w-]{11}$/`.
- [ ] **Step 5: Run** the test file — Expected: PASS.
- [ ] **Step 6: Commit** — `git add src/music/rules.js test/music-rules.test.js package-lock.json && git commit -m "Music room: queue rules and YouTube link parsing"`

### Task 2: Playback rules (position, pause, skip, durations, alarms)

**Files:**
- Modify: `src/music/rules.js`
- Test: `test/music-rules.test.js`

**Interfaces:**
- Consumes: Task 1 state shape.
- Produces:
  - `position(m, nowMs) -> number` seconds (`pausedAt` if paused, 0 if idle)
  - `pause(m, nowMs, { manual: boolean })`, `resume(m, nowMs)` (resume clears `manualPause`)
  - `advance(m, nowMs) -> Playing|null` (next from queue, clears votes; `null` → idle)
  - `neededVotes(listenerCount) -> number` = `max(1, ceil(n/2))`
  - `voteSkip(m, userKey, listenerKeys: string[], nowMs) -> { skipped: boolean, votes: number, needed: number }` (adder → skip at once)
  - `recheckVotes(m, listenerKeys, nowMs) -> boolean` (drops votes of keys not listening, skips if threshold now met)
  - `setDuration(m, entryId, seconds) -> { changed: boolean, tooLong: boolean }` (only for the playing entry; accept 1–10800; only first value or a longer one; `tooLong` when > `MAX_SECONDS`)
  - `clientEnded(m, entryId, nowMs) -> boolean` (advance only if it's the playing entry, not paused, duration known and `position >= seconds - ENDED_SLACK_S`; with unknown duration accept once `position >= 10`)
  - `unplayable(m, entryId, code, nowMs) -> Entry|null` (skips and returns the skipped entry if playing entry and code in `UNPLAYABLE_CODES`)
  - `nextAlarmAt(m) -> number|null`: if playing and not paused: `startedAt + seconds*1000 + END_GRACE_MS` (unknown duration: `startedAt + MAX_SECONDS*1000`); else if `emptySince`: `emptySince + IDLE_CLEAR_MS`; else `null`. When both apply, the earlier.
  - `onAlarm(m, nowMs) -> { advanced: boolean, cleared: boolean }` (advance if song end reached; clear queue + `now` + votes if idle time reached)
  - `onListenersChanged(m, listenerCount, nowMs)`: 0 → auto-pause (`manual: false`) and set `emptySince`; >0 → clear `emptySince`, resume if paused and `!manualPause`.
  - `publicMusic(m, nowMs) -> { now: Playing|null, queue: Entry[], votes: number, paused: boolean, position: number, serverNow: number }`
  - `driftSeek(playerSeconds, targetSeconds) -> boolean` (true when `|diff| > 1.5`) — used by the client.

- [ ] **Step 1: Write failing tests**:
  - position: started at t, `position(t + 42_000) === 42`; pause at +42 s, `position(+100 s) === 42`; resume at +100 s, `position(+110 s) === 52`.
  - votes: 3 listeners → `neededVotes(3) === 2`; one vote → not skipped (`votes: 1, needed: 2`); same key again → still 1; second key → skipped and next song playing, votes reset. `neededVotes(1) === 1`, `neededVotes(0) === 1`.
  - adder's `voteSkip` skips at once with 4 listeners.
  - `recheckVotes`: 4 listeners, 1 vote from A; listeners become [A, B] → skipped. Vote from a key that left is dropped.
  - `setDuration`: 200 accepted; later 150 ignored; later 210 accepted; 0 and 20000 ignored; 1000 → `tooLong: true`; for a non-playing entry id → `changed: false`.
  - `clientEnded`: duration 200, at position 100 → false; at 196 → true and advanced; stale entry id → false.
  - `unplayable`: code 150 on playing → returns entry, next playing; code 2 → null; stale id → null.
  - `nextAlarmAt`: playing 200 s from t → `t + 202_000`; paused with nobody listening since e → `e + 86_400_000`.
  - `onListenersChanged(0)` pauses; `(1)` resumes; after a manual pause, `(0)` then `(1)` stays paused.
  - `onAlarm` at idle deadline clears queue and `now`.
- [ ] **Step 2: Run** — Expected: FAIL (exports missing).
- [ ] **Step 3: Implement** the produced exports in `src/music/rules.js`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "Music room: playback, skip votes and idle rules"`

### Task 3: `MusicRoom` Durable Object

**Files:**
- Create: `telegram/music-room.js`
- Modify: `telegram/worker.js` (export `MusicRoom`), `telegram/wrangler.toml` (binding `MUSIC`, migration `v2`, var `MUSIC_ANNOUNCE = "off"`)
- Test: `test/music-room.test.js`

**Interfaces:**
- Consumes: all of `src/music/rules.js`.
- Produces: `class MusicRoom { constructor(ctx, env, { now, fetch }) }` with:
  - HTTP (from the Worker): `POST /set-card { chat, messageId }` (keeps the last 5 card ids and the chat id) → `{ ok }`; `GET /is-card?messageId=` → `{ card: boolean }`; `GET /ws` with header `X-Arcade-User: {"key","name"}` → WebSocket upgrade.
  - Client → server messages: `ping {c}`, `add {url}`, `remove {id}`, `pause`, `resume`, `skip`, `duration {id, seconds}`, `ended {id}`, `unplayable {id, code}`.
  - Server → client: `pong {c, s}`; `state { music: publicMusic(...), listeners: [{key,name}], you }` (sent on connect and after every change); `notice { text }` (to the sender only for add errors; to everyone for "Skipped …").
  - Storage: key `music` (the rules state) and `cards` (`{ chat, ids: number[] }`). Every change: save, broadcast state, then set the alarm from `nextAlarmAt` (`ctx.storage.deleteAlarm()` when null).
  - Listeners: distinct `key`s across `ctx.getWebSockets()`, excluding the closing socket in `webSocketClose`. Call `onListenersChanged` on connect/close and `recheckVotes` on close.
  - `add`: `parseVideoId` → oEmbed `GET https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=<id>&format=json`; 401/403/404 → `MESSAGES.blocked`; other failure → title `YouTube video`; entry id `crypto.randomUUID().slice(0, 8)`; title cut to 120 chars.
  - `duration`: when `setDuration` returns `tooLong`, call `advance` and broadcast `notice` with `MESSAGES.tooLong(title)`. `unplayable` that skips → broadcast `MESSAGES.unplayable(title)`.
  - Announce: when a song starts and `env.MUSIC_ANNOUNCE === 'now-playing'`, `sendMessage` to `cards.chat` with the announce copy (HTML-escaped title/name).

- [ ] **Step 1: Write failing tests** in `test/music-room.test.js`, reusing the fake namespace/WebSocket/fetch pattern from `test/party-room.test.js` (add `deleteAlarm` to the fake storage; the fake fetch answers `youtube.com/oembed` with `{ title: 'Song A' }`, or 401 for video id `blockedXXXXX`):
  - connect A, `add` a link → both sockets get `state` with `now.title === 'Song A'`, `now.addedBy.name === 'Dara'`.
  - `add` of `blockedXXXXX` link → only the sender gets `notice` with `MESSAGES.blocked`; queue unchanged. `add` of `hello` → `MESSAGES.notLink`.
  - `duration 200` then `clock = alarm(); await obj.alarm()` → next song playing; with an empty queue → `now === null`.
  - two sockets with the same key count as one listener (`state.listeners.length === 1`).
  - 3 listeners, one non-adder `skip` → not skipped; the second voter leaves (`webSocketClose`) → recheck with 2 listeners, 1 vote → skipped.
  - last socket closes → state paused and the alarm is set to `clock + 86_400_000`; alarm fires → queue cleared.
  - eviction: new `MusicRoom` over the same storage, connect → `position` equals elapsed seconds.
  - `MUSIC_ANNOUNCE: 'now-playing'` with a stored card → `sendMessage` sent with `🎵 Now playing: <b>Song A</b> (added by Dara)`; with `off` → no `sendMessage`.
- [ ] **Step 2: Run** `npx vitest run test/music-room.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** `telegram/music-room.js`, then the `worker.js` export and `wrangler.toml` changes.
- [ ] **Step 4: Run** `npm test` — Expected: all PASS.
- [ ] **Step 5: Commit** — `git add telegram test/music-room.test.js && git commit -m "Music room: Durable Object with shared queue and sync"`

### Task 4: Bot command, music links and WebSocket route

**Files:**
- Modify: `telegram/app.js` (`/music` command, callback branch, `/music/ws` route, `/help`, `setMyCommands`)
- Test: `test/music-room.test.js` (new `describe('music bot')`, using `createHandler` as `party-room.test.js` does, with `env.MUSIC` set to a fake `MusicRoom` namespace)

**Interfaces:**
- Consumes: `MusicRoom` `/set-card`, `/is-card`, `/ws` (Task 3).
- Produces: signed claim `m: 1`; game URL hash `#t=<token>&music=1`; `GET /music/ws?t=` (401 `{reason:'expired'}` for bad tokens, 400 `{reason:'not a music link'}` without `m`).

- [ ] **Step 1: Write failing tests**:
  - `/music` in a group → `sendGame` with button `{ text: '🎵 Open music room', callback_game: {} }`, and the room has that card id.
  - `/music` in a private chat → the private-chat copy.
  - tapping that card (`message_id: 777`) → URL hash has `music=1` and the verified token has `m === 1`; tapping a normal card → no `music`.
  - a live party card still gets `party=1` when a music card exists in the same group.
  - `/music/ws` with a non-music token → 400.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement**. In the callback: check the party lookup first, then `MUSIC /is-card` (only when `env.MUSIC` is set). Add `{ command: 'music', description: 'Listen to music together (YouTube)' }` to `setMyCommands` and a `/music` line to `/help`.
- [ ] **Step 4: Run** `npm test` — Expected: all PASS.
- [ ] **Step 5: Commit** — `git commit -am "Music room: /music command and music links"`

### Task 5: Music screen in the page

**Files:**
- Create: `src/music/music-app.js`
- Modify: `src/telegram-main.js` (open it when `claims.m && hash.get('music') === '1'`), `src/ui/arcade.css` (`.ta-music*` styles using existing tokens)

**Interfaces:**
- Consumes: wire messages (Task 3), `driftSeek` (Task 2), URL from Task 4.
- Produces: `createMusicApp(root, { api, token, onExit, WebSocketImpl = globalThis.WebSocket }) -> { exit }`.

Behaviour (from the spec's layout sketch): player on top, then title, `m:ss / m:ss`, "added by", ⏸/▶ and ⏭ (label `⏭ Skip` for the adder, `⏭ Vote 1/2` for others), "Up next" with ✕ on your own songs, paste box + **Add** (Enter submits), "N listening: …". First open shows a **🎧 Tap to listen** overlay; the tap loads `https://www.youtube.com/iframe_api` once and creates the player (`controls: 0`, `playsinline: 1`). Clock offset by ping/pong as in `party-app.js`; reconnect with the same backoff. On each `state`: `loadVideoById(videoId, position)` when the video changed, else `driftSeek` → `seekTo`; paused state → `pauseVideo`. Report `duration` on first `PLAYING`, `ended` on `ENDED`, `unplayable` on `onError`. Run the drift check every 3 s and on `visibilitychange` to visible. "Back to arcade" calls `onExit`.

- [ ] **Step 1: Implement** `music-app.js` and the `telegram-main.js` branch.
- [ ] **Step 2: Build** — `npm run build`. Expected: `built site/ …` with no errors.
- [ ] **Step 3: Manual check** with `cd telegram && npx wrangler dev` and two desktop browsers on the music link: add two songs; both hear the same point (within about a second); pause/resume affects both; vote skip needs both; minimise one window for a song change and confirm the next song plays; close both, reopen → resumes where it paused. Note the results.
- [ ] **Step 4: Run** `npm test` — Expected: all PASS.
- [ ] **Step 5: Commit** — `git add src && git commit -m "Music room: listening screen with synced YouTube player"`

### Task 6: README

**Files:**
- Modify: `README.md` (new "🎵 Music room" section after Live party; `/music` in the bot command list; `MUSIC_ANNOUNCE` and `src/music/rules.js` rows in "Changing things"; `src/music/` in the folder list)

- [ ] **Step 1: Write** the section: what it does, adding by pasting links, pause for everyone, skip/vote rules, pause when everyone leaves and clear after 24 h, built for computers (keeps playing in a background tab) and stops on phones when the screen locks, some official videos won't play.
- [ ] **Step 2: Commit** — `git commit -am "README: music room"`

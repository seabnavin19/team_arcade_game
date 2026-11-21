# Music Room — design

## Intent

Let a Telegram team group listen to music together. Anyone in the group can add a YouTube song to a shared queue, and everyone who has the music room open hears the same song at the same point. It sits alongside the arcade games and party rounds, using the same bot, Worker and page.

## Goals

- `/music` in a group posts a card with a **🎵 Open music room** button (same Telegram "game" card mechanism as `/arcade` and `/party`).
- One music room per group. It stays open as long as it has songs and listeners. There's no lobby and no 60-second round.
- Anyone can paste a YouTube link to add it to the queue. The queue shows each song's title, its length and who added it.
- Everyone hears the same song at the same position. A late joiner starts mid-song.
- **Pause / resume:** anyone can do it, and it applies to everyone.
- **Remove:** whoever added a song can remove it from the queue before it plays.
- **Skip:** whoever added the playing song can skip it instantly. Anyone else votes to skip. The song is skipped when votes ≥ half of the current listeners, rounded up (with 1 listener, 1 vote; with 3 listeners, 2 votes).
- When a song ends, the next one in the queue starts automatically. When the queue is empty, the room is idle.
- **Nobody listening:** when the last listener leaves, the room pauses at the current position. When someone opens it again, it resumes from there, unless it was already paused with ⏸ before everyone left, in which case it stays paused. After 24 hours with nobody in the room, the queue is cleared. *(Decided by the user.)*

## Non-goals

- No downloading or re-hosting audio (no ytdl, no file storage). Playback is YouTube's own embedded player (IFrame Player API) on each phone.
- No YouTube search inside the app (it would need a YouTube Data API key). Users paste links.
- No Postgres or other external database. The room's state lives in the Durable Object's built-in SQLite storage.
- No play history or stats across groups (a possible later addition, maybe in the user's Postgres).
- The Confluence version doesn't get a music room.
- No chat inside the music room.

## Anti-goals (would count as failure even if it works)

- Spamming the group: the bot must not post every song change in the group (see Group messages below).
- Breaking or blocking party games: a music room and a party must be able to run in the same group at the same time.
- Songs silently failing: a link that can't play must be rejected when it's added, with a clear reason.

## Constraints

- Runs on the existing Cloudflare Worker (`telegram/`), on the free plan. The page is served from GitHub Pages (`site/`, built by `build.mjs`).
- Each person opens the room from a Telegram game button. Links are signed by the Worker (`telegram/token.js`, `sign`/`verify`) like party links.
- **Main use is on computers** (decided by the user): Telegram Desktop opens the room in the normal browser, where music keeps playing in a background tab, with the window minimised and with the screen locked. The screen must be designed desktop-first and still work on a phone.
- Phones: browsers need one user tap before audio plays. On phones, YouTube's embedded player stops when the screen locks or Telegram is in the background. This can't be worked around with approach A, and it's accepted. When a phone comes back to the room, it must jump straight to the shared position.
- Sync is "good enough for background music": within about a second between phones.
- Some videos can't be embedded (often official label/VEVO music videos). These must be rejected when they're added.

## Approaches considered

1. **YouTube embedded player, room sends "play video X from second N" (chosen).** Nothing stored or downloaded, runs on the existing Cloudflare setup. Trade-off: videos that block embedding can't be played; the room rejects them up front.
2. **Download audio with ytdl and stream it from our own server.** Plays any video as audio only. Rejected: it can't run on Cloudflare Workers (needs an always-on server), YouTube regularly blocks it, and downloading and redistributing music breaks YouTube's terms and copyright. That's a real risk for a company team.

Database: the Durable Object's built-in SQLite storage (already used by `PartyRoom`) instead of SQLite elsewhere or the user's hosted Postgres. The queue is small and per-group, and keeping it in the room avoids a new service.

## How it works

### Server: a new `MusicRoom` Durable Object

- New class `MusicRoom` in `telegram/music-room.js`, one per group (`idFromName(chatId)`), separate from `PartyRoom` so music and a party can run at once.
- Register it in `telegram/wrangler.toml` as a new binding (`MUSIC`) with a new migration tag `v2`, `new_sqlite_classes = ["MusicRoom"]`, and export it from `telegram/worker.js`.
- Pure rules (queue, skip votes, position math) go in `src/music/rules.js` so they can be unit-tested like `src/party/rules.js`. The Durable Object only does I/O.
- State kept in storage (`ctx.storage`, key/value, like `PartyRoom`):
  - `queue`: list of `{ id, videoId, title, seconds, addedBy: {key, name} }` (id is a short random string per entry).
  - `now`: the playing entry plus `startedAt` (server ms when position 0 would have been) or, when paused, `pausedAt` (the position in seconds where it paused).
  - `votes`: set of listener keys who voted to skip the current song.
- Listeners are the open WebSocket connections (hibernation API, like `PartyRoom`). Listener count for skip votes = distinct user keys connected right now. When someone disconnects, their vote is dropped and the threshold is re-checked.
- Song end: the room sets an alarm for when the current song should end (`startedAt + seconds*1000`, plus a small grace of about 2 s). On the alarm, it advances to the next entry. A pause clears the alarm, and resume sets it again.
- Clients may also send `ended` when their player reports the end. The server ignores it unless the server's own clock agrees the song is within a few seconds of its end (so one client can't skip early).

### Adding a song

- The client sends `{ type: 'add', url }`. The server pulls the 11-character video ID out of `youtube.com/watch?v=`, `youtu.be/`, `youtube.com/shorts/`, `music.youtube.com/watch?v=` and `m.youtube.com` links. Anything else is rejected with "That doesn't look like a YouTube link."
- The server calls YouTube's public oEmbed endpoint (`https://www.youtube.com/oembed?url=…&format=json`, no key needed) to get the title. A 401/403/404 means the video is private, deleted or blocks embedding, so it's rejected with "This video can't be played outside YouTube. Try a lyric or audio version."
- If oEmbed itself is unreachable or rate-limited (429/5xx/network error), accept the link with the title "YouTube video" rather than rejecting it. *(Builder's call, settled in review.)*
- oEmbed doesn't catch every unplayable video: many label/VEVO, region-blocked, age-restricted and live videos pass oEmbed but fail in the embedded player. The client therefore reports player errors as `{ type: 'unplayable', entryId, code }`. On the first report of error 100, 101 or 150 for the playing song, the server skips it for everyone and tells everyone "Skipped <title>: it can't be played outside YouTube." Trusting one phone is accepted: the team is in one group, mostly in one country. *(Builder's call, settled in review.)*
- Length: oEmbed doesn't give the duration. The first client whose player loads the video reports `{ type: 'duration', entryId, seconds }`. The server accepts the first sane value (1 s – 3 h) and sets the end alarm then. Later reports may only make the length longer, never shorter, so one phone can't cut a song short. *(Builder's call, settled in review.)* Until a duration is known, the server doesn't advance on its own; it relies on a validated `ended` from a client, falling back to a 15-minute cap.
- Limits: at most 50 songs in the queue, at most 5 queued songs per person, and songs longer than 15 minutes are skipped when their duration becomes known (with a notice). These numbers live at the top of `src/music/rules.js`.

### Client: the music screen

- `src/telegram-main.js` opens a new `createMusicApp` (`src/music/music-app.js`) when the link has `#…&music=1`, the same way `party=1` opens the party screen. "Back to arcade" returns to the hub.
- Screen, top to bottom: the YouTube player (16:9, full width) with title, position/length and "added by"; buttons ⏸/▶, ⏭ (skip, or "vote to skip 1/2" for others); "Up next" list with ✕ on your own songs; a paste box and **Add** button.

```
┌─────────────────────────────┐
│ [ YouTube video ]           │
│ Song A          1:42 / 3:30 │
│ added by Dara     ⏸   ⏭ 1/2 │
├─────────────────────────────┤
│ Up next                     │
│ 1. Song B — Sokha           │
│ 2. Song C — you          ✕  │
├─────────────────────────────┤
│ [ paste YouTube link ] [Add]│
│ 3 listening: Dara, Sokha, … │
└─────────────────────────────┘
```

- First open shows a big **🎧 Tap to listen** overlay (needed for audio to start on phones). After the tap, the player loads the current song at the right position.
- Sync: the client uses the same ping/pong clock offset as `party-app.js`. Target position = `(serverNow - startedAt) / 1000`. Every few seconds, if the player is more than about 1.5 s away from the target, it seeks. When paused, everyone seeks to `pausedAt` and pauses.
- Background tabs: browsers slow timers in hidden tabs to about once a minute. Song changes must therefore be driven by the server's WebSocket messages and the player's own events, not by client timers. The periodic drift check may run slowly while hidden, and should run immediately when the tab becomes visible again (`visibilitychange`).
- If someone pauses the player with YouTube's own controls, that only affects their phone. The shared ⏸ button is the one that pauses everyone. (The embedded player is loaded with `controls=0` to avoid confusion; the builder may choose otherwise.)
- Reconnect logic follows `party-app.js` (backoff, "Reconnecting…").

### Worker and bot

- `/music` command (groups only; in a private chat: "Music rooms are for groups…"). It posts the existing arcade game card (same `GAME_SHORT_NAME`, so the Team Arcade title and picture, no new BotFather setup; *decided by the user*) with a **🎵 Open music room** button and adds it to the commands list and `/help`.
- The music card is told apart from party and arcade cards by storing the card's `messageId` in the `MusicRoom` (as `PartyRoom` does with `/set-message` and `/lookup`). When the button is tapped on that card, the signed link gets `m: 1` in its claims, and the URL hash gets `&music=1`.
- New route `GET /music/ws?t=…` in `telegram/app.js`. It verifies the token (`m` claim required) and forwards to the group's `MusicRoom` with `X-Arcade-User`.
- Sending `/music` again posts a fresh card; old cards keep working (the room accepts any of the last few card message IDs, or simply any valid `m` link for that group, whichever is simpler).

### Group messages

- Off by default: no group message per song.
- A setting `MUSIC_ANNOUNCE = "off" | "now-playing"` in `telegram/wrangler.toml`. When it's `now-playing`, the bot posts "🎵 Now playing: <title> (added by Dara)" when a song starts.

## Testing

- Unit tests for `src/music/rules.js`: link parsing (all link shapes, junk), queue limits, remove permissions, skip-vote threshold incl. listeners leaving, position math with pause/resume.
- `MusicRoom` tests in the style of `test/party-room.test.js` (fake storage, fake WebSockets, fake fetch for oEmbed): add → broadcast, rejected link, alarm advances queue, adder skip, vote skip.
- Manual check with `npx wrangler dev` and two browsers.

## README

Add a "🎵 Music room" section under the Telegram version: what it does, the commands, the skip rules, that it plays YouTube's own player (so some official videos won't work), and that music stops when the phone screen locks.

## Left to the builder

- Exact wire message shapes and names.
- Styling, reusing `src/ui/arcade.css` tokens.
- How the music card's message ID is matched (latest-card list vs. any `m` link for the group).
- Whether to show YouTube's controls on the embedded player.

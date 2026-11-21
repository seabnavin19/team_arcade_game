# Team Arcade

Five quick break-time games with weekly leaderboards and an overall Champion ranking.
The same games run in two places:

- **Telegram:** in your team group. Tap **Play**, and scores are saved as JSON files in this repo.
- **Confluence:** on a self-hosted Confluence page. Scores are saved on the page itself.

| Game | How it plays | Ranked by |
|---|---|---|
| 🚀 **Drone Shooter** | Six waves of drones, then a boss. Move with the mouse, arrow keys/WASD, or drag on a touch screen; you fire automatically. Power-ups: **S** spread shot, **R** rapid fire, **◯** shield. Quick kills build a multiplier up to x5. | Points (higher is better). Beating the boss adds 5,000, plus 1,000 per life left. |
| ⚡ **Reaction Tap** | Hit shrinking targets for 30 seconds; red targets cost points. | Points (higher is better) |
| 🧠 **Memory Match** | Find 8 pairs on a 4×4 grid. | Time + 2 s for every move beyond 8 (lower is better) |
| ⌨️ **Typing Race** | Type the passage of the day for 60 seconds (needs a keyboard). | Net words per minute; runs under 90% accuracy aren't ranked |
| 💡 **Brain Race** | 8 IQ puzzles (patterns, maths, missing numbers, largest value, time, odd one out), 10 s each, one try. Tap or press 1–4. | Points: 500 + up to 500 for speed per right answer (higher is better) |

Everyone gets the same waves, targets, cards, passage and puzzles on the same day, and they change daily.
Boards reset every Monday at 00:00 Cambodia time (UTC+7).

---

## Telegram version

### How it works

```
Telegram group ──/arcade, Play──▶ Cloudflare Worker (telegram/worker.js)
     ▲                              │  signs a link for that player + group
     │ "👑 Dara is now #1…"         ▼
     │                         GitHub Pages (the games, from site/)
     │                              │  finished run → Worker
     └──────────────────────── Worker saves JSON to the `scores` branch of this repo
```

- **The games** are served by GitHub Pages at `https://seabnavin19.github.io/team_arcade_game/`.
- **Scores** are JSON files on the **`scores`** branch, one per group per week, for example `data/-1001234567890/2026-W47.json`.
  They're kept on a separate branch so score commits never rebuild the website.
- **The Worker** is the only part holding the bot token and the GitHub token. It checks each run (who played, how long it took, whether the score is possible) before saving.
- **Group messages:** the bot posts when someone takes #1 or enters the top 3 of a game, and every Monday at 08:30 it posts last week's results.

**Bot commands:** `/arcade` posts the game with a Play button, `/party` starts a live party round (below), `/music` opens the music room (below), `/board` shows this week's leaderboards, `/lastweek` shows last week's results, and `/help` explains the bot.
**Bot commands:** `/arcade` posts the game with a Play button, `/party` starts a live party round (below), `/duo` starts a game for two (Duo Mode, below), `/board` shows this week's leaderboards, `/lastweek` shows last week's results, and `/help` explains the bot.

### 🎉 Live party (multiplayer)

Send **`/party`** in the group and pick a game from the buttons, or go straight to one with **`/party draw`**, **`/party battle`**, **`/party snake`**, **`/party iq`** or **`/party reaction`**.
The bot posts a card with a **Join the party** button and a 60-second countdown. A party needs at least 2 players, and one party runs per group at a time.
As soon as 2 players are in, anyone in the lobby can tap **▶ Start now**. Everyone then gets a 3-second countdown instead of waiting out the full minute.

**🚀 Ship Battle** (90 seconds, 2–8 players)
- Everyone flies a ship in one arena with cover blocks. Your ship **fires forward on its own**, so you aim by steering.
- 3 hits knock a ship out (KO). It respawns 2 seconds later with a short spawn shield.
- Pickups appear every 12 seconds: **+** refills your shields, **R** gives 6 seconds of rapid fire.
- **Most KOs wins.** Ties go to whoever was knocked out fewer times.
- Controls: mouse (the ship flies toward the cursor), arrow keys / WASD, or drag anywhere on a phone.

**🎨 Draw & Guess** (3 rounds of 50 seconds; 2–12 players)
- Players take turns as the artist, in a random order. With 2 players that's A, B, then A again; with more than 3 players, three different people draw. Only the artist sees the secret word (cat, coffee, tuk tuk…) and draws it, and everyone sees the drawing appear live.
- Everyone else types guesses. Wrong guesses show in the chat for laughs. Near misses ("elefant") show only to the person who typed them, as "very close!".
  Halfway through, one letter is revealed as a hint.
- A right guess scores 100 plus up to 200 for speed, plus 50 for the first correct guess. The artist gets +60 for every player who guesses it.
  The round ends early once everyone has it.
- Artist tools: 9 colours, an eraser, 3 brush sizes, Undo and Clear. Works with a mouse or a finger.
- Words are picked on the server from a secret only the server knows, so nobody can look them up. Edit the list in `src/party/draw.js`.

**🐍 Snake Arena** (90 seconds, 2–8 players)
- Everyone's snake moves in one grid arena, 8 steps a second.
- Eat food to grow: **+1**, and golden food gives **+3**. If another snake crashes into **your** body, you get **+5**.
- Hitting a wall, yourself or another snake knocks you out. Your body turns into food for everyone else, and you respawn small 2 seconds later.
  If two heads meet, both are out and nobody scores. **Most points wins.**
- Controls: arrow keys / WASD; on a phone, swipe on the board or use the on-screen arrows.

**💡 Brain Race** (8 puzzles, about 1¾ minutes, any number)
- IQ-style puzzles: number patterns, quick maths, missing numbers, "which is largest" (fractions, decimals, %), time puzzles and odd-one-out.
- Everyone gets the same puzzle at the same moment and has 10 seconds. **One try per puzzle.**
- A right answer scores 500 plus up to 500 for speed, plus a 200 bonus for the **first** correct answer. A wrong answer scores 0.
- After each puzzle the answer is revealed, along with who got it first. Puzzles are generated fresh for every party, so they never repeat.
  The server keeps the answers to itself until the reveal, so nobody can peek.
- Controls: tap an answer, or press 1–4.

**⚡ Reaction Tap** (30 seconds, any number)
- Everyone gets the same targets at the same moment. **The first tap on a target takes its points**, and quicker taps score more.
- Red targets are traps and only cost the person who taps them. Tapping a target someone just took shows "too slow!" with no penalty.

A live scoreboard runs under the game. At the end, the bot posts the results and the winner in the group.
Party scores are just for fun. They don't count toward the weekly leaderboards.

Each group's party runs in its own live room on Cloudflare (a Durable Object, included in the free plan).
The room is the referee. In Ship Battle it runs the arena 20 times a second and decides every hit, and in Snake Arena it moves every snake and decides every crash. In Reaction Tap it checks every tap against its own clock.

### 🎵 Music room (listen together)

Send **`/music`** in the group and tap **🎵 Open music room**. Everyone in the room hears the same YouTube song at the same moment, and people who join late start mid-song.

- **Add a song:** paste a YouTube link (`youtube.com/watch?v=…`, `youtu.be/…`, Shorts or YouTube Music) and tap **Add**. The queue shows each song's title and who added it.
- **Pause / Play** applies to everyone.
- **Skip:** whoever added the playing song can skip it straight away. Everyone else taps **Vote to skip**, and the song is skipped once half of the people listening have voted (rounded up).
- **Remove:** tap ✕ next to a song you added to take it out of the queue.
- When everyone leaves, the music pauses and carries on from the same spot when someone opens the room again. After 24 hours with nobody in the room, the queue is cleared.
- Limits: 50 songs in the queue, 5 waiting songs per person, songs up to 15 minutes.

Things to know:
- It plays YouTube's own player, so nothing is downloaded or stored. Some official music videos (often record-label / VEVO uploads) block playing outside YouTube. The room turns those down when you add them, or skips them with a notice if they fail to play. A lyric or audio upload of the same song usually works.
- **Built for computers.** Telegram Desktop opens the room in your browser, where the music keeps playing in a background tab or a minimised window. On phones, music stops when the screen locks or you leave Telegram, and jumps back to the right spot when you return.
- Your browser needs one click (**🎧 Tap to listen**) before it's allowed to play sound.
- The bot doesn't post anything in the group when songs change. To post "🎵 Now playing…" for each song, set `MUSIC_ANNOUNCE = "now-playing"` in `telegram/wrangler.toml`.

Each group's music room is its own Durable Object, separate from parties, so music and a party can run at the same time.
### 💞 Duo Mode (2 players, one team)

Send **`/duo`** in the group and pick a game, or go straight to one with **`/duo sync`** or **`/duo market`**.
The bot posts a card with a **Join the duo** button. The first 2 people to tap it play together as one team and **share one score**: you win or lose together.
Once both are in, either of you can tap **▶ Start now**. If only one person joins within 60 seconds, the game is cancelled.
Duo Mode has its own room in each group, so a duo can play while a group party is on (one duo per group at a time).

**💞 In Sync** (8 rounds, about 1–2 minutes)
- Each round is a light question about one of you, and it alternates: food, travel, habits, "usually late because…".
  The player it's about picks their real answer; the partner guesses what they picked. Neither sees the other's pick until the reveal.
- A match scores 200 plus up to 100 for a quick guess. **3 or more matches in a row double the points.**
- A round is revealed as soon as you've both picked (12 seconds at most). The game ends with your Sync %.
- Questions are picked on the server for every game. Edit the list at the top of `src/party/sync.js`.

**🍜 Night Market Duo** (90 seconds)
- You run a noodle stall together. The **cook** taps a dish (🍜 noodle soup, 🍢 skewers, 🍚 fried rice, or keys 1–3) to put it on one of 3 burners, then taps it when it's ready to move it to the counter. Leave it too long and it burns.
- The **server** taps a customer to hand them the dish they ordered (or taps a dish on the counter first, then the customer). Customers walk out when their patience bar runs out.
- Tips are bigger for quick service, and every 3 customers served in a row raise the tip multiplier (up to x3). A wrong dish or a customer walking out resets it.
- **Roles swap at half time**, and the last 25 seconds are rush hour.
- The room runs the stall 10 times a second, so both phones always see the same stall.

At the end the bot posts the duo's result and **this week's top duos** for that game. Send **`/duo board`** to see the week's best duos at any time.
Duo scores live in the group's duo room, not on the `scores` branch, and like party scores they don't count toward the weekly leaderboards.

> **Privacy:** this repository is public, so the `scores` branch can be read by anyone. It shows players' first names, last initials and scores.
> To keep it private, make the repository private. GitHub Pages on a private repository needs a paid GitHub plan.

### One-time setup (about 20 minutes)

**1. Create the bot and the game in Telegram** (talk to [@BotFather](https://t.me/BotFather))
- `/newbot`: give it a name (e.g. *Team Arcade*) and a username ending in `bot`. Copy the **bot token**.
- `/newgame`: pick your bot, then give it a title (*Team Arcade*) and a short description.
  Upload `web/cover.png` from this repo as the photo, send `/empty` to skip the GIF,
  and use the short name **`arcade`**. It must match `GAME_SHORT_NAME` in `telegram/wrangler.toml`.

**2. Create a GitHub token for saving scores**
GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token.
- Repository access: **Only select repositories** → `team_arcade_game`
- Permissions: **Contents → Read and write**
- Copy the token.

**3. Get Cloudflare ready** (free plan)
- Sign up at [dash.cloudflare.com](https://dash.cloudflare.com). Open **Workers & Pages** once so Cloudflare gives you a `*.workers.dev` subdomain.
- Copy your **Account ID** (shown on the Workers & Pages overview page).
- My Profile → API Tokens → Create Token → template **Edit Cloudflare Workers** → Create. Copy the **API token**.

**4. Add the secrets to this repo**
GitHub repo → Settings → Secrets and variables → **Actions** → New repository secret:

| Secret | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | the Cloudflare API token from step 3 |
| `CLOUDFLARE_ACCOUNT_ID` | your Cloudflare Account ID |
| `BOT_TOKEN` | the bot token from step 1 |
| `DATA_TOKEN` | the GitHub token from step 2 |
| `ARCADE_SECRET` | any long random text (32+ characters). Make one with `openssl rand -hex 32` or a password manager |

**5. Turn on GitHub Pages:** repo → Settings → Pages → Source: **GitHub Actions**.

**6. Deploy:** repo → Actions → **Test and deploy** → **Run workflow**. This:
- tests and builds the games, and publishes them to GitHub Pages
- deploys the Worker to Cloudflare
- connects the bot to it (sets the webhook and commands, and creates the `scores` branch)

If the last step says it was skipped, open this address once in a browser:
`https://team-arcade.<your-subdomain>.workers.dev/setup?key=<ARCADE_SECRET>`. You should see `"ok": true`.

**7. Play:** add the bot to your team group, send **`/arcade`**, and tap **Play**.

### Changing things

| To change | Edit |
|---|---|
| Group announcements (`top3`, `first` or `off`) | `ANNOUNCE` in `telegram/wrangler.toml` |
| Party lobby length, minimum players, game lengths | `src/party/rules.js` |
| Brain Race: number of puzzles, time per puzzle, puzzle types | top of `src/party/quiz.js` |
| Ship Battle balance (speed, fire rate, shields, pickups) | top of `src/party/battle.js` |
| Snake Arena (speed, board size, points, respawn) | top of `src/party/snake.js` |
| In Sync: questions, rounds, time per round, points | top of `src/party/sync.js` |
| Night Market Duo: dishes, cook times, burners, customers, tips | top of `src/party/market.js` |
| Time of the Monday results post | `crons` in `telegram/wrangler.toml` (UTC) |
| Game rules or balance | `src/games/…`. Drone Shooter's rules are in `shooter-engine.js` |
| Server-side score limits | `src/games/meta.js` |
| Music room limits (queue size, songs per person, longest song, idle time) | top of `src/music/rules.js` |
| "Now playing" messages in the group (`now-playing` or `off`) | `MUSIC_ANNOUNCE` in `telegram/wrangler.toml` |

Every push to `main` re-tests and re-deploys both the games and the Worker.

---

## Confluence version

Download `arcade.js` and `loader-snippet.html` from `https://seabnavin19.github.io/team_arcade_game/confluence/`, or run `npm run build` and use the copies in `dist/`.

1. Check that the **HTML macro** is on: edit a page and type `/html`. If it doesn't appear, ask a Confluence admin to enable it
   (Administration → Manage apps → System apps → *Confluence HTML Macros*).
2. Create a page called "Team Arcade" in a space where all players have **edit** permission. Only people who can edit the page are ranked.
3. Attach `arcade.js` to the page.
4. Edit the page, insert the HTML macro, and paste in the contents of `loader-snippet.html`. Then publish.
5. Play a round and check your name shows. Ask a teammate to do the same.

Scores are stored as hidden content properties on the page, for example `team-arcade.2026-W47.reaction`. Saving a score doesn't create page versions.
To update the games, upload a new `arcade.js` with the same name. Players get it within an hour, or straight away with Ctrl+Shift+R.

---

## Development

```bash
npm install
npm test                       # 169 automated tests: game rules, saving and conflicts, ranking, the Telegram server, live parties, the music room
npm test                       # 133 automated tests: game rules, saving and conflicts, ranking, the Telegram server, live parties, Duo Mode
npm run build                  # dist/ (Confluence) and site/ (Telegram / GitHub Pages)

node dev/local-telegram.mjs    # Telegram version with a pretend Telegram + GitHub → http://localhost:8787/play?name=Dara
cd telegram && npx wrangler dev # the real Worker locally, with live party rooms (put secrets in telegram/.dev.vars)
python3 -m http.server 8765    # Confluence version on a pretend Confluence → http://localhost:8765/dev/harness.html?user=dara
node dev/duo-demo.mjs          # Duo Mode with a bot partner → open dist/duo-demo.html?game=sync (or ?game=market)
```

```
src/core/       shared: seeded randomness, weeks, ranking, saving, input, sound
src/games/      the four games (+ meta.js: names, formats and score limits shared with the server)
src/ui/         the arcade hub and styles
src/main.js            Confluence entry      src/telegram-main.js   Telegram entry
src/party/      live party rules and screen
src/music/      music room rules and screen
telegram/       Cloudflare Worker: bot, signed links, GitHub JSON storage, Monday results, party rooms, music rooms
src/party/      live party and Duo Mode rules and screens
telegram/       Cloudflare Worker: bot, signed links, GitHub JSON storage, Monday results, party rooms
web/            GitHub Pages page + game cover image
```

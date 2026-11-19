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

**Bot commands:** `/arcade` posts the game with a Play button, `/party` starts a live party round (below), `/board` shows this week's leaderboards, `/lastweek` shows last week's results, and `/help` explains the bot.

### 🎉 Live party (multiplayer)

Send **`/party`** in the group and pick a game from the buttons, or go straight to one with **`/party battle`**, **`/party iq`** or **`/party reaction`**.
The bot posts a card with a **Join the party** button and a 60-second countdown. A party needs at least 2 players, and one party runs per group at a time.
As soon as 2 players are in, anyone in the lobby can tap **▶ Start now**. Everyone then gets a 3-second countdown instead of waiting out the full minute.

**🚀 Ship Battle** (90 seconds, 2–8 players)
- Everyone flies a ship in one arena with cover blocks. Your ship **fires forward on its own**, so you aim by steering.
- 3 hits knock a ship out (KO). It respawns 2 seconds later with a short spawn shield.
- Pickups appear every 12 seconds: **+** refills your shields, **R** gives 6 seconds of rapid fire.
- **Most KOs wins.** Ties go to whoever was knocked out fewer times.
- Controls: mouse (the ship flies toward the cursor), arrow keys / WASD, or drag anywhere on a phone.

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
The room is the referee. In Ship Battle it runs the arena 20 times a second and decides every hit. In Reaction Tap it checks every tap against its own clock.

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
| Time of the Monday results post | `crons` in `telegram/wrangler.toml` (UTC) |
| Game rules or balance | `src/games/…`. Drone Shooter's rules are in `shooter-engine.js` |
| Server-side score limits | `src/games/meta.js` |

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
npm test                       # 98 automated tests: game rules, saving and conflicts, ranking, the Telegram server, live parties
npm run build                  # dist/ (Confluence) and site/ (Telegram / GitHub Pages)

node dev/local-telegram.mjs    # Telegram version with a pretend Telegram + GitHub → http://localhost:8787/play?name=Dara
cd telegram && npx wrangler dev # the real Worker locally, with live party rooms (put secrets in telegram/.dev.vars)
python3 -m http.server 8765    # Confluence version on a pretend Confluence → http://localhost:8765/dev/harness.html?user=dara
```

```
src/core/       shared: seeded randomness, weeks, ranking, saving, input, sound
src/games/      the four games (+ meta.js: names, formats and score limits shared with the server)
src/ui/         the arcade hub and styles
src/main.js            Confluence entry      src/telegram-main.js   Telegram entry
src/party/      live party rules and screen
telegram/       Cloudflare Worker: bot, signed links, GitHub JSON storage, Monday results, party rooms
web/            GitHub Pages page + game cover image
```

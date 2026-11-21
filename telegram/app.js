// Team Arcade Telegram server logic (the Cloudflare entry point is worker.js).
//
//  POST /telegram   Telegram webhook: /arcade, /board, /lastweek, /help, and the Play button
//  POST /run        a game is starting → signed run ticket (used to check run length)
//  POST /score      save a finished run as JSON in GitHub, announce new top places
//  GET  /board      this week's and last week's boards for the player's group
//  GET  /party/ws   live party connection (WebSocket), handled by the group's PartyRoom
//  GET  /music/ws   music room connection (WebSocket), handled by the group's MusicRoom
//  GET  /setup      one-time setup: webhook, commands, scores branch (needs ARCADE_SECRET)
//  cron             Monday morning: post last week's results in every group

import { deriveKeys, sign, verify } from './token.js';
import { createGithub } from './github.js';
import { weekKey, previousWeekKey, weekLabel } from '../src/core/time.js';
import { mergeEntry, emptyBoard } from '../src/core/store.js';
import { rankBoard, championBoard } from '../src/core/ranking.js';
import { GAME_META, GAME_IDS, checkRun } from '../src/games/meta.js';
import { JOIN_SECONDS, MIN_PLAYERS, PARTY_GAMES } from '../src/party/rules.js';

const SESSION_HOURS = 12;
const RUN_MINUTES = 45;
const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

export const weekPath = (chat, week) => `data/${String(chat).replace(/[^\w-]/g, '_')}/${week}.json`;
export const CHATS_PATH = 'data/chats.json';

export function displayName(from) {
  const name = [from.first_name, from.last_name ? `${from.last_name[0]}.` : ''].filter(Boolean).join(' ').trim();
  return (name || from.username || `Player ${String(from.id).slice(-4)}`).slice(0, 40);
}

function cleanMeta(meta) {
  if (!meta || typeof meta !== 'object') return undefined;
  const out = {};
  for (const [k, v] of Object.entries(meta).slice(0, 8)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k.slice(0, 20)] = Math.round(v * 10) / 10;
    else if (typeof v === 'boolean') out[k.slice(0, 20)] = v;
  }
  return out;
}

const emptyWeek = (chat, week) => ({ chat, week, games: Object.fromEntries(GAME_IDS.map(g => [g, emptyBoard(g, week)])) });
const rankedOf = wk => Object.fromEntries(GAME_IDS.map(g => [g, rankBoard(wk?.games?.[g], GAME_META[g].better)]));

export function boardText(wk, week, { title } = {}) {
  const ranked = rankedOf(wk);
  const champ = championBoard(ranked);
  const lines = [`<b>🕹️ ${esc(title || `Team Arcade · ${weekLabel(week)}`)}</b>`, ''];
  if (!champ.length) {
    lines.push('No scores yet. Send /arcade and tap <b>Play</b> to be the first!');
    return lines.join('\n');
  }
  lines.push('🏆 <b>Champion</b>');
  const medal = p => ['🥇', '🥈', '🥉'][p - 1] || `${p}.`;
  champ.slice(0, 5).forEach(r => lines.push(`${medal(r.place)} ${esc(r.name)} · ${r.score} pts`));
  for (const g of GAME_IDS) {
    const m = GAME_META[g];
    const rows = ranked[g].slice(0, 3);
    lines.push('', `${m.emoji} <b>${esc(m.title)}</b>`);
    lines.push(rows.length ? rows.map(r => `${medal(r.place)} ${esc(r.name)} ${esc(m.format(r.score))}`).join('   ') : '<i>no scores yet</i>');
  }
  return lines.join('\n');
}

export function announcement(game, name, before, after, mode = 'top3') {
  if (mode === 'off' || !after) return null;
  const m = GAME_META[game];
  const score = esc(m.format(after.score));
  if (after.place === 1 && (!before || before.place !== 1)) return `👑 <b>${esc(name)}</b> is now #1 in ${m.emoji} ${esc(m.title)} with ${score}!`;
  if (mode === 'top3' && after.place <= 3 && (!before || before.place > 3)) return `🔥 <b>${esc(name)}</b> moved into #${after.place} in ${m.emoji} ${esc(m.title)} with ${score}.`;
  return null;
}

export function createHandler({ fetch: fetchImpl = (...a) => fetch(...a), now = () => Date.now() } = {}) {
  async function context(env) {
    const keys = await deriveKeys(env.ARCADE_SECRET);
    const gh = createGithub({ fetch: fetchImpl, token: env.DATA_TOKEN, repo: env.GITHUB_REPO, branch: env.DATA_BRANCH || 'scores' });
    const tg = async (method, body) => {
      let data = {};
      try {
        const res = await fetchImpl(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        data = await res.json().catch(() => ({}));
      } catch (e) { data = { ok: false, description: e.message }; }
      if (!data.ok) console.log(`Telegram ${method} failed`, JSON.stringify(data).slice(0, 300));
      return data;
    };
    return { env, keys, gh, tg };
  }

  const room = (env, chatId) => env.PARTY.get(env.PARTY.idFromName(String(chatId)));
  const roomCall = async (env, chatId, path, body) => {
    const res = await room(env, chatId).fetch(`https://party${path}`, body ? { method: 'POST', body: JSON.stringify(body) } : undefined);
    return res.json();
  };

  const musicCall = async (env, chatId, path, body) => {
    const res = await env.MUSIC.get(env.MUSIC.idFromName(String(chatId))).fetch(`https://music${path}`, body ? { method: 'POST', body: JSON.stringify(body) } : undefined);
    return res.json();
  };

  /** Open a party lobby in a group. Returns false if one is already running. */
  async function startParty(c, chat, game, threadId, { pickedBy, pickerMessageId } = {}) {
    const g = PARTY_GAMES[game];
    const thread = threadId ? { message_thread_id: threadId } : {};
    const made = await roomCall(c.env, chat.id, '/create', { chat: chat.id, game, joinSeconds: Number(c.env.PARTY_JOIN_SECONDS) || undefined });
    if (!made.created) {
      const cur = PARTY_GAMES[made.party?.game] || g;
      await c.tg('sendMessage', { chat_id: chat.id, parse_mode: 'HTML', text: `${cur.emoji} A <b>${cur.title}</b> party is already on. Tap <b>Join the party</b> on its card.`, ...thread });
      return false;
    }
    if (pickerMessageId) {
      await c.tg('editMessageText', { chat_id: chat.id, message_id: pickerMessageId, parse_mode: 'HTML', text: `🎉 <b>${esc(pickedBy)}</b> picked <b>${g.emoji} ${g.title}</b>` });
    }
    const card = await c.tg('sendGame', {
      chat_id: chat.id, game_short_name: c.env.GAME_SHORT_NAME, ...thread,
      reply_markup: { inline_keyboard: [[{ text: `${g.emoji} Join the party`, callback_game: {} }]] },
    });
    if (card.ok) await roomCall(c.env, chat.id, '/set-message', { messageId: card.result.message_id });
    const secs = Math.round((made.party.startAt - now()) / 1000);
    await c.tg('sendMessage', {
      chat_id: chat.id, parse_mode: 'HTML', ...thread,
      text: [`${g.emoji} <b>${g.title} Party!</b> Starts in ${secs} seconds and lasts ${g.seconds} seconds.`, `Tap <b>Join the party</b> on the card above. ${g.pitch}`, `Needs at least ${MIN_PLAYERS} players${g.maxPlayers < 50 ? `, up to ${g.maxPlayers}` : ''}. Once ${MIN_PLAYERS} are in, anyone in the lobby can tap <b>Start now</b>.`].join('\n'),
    });
    return true;
  }

  let cachedUsername = null;
  async function botUsername(c) {
    if (!cachedUsername) { const me = await c.tg('getMe', {}); cachedUsername = me.ok ? me.result.username : ''; }
    return cachedUsername;
  }

  async function rememberChat(c, chat) {
    if (!chat || chat.type === 'private') return;
    await c.gh.update(CHATS_PATH, data => {
      const d = data || { chats: {} };
      if (d.chats[chat.id]) return undefined;
      d.chats[chat.id] = { title: chat.title || '', added: new Date(now()).toISOString() };
      return d;
    }, `Team Arcade: add chat ${chat.title || chat.id}`);
  }

  async function readWeek(c, chat, week) {
    const { data } = await c.gh.getJson(weekPath(chat, week));
    return data || emptyWeek(chat, week);
  }

  // ---------- Telegram updates ----------
  async function onUpdate(c, update, ctx, origin) {
    const cq = update.callback_query;
    if (cq) {
      if (cq.data?.startsWith('party:') && cq.message?.chat) {
        const game = cq.data.slice(6);
        if (!PARTY_GAMES[game] || !c.env.PARTY) return c.tg('answerCallbackQuery', { callback_query_id: cq.id });
        const started = await startParty(c, cq.message.chat, game, cq.message.message_thread_id, { pickedBy: displayName(cq.from), pickerMessageId: cq.message.message_id });
        return c.tg('answerCallbackQuery', { callback_query_id: cq.id, text: started ? `${PARTY_GAMES[game].title} party on!` : 'A party is already on' });
      }
      if (!cq.game_short_name) return c.tg('answerCallbackQuery', { callback_query_id: cq.id });
      const chat = cq.message?.chat;
      const claims = { typ: 's', u: cq.from.id, n: displayName(cq.from), c: chat ? chat.id : 'inline', iat: now(), exp: now() + SESSION_HOURS * 3600e3 };
      // Tapped "Join the party" on a live party card?
      if (chat && c.env.PARTY) {
        const { party } = await roomCall(c.env, chat.id, `/lookup?messageId=${cq.message.message_id}`).catch(() => ({}));
        if (party) claims.p = party.id;
      }
      // …or "Open music room" on a music card?
      if (chat && !claims.p && c.env.MUSIC) {
        const { card } = await musicCall(c.env, chat.id, `/is-card?messageId=${cq.message.message_id}`).catch(() => ({}));
        if (card) claims.m = 1;
      }
      const t = await sign(c.keys.tokenKey, claims);
      // v= changes every minute so the phone fetches a fresh page (which loads the newest game) instead of a cached one
      const url = `${c.env.GAME_URL}?api=${encodeURIComponent(origin)}&v=${Math.floor(now() / 60000)}#t=${t}${claims.p ? '&party=1' : ''}${claims.m ? '&music=1' : ''}`;
      ctx.waitUntil(rememberChat(c, chat).catch(e => console.log('rememberChat', e.message)));
      return c.tg('answerCallbackQuery', { callback_query_id: cq.id, url });
    }

    const msg = update.message;
    if (!msg?.text) return null;
    const m = msg.text.match(/^\/(\w+)(?:@(\w+))?/);
    if (!m) return null;
    const [, cmd, botName] = m;
    if (botName && botName.toLowerCase() !== (await botUsername(c)).toLowerCase()) return null; // meant for another bot
    const reply = (text, extra = {}) => c.tg('sendMessage', {
      chat_id: msg.chat.id, text, parse_mode: 'HTML', disable_web_page_preview: true,
      ...(msg.message_thread_id ? { message_thread_id: msg.message_thread_id } : {}), ...extra,
    });

    switch (cmd.toLowerCase()) {
      case 'arcade':
      case 'play':
        ctx.waitUntil(rememberChat(c, msg.chat).catch(e => console.log('rememberChat', e.message)));
        return c.tg('sendGame', { chat_id: msg.chat.id, game_short_name: c.env.GAME_SHORT_NAME, ...(msg.message_thread_id ? { message_thread_id: msg.message_thread_id } : {}) });
      case 'party': {
        if (msg.chat.type === 'private') return reply('Parties are for groups: add me to your team group and send /party there.');
        if (!c.env.PARTY) return reply('Live parties are not switched on for this server yet.');
        const arg = (msg.text.split(/\s+/)[1] || '').toLowerCase();
        const ALIASES = { iq: 'quiz', brain: 'quiz', ship: 'battle', ships: 'battle', tap: 'reaction', snakes: 'snake', guess: 'draw', drawing: 'draw' };
        const pick = ALIASES[arg] || Object.keys(PARTY_GAMES).find(g => g === arg || (arg && PARTY_GAMES[g].title.toLowerCase().startsWith(arg)));
        if (pick) return startParty(c, msg.chat, pick, msg.message_thread_id);
        return reply('🎉 <b>Pick a party game:</b>', { reply_markup: { inline_keyboard: Object.entries(PARTY_GAMES).map(([id, g]) => [{ text: `${g.emoji} ${g.title}`, callback_data: `party:${id}` }]) } });
      }
      case 'music': {
        if (msg.chat.type === 'private') return reply('Music rooms are for groups: add me to your team group and send /music there.');
        if (!c.env.MUSIC) return reply('The music room is not switched on for this server yet.');
        const card = await c.tg('sendGame', {
          chat_id: msg.chat.id, game_short_name: c.env.GAME_SHORT_NAME,
          ...(msg.message_thread_id ? { message_thread_id: msg.message_thread_id } : {}),
          reply_markup: { inline_keyboard: [[{ text: '🎵 Open music room', callback_game: {} }]] },
        });
        if (card.ok) await musicCall(c.env, msg.chat.id, '/set-card', { chat: msg.chat.id, messageId: card.result.message_id });
        return card;
      }
      case 'board':
      case 'champion':
      case 'scores': {
        const week = weekKey(new Date(now()));
        return reply(boardText(await readWeek(c, msg.chat.id, week), week));
      }
      case 'lastweek': {
        const week = previousWeekKey(new Date(now()));
        return reply(boardText(await readWeek(c, msg.chat.id, week), week, { title: `Last week · ${weekLabel(week)}` }));
      }
      case 'start':
      case 'help':
        return reply([
          '<b>🕹️ Team Arcade</b>',
          'Four quick games for your break: 🚀 Drone Shooter, ⚡ Reaction Tap, 🧠 Memory Match and ⌨️ Typing Race.',
          '',
          '/arcade: post the game, then tap <b>Play</b>',
          '/party: live multiplayer round: ⚡ Reaction Tap, 💡 Brain Race, 🎨 Draw & Guess, 🐍 Snake Arena or 🚀 Ship Battle',
          '/music: open the music room and listen to YouTube songs together',
          '/board: this week\'s leaderboards and champion',
          '/lastweek: last week\'s results',
          '',
          'Your best score each week counts. Boards reset every Monday (Cambodia time).',
          msg.chat.type === 'private' ? '\nAdd me to your team group and send /arcade there so your team shares one leaderboard.' : '',
        ].join('\n'));
      default:
        return null;
    }
  }

  // ---------- game API ----------
  async function session(c, t) {
    const claims = await verify(c.keys.tokenKey, t, now());
    return claims?.typ === 's' ? claims : null;
  }

  async function onRun(c, body) {
    const s = await session(c, body.t);
    if (!s) return json({ reason: 'expired' }, 401);
    if (!GAME_META[body.game]) return json({ reason: 'Unknown game.' }, 400);
    const run = await sign(c.keys.tokenKey, { typ: 'r', u: s.u, c: s.c, g: body.game, s: now(), exp: now() + RUN_MINUTES * 60e3 });
    return json({ run });
  }

  async function onScore(c, body, ctx) {
    const s = await session(c, body.t);
    if (!s) return json({ reason: 'expired' }, 401);
    const run = await verify(c.keys.tokenKey, body.run, now());
    const game = body.game;
    if (!run || run.typ !== 'r' || run.u !== s.u || run.c !== s.c || run.g !== game) {
      return json({ status: 'rejected', reason: 'This run could not be verified, so it was not saved.' });
    }
    const score = typeof body.score === 'number' ? Math.round(body.score * 10) / 10 : NaN;
    const meta = cleanMeta(body.meta);
    const reason = checkRun(game, score, meta, (now() - run.s) / 1000);
    if (reason) return json({ status: 'rejected', reason });

    const week = weekKey(new Date(now()));
    const user = { key: `tg-${s.u}`, name: s.n };
    const better = GAME_META[game].better;
    let before = null;
    let improved = false;
    const result = await c.gh.update(weekPath(s.c, week), data => {
      const wk = data || emptyWeek(s.c, week);
      wk.games ||= {};
      before = rankBoard(wk.games[game], better).find(r => r.key === user.key) || null;
      const merged = mergeEntry(wk.games[game], { game, week, user, score, at: new Date(now()).toISOString(), meta }, better);
      improved = merged.improved;
      if (!improved) return undefined;
      return { ...wk, games: { ...wk.games, [game]: merged.value } };
    }, `Team Arcade: ${s.n} · ${GAME_META[game].title} · ${GAME_META[game].format(score)}`);

    const board = result.data?.games?.[game] || emptyBoard(game, week);
    if (improved && typeof s.c === 'number') {
      const after = rankBoard(board, better).find(r => r.key === user.key);
      const text = announcement(game, s.n, before, after, c.env.ANNOUNCE || 'top3');
      if (text) ctx.waitUntil(c.tg('sendMessage', { chat_id: s.c, text, parse_mode: 'HTML', disable_notification: true }));
    }
    return json({ status: improved ? 'saved' : 'notBest', board, week });
  }

  async function onBoard(c, t) {
    const s = await session(c, t);
    if (!s) return json({ reason: 'expired' }, 401);
    const d = new Date(now());
    const week = weekKey(d), lastWeek = previousWeekKey(d);
    const [cur, last] = await Promise.all([readWeek(c, s.c, week), readWeek(c, s.c, lastWeek)]);
    return json({ week, lastWeek, boards: cur.games, lastBoards: last.games });
  }

  async function onSetup(c, origin) {
    const steps = {};
    steps.scoresBranch = await c.gh.ensureBranch();
    const me = await c.tg('getMe', {});
    steps.bot = me.ok ? `@${me.result.username}` : 'BOT_TOKEN is wrong';
    const hook = await c.tg('setWebhook', {
      url: `${origin}/telegram`, secret_token: c.keys.webhookSecret, allowed_updates: ['message', 'callback_query'], drop_pending_updates: true,
    });
    steps.webhook = hook.ok ? `${origin}/telegram` : hook.description;
    const cmds = await c.tg('setMyCommands', { commands: [
      { command: 'arcade', description: 'Post Team Arcade, then tap Play' },
      { command: 'party', description: 'Live party: Reaction, Brain Race, Draw & Guess, Snake, Ships' },
      { command: 'music', description: 'Listen to music together (YouTube)' },
      { command: 'board', description: "This week's leaderboards" },
      { command: 'lastweek', description: "Last week's results" },
      { command: 'help', description: 'How it works' },
    ] });
    steps.commands = cmds.ok ? 'set' : cmds.description;
    steps.next = 'Add the bot to your team group and send /arcade.';
    return json({ ok: me.ok && hook.ok, ...steps });
  }

  async function weekly(c) {
    const lastWeek = previousWeekKey(new Date(now()));
    const { data } = await c.gh.getJson(CHATS_PATH);
    for (const chatId of Object.keys(data?.chats || {})) {
      const wk = await readWeek(c, chatId, lastWeek);
      const champ = championBoard(rankedOf(wk));
      if (!champ.length) continue;
      const text = `${boardText(wk, lastWeek, { title: `Final results · ${weekLabel(lastWeek)}` })}\n\n🎉 Congratulations <b>${esc(champ[0].name)}</b>, champion of ${weekLabel(lastWeek)}!\nBoards are fresh for the new week. Send /arcade to play.`;
      await c.tg('sendMessage', { chat_id: Number(chatId), text, parse_mode: 'HTML' });
    }
  }

  return {
    async fetch(request, env, ctx) {
      const url = new URL(request.url);
      if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
      let c;
      try { c = await context(env); } catch (e) { return json({ error: `Server not configured: ${e.message}` }, 500); }
      try {
        if (url.pathname === '/telegram' && request.method === 'POST') {
          if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== c.keys.webhookSecret) return new Response('forbidden', { status: 403 });
          await onUpdate(c, await request.json(), ctx, url.origin);
          return new Response('ok');
        }
        if (url.pathname === '/run' && request.method === 'POST') return onRun(c, await request.json());
        if (url.pathname === '/score' && request.method === 'POST') return onScore(c, await request.json(), ctx);
        if (url.pathname === '/board' && request.method === 'GET') return onBoard(c, url.searchParams.get('t'));
        if (url.pathname === '/party/ws' || url.pathname === '/party/state') {
          const s = await session(c, url.searchParams.get('t'));
          if (!s || !env.PARTY || typeof s.c !== 'number') return json({ reason: 'expired' }, 401);
          if (url.pathname === '/party/state') return json(await roomCall(env, s.c, '/state'));
          if (!s.p) return json({ reason: 'not a party link' }, 400);
          const fwd = new Request('https://party/ws', request);
          fwd.headers.set('X-Arcade-User', JSON.stringify({ key: `tg-${s.u}`, name: s.n, partyId: s.p }));
          return room(env, s.c).fetch(fwd);
        }
        if (url.pathname === '/music/ws') {
          const s = await session(c, url.searchParams.get('t'));
          if (!s || !env.MUSIC || typeof s.c !== 'number') return json({ reason: 'expired' }, 401);
          if (!s.m) return json({ reason: 'not a music link' }, 400);
          const fwd = new Request('https://music/ws', request);
          fwd.headers.set('X-Arcade-User', JSON.stringify({ key: `tg-${s.u}`, name: s.n }));
          return env.MUSIC.get(env.MUSIC.idFromName(String(s.c))).fetch(fwd);
        }
        if (url.pathname === '/setup') {
          if (url.searchParams.get('key') !== env.ARCADE_SECRET) return new Response('forbidden', { status: 403 });
          return onSetup(c, url.origin);
        }
        if (url.pathname === '/') return new Response('Team Arcade server is running.', { headers: CORS });
        return new Response('not found', { status: 404, headers: CORS });
      } catch (e) {
        console.log('error', url.pathname, e.stack || e.message);
        if (url.pathname === '/telegram') return new Response('ok'); // don't make Telegram retry forever
        return json({ status: 'failed', reason: 'The arcade server had a problem saving that. Please try again.' }, 500);
      }
    },
    async scheduled(event, env, ctx) {
      const c = await context(env);
      ctx.waitUntil(weekly(c));
    },
  };
}


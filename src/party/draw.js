// Draw & Guess: the rules (server side). Players take turns drawing a secret
// word while everyone else types guesses.
//
// Guesser: 100 + up to 200 for speed, +50 for the first correct guess.
// Artist: +60 for every player who guesses their drawing.

import { createRng } from '../core/rng.js';

export const ROUND_SECONDS = 50;
export const REVEAL_SECONDS = 4;
export const ROUNDS = 3;              // every game is 3 drawing turns
export const HINT_AT = 0.5;            // reveal one letter halfway through
export const ARTIST_POINTS = 60, FIRST_BONUS = 50;
export const MAX_STROKE_POINTS = 25000; // per round, to keep things light

// Simple, drawable words. Add more any time; keep them lowercase.
export const WORDS = [
  'apple', 'banana', 'pizza', 'cake', 'coffee', 'ice cream', 'egg', 'bread', 'cheese', 'carrot', 'mango', 'noodles', 'burger', 'cookie', 'rice',
  'cat', 'dog', 'fish', 'bird', 'snake', 'elephant', 'rabbit', 'turtle', 'spider', 'butterfly', 'chicken', 'cow', 'frog', 'monkey', 'shark', 'duck', 'lion', 'giraffe', 'octopus', 'bee',
  'house', 'tree', 'flower', 'sun', 'moon', 'star', 'cloud', 'rain', 'rainbow', 'mountain', 'river', 'beach', 'island', 'volcano', 'snowman', 'fire', 'lightning',
  'car', 'bicycle', 'bus', 'train', 'airplane', 'boat', 'rocket', 'tuk tuk', 'motorbike', 'helicopter', 'traffic light', 'bridge',
  'phone', 'laptop', 'keyboard', 'mouse', 'camera', 'television', 'headphones', 'clock', 'lamp', 'key', 'umbrella', 'glasses', 'hat', 'shoe', 'shirt', 'backpack',
  'book', 'pencil', 'scissors', 'paper', 'envelope', 'calendar', 'chair', 'table', 'door', 'window', 'bed', 'toothbrush', 'mirror', 'cup', 'spoon', 'fork', 'bottle',
  'guitar', 'drum', 'ball', 'kite', 'balloon', 'gift', 'crown', 'robot', 'ghost', 'alien', 'dragon', 'castle', 'pyramid', 'temple', 'tent', 'ladder', 'anchor',
  'heart', 'smile', 'eye', 'hand', 'foot', 'nose', 'ear', 'tooth', 'brain',
  'swimming', 'sleeping', 'running', 'dancing', 'fishing', 'singing', 'meeting', 'printer', 'stapler', 'coffee break', 'deadline', 'email', 'wifi', 'password',
  'football', 'basketball', 'trophy', 'medal', 'map', 'compass', 'treasure', 'pirate', 'candle', 'battery', 'magnet', 'light bulb', 'saw', 'hammer',
];

export const normalize = s => String(s ?? '').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function distance(a, b) {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]; dp[0] = i;
    for (let j = 1; j <= b.length; j++) { const t = dp[j]; dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; }
  }
  return dp[b.length];
}

/** 'right' | 'close' | 'wrong' */
export function checkGuess(word, guess) {
  const w = normalize(word), g = normalize(guess);
  if (!g) return 'wrong';
  if (g === w || g.replace(/ /g, '') === w.replace(/ /g, '')) return 'right';
  const allowed = w.length >= 7 ? 2 : w.length >= 4 ? 1 : 0; // longer words get more slack for typos
  const d = distance(g, w);
  return d > 0 && d <= allowed ? 'close' : 'wrong';
}

/** "ice cream" → "_ _ _   _ _ _ _ _" with the letters in `shown` filled in. */
export function maskWord(word, shown = []) {
  return [...word].map((ch, i) => (ch === ' ' ? ' ' : shown.includes(i) ? ch.toUpperCase() : '_')).join(' ');
}

export function pickWords(seed, n) {
  const rng = createRng(`draw:${seed}`);
  const pool = [...WORDS];
  return Array.from({ length: n }, () => pool.splice(Math.floor(rng.next() * pool.length), 1)[0]);
}

export function hintIndex(seed, round, word) {
  const letters = [...word].map((c, i) => (c === ' ' ? -1 : i)).filter(i => i >= 0);
  return letters[Math.floor(createRng(`hint:${seed}:${round}`).next() * letters.length)];
}

export const guessPoints = (secondsLeft, first) => 100 + Math.round(200 * Math.max(0, Math.min(1, secondsLeft / ROUND_SECONDS))) + (first ? FIRST_BONUS : 0);

/**
 * Set up the 3 rounds when the party starts. Players take turns as the artist
 * in a random order: with 2 players that's A, B, A; with more than 3, three
 * different people draw. Bots never draw; if you're the only person, you draw all 3.
 */
export function setupDraw(p, now) {
  const rng = createRng(`artists:${p.secret || p.seed}`);
  // only people draw: a bot can't draw a secret word (bots guess instead)
  const people = Object.entries(p.players).filter(([, v]) => !v.bot);
  const players = (people.length ? people : Object.entries(p.players)).sort((a, b) => a[1].joinedAt - b[1].joinedAt).map(([k]) => k);
  for (let i = players.length - 1; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); [players[i], players[j]] = [players[j], players[i]]; }
  const order = Array.from({ length: ROUNDS }, (_, i) => players[i % players.length]);
  p.draw = { order, words: pickWords(p.secret || p.seed, order.length), round: -1, phase: 'reveal', revealEnd: now, guessed: {}, strokes: [], points: 0, hint: false };
  p.endAt = now + order.length * (ROUND_SECONDS + REVEAL_SECONDS) * 1000 + 2000;
}

export function beginRound(p, now) {
  const d = p.draw;
  d.round++;
  Object.assign(d, { phase: 'drawing', roundStart: now, roundEnd: now + ROUND_SECONDS * 1000, guessed: {}, strokes: [], points: 0, hint: false, skipped: false, firstStrokeAt: null });
}

/** A guesser's guess. Returns { kind: 'right'|'close'|'wrong'|'ignored', pts, first }. */
export function guess(p, key, text, now) {
  const d = p.draw, pl = p.players[key];
  if (!d || d.phase !== 'drawing' || !pl || key === d.order[d.round] || d.guessed[key] != null) return { kind: 'ignored' };
  const res = checkGuess(d.words[d.round], text);
  if (res !== 'right') return { kind: res };
  const first = Object.keys(d.guessed).length === 0;
  const pts = guessPoints((d.roundEnd - now) / 1000, first);
  d.guessed[key] = pts;
  pl.score += pts; pl.hits++;
  const artist = p.players[d.order[d.round]];
  if (artist) artist.score += ARTIST_POINTS;
  return { kind: 'right', pts, first };
}

export const guessersLeft = p => Object.keys(p.players).filter(k => k !== p.draw.order[p.draw.round] && p.draw.guessed[k] == null).length;

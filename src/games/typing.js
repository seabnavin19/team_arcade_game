// Typing Race: type the passage of the day for 60 seconds.
// Score = net words per minute (correct characters / 5, per minute).
// Runs under 90% accuracy are not ranked.

import { createRng } from '../core/rng.js';
import { createLoop } from '../core/loop.js';
import { C, drawHud, MONO } from './draw.js';
import SENTENCES from './sentences.js';

export const W = 800, H = 480, DURATION = 60, MIN_ACCURACY = 0.9, MIN_CHARS = 520;

export function buildPassage(seed) {
  const rng = createRng(`${seed}:typing`);
  const pool = [...SENTENCES];
  const out = [];
  while (out.join(' ').length < MIN_CHARS && pool.length) out.push(pool.splice(Math.floor(rng.next() * pool.length), 1)[0]);
  return out.join(' ');
}

export function createTypingState(seed) {
  return { text: buildPassage(seed), typed: '', keystrokes: 0, errors: 0, time: 0, over: false };
}

/** Handle one key. Returns 'ok' | 'wrong' | 'back' | 'ignored'. */
export function typeKey(s, key) {
  if (s.over) return 'ignored';
  if (key === 'Backspace') { if (!s.typed.length) return 'ignored'; s.typed = s.typed.slice(0, -1); return 'back'; }
  if (key.length !== 1 || s.typed.length >= s.text.length) return 'ignored';
  s.keystrokes++;
  const ok = key === s.text[s.typed.length];
  if (!ok) s.errors++;
  s.typed += key;
  if (s.typed.length >= s.text.length && s.typed === s.text) s.over = true; // finished early
  return ok ? 'ok' : 'wrong';
}

export function typingResult(s, seconds) {
  let correct = 0;
  for (let i = 0; i < s.typed.length; i++) if (s.typed[i] === s.text[i]) correct++;
  const minutes = Math.max(seconds, 1) / 60;
  const wpm = Math.round((correct / 5 / minutes) * 10) / 10;
  const accuracy = s.keystrokes ? (s.keystrokes - s.errors) / s.keystrokes : 0;
  return { wpm, accuracy: Math.round(accuracy * 1000) / 10, correct, keystrokes: s.keystrokes, seconds: Math.round(seconds) };
}

function layoutLines(ctx, text, maxWidth) {
  // returns [{start, end}] character ranges per line, breaking at spaces
  const lines = [];
  let start = 0;
  while (start < text.length) {
    let end = start, lastSpace = -1;
    while (end < text.length && ctx.measureText(text.slice(start, end + 1)).width <= maxWidth) { if (text[end] === ' ') lastSpace = end; end++; }
    if (end < text.length && lastSpace > start) end = lastSpace + 1;
    lines.push({ start, end });
    start = end;
  }
  return lines;
}

export default {
  id: 'typing',
  title: 'Typing Race',
  blurb: 'Type the passage of the day as fast and clean as you can.',
  controls: 'Just start typing · Backspace fixes mistakes',
  length: '60 sec',
  better: 'higher',
  needsKeyboard: true,
  width: W, height: H,
  format: s => `${Math.round(s)} wpm`,
  plausible: (score, seconds, meta) => {
    if (!meta || meta.accuracy < MIN_ACCURACY * 100) return { ok: false, reason: `Accuracy was ${meta?.accuracy ?? 0}%. Runs need 90% or more to be ranked.` };
    return score <= 200 ? { ok: true } : { ok: false };
  },
  describe: m => `${m.accuracy}% accuracy · ${m.correct} correct characters`,
  start(ctx, { seed, input, sound, onEnd }) {
    const s = createTypingState(seed);
    const FONT = '500 22px ui-monospace, "SF Mono", "Cascadia Mono", Consolas, monospace';
    ctx.font = FONT;
    const lines = layoutLines(ctx, s.text, W - 120);
    const LH = 38;
    let flash = 0, ended = false;

    input.on('keydown', e => {
      const r = typeKey(s, e.key);
      if (r !== 'ignored') e.preventDefault();
      if (r === 'wrong') { sound.miss(); flash = 0.15; }
    });

    const finish = () => {
      if (ended) return; ended = true;
      loop.stop(); sound.end();
      const r = typingResult(s, Math.min(s.time, DURATION));
      onEnd(r.wpm, r);
    };

    const loop = createLoop({
      update(dt) {
        s.time += dt; flash = Math.max(0, flash - dt);
        if (s.time >= DURATION || s.over) { s.over = true; finish(); }
      },
      render() {
        ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
        if (flash) { ctx.fillStyle = `rgba(255,77,77,${flash})`; ctx.fillRect(0, 56, W, H - 56); }
        ctx.font = FONT; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
        const pos = s.typed.length;
        const curLine = Math.max(0, lines.findIndex(l => pos >= l.start && pos < l.end));
        const first = Math.max(0, curLine - 1); // keep the current line second from the top
        const visible = lines.slice(first, first + 9);
        visible.forEach((ln, row) => {
          const y = 100 + row * LH;
          let x = 60;
          for (let i = ln.start; i < ln.end; i++) {
            const ch = s.text[i];
            const w = ctx.measureText(ch).width;
            if (i < pos) {
              const ok = s.typed[i] === ch;
              if (!ok) { ctx.fillStyle = 'rgba(255,77,77,.25)'; ctx.fillRect(x, y - 15, w, 30); }
              ctx.fillStyle = ok ? C.lime : C.red;
              ctx.fillText(ok || ch !== ' ' ? ch : '·', x, y);
            } else {
              ctx.fillStyle = row + first === curLine ? C.text : 'rgba(236,233,255,.45)';
              ctx.fillText(ch, x, y);
            }
            if (i === pos && Math.floor(s.time * 2.5) % 2 === 0) { ctx.fillStyle = C.yellow; ctx.fillRect(x - 1, y - 15, 3, 30); }
            x += w;
          }
        });
        const live = typingResult(s, Math.max(s.time, 1));
        drawHud(ctx, W, {
          left: `${Math.round(live.wpm)} WPM   ${s.keystrokes ? live.accuracy : 100}% ACC`,
          right: `${Math.max(0, Math.ceil(DURATION - s.time))}s`,
          progress: Math.min(1, s.time / DURATION),
        });
        if (!s.keystrokes && s.time < 4) {
          ctx.font = MONO; ctx.fillStyle = C.muted; ctx.textAlign = 'center';
          ctx.fillText('Start typing: the clock is running', W / 2, H - 30);
        }
      },
    });
    loop.start();
    return { stop: () => loop.stop() };
  },
};

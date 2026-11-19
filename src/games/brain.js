// Brain Race (solo): 8 IQ puzzles, the same set for everyone each day.
// 10 seconds per puzzle, one try. Right = 500 + up to 500 for speed.

import { createLoop } from '../core/loop.js';
import { C, MONO, drawHud, Particles, FloatText } from './draw.js';
import { buildQuiz, pointsFor, QUESTIONS, ANSWER_SECONDS } from '../party/quiz.js';

export const W = 800, H = 480;
const SHOW_SECONDS = 1.3;
const OPT = i => ({ x: 60 + (i % 2) * 350, y: 262 + Math.floor(i / 2) * 104, w: 330, h: 88 });
export const optionAt = (x, y) => [0, 1, 2, 3].find(i => { const r = OPT(i); return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; }) ?? -1;

export function createBrainState(seed) {
  return { quiz: buildQuiz(`solo:${seed}`), i: 0, phase: 'ask', clock: 0, picked: null, score: 0, right: 0, last: 0, over: false };
}

/** Pick option c for the current puzzle. */
export function choose(s, c) {
  if (s.over || s.phase !== 'ask' || c < 0 || c > 3) return null;
  const ok = c === s.quiz[s.i].correct;
  const pts = ok ? pointsFor(s.clock, false) : 0;
  s.picked = c; s.phase = 'show'; s.clock = 0; s.score += pts; s.last = pts;
  if (ok) s.right++;
  return { ok, pts };
}

/** Advance time. Returns 'timeout' | 'next' | 'done' when something happens. */
export function tick(s, dt) {
  if (s.over) return null;
  s.clock += dt;
  if (s.phase === 'ask' && s.clock >= ANSWER_SECONDS) { s.picked = -1; s.phase = 'show'; s.clock = 0; s.last = 0; return 'timeout'; }
  if (s.phase === 'show' && s.clock >= SHOW_SECONDS) {
    if (s.i + 1 >= QUESTIONS) { s.over = true; return 'done'; }
    s.i++; s.phase = 'ask'; s.clock = 0; s.picked = null;
    return 'next';
  }
  return null;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

export default {
  id: 'brain',
  title: 'Brain Race',
  blurb: '8 quick IQ puzzles: patterns, maths, time and logic. Fast and right wins.',
  controls: 'Tap an answer or press 1–4 · one try per puzzle',
  length: '~1 min',
  better: 'higher',
  width: W, height: H,
  format: s => Math.round(s).toLocaleString('en-US'),
  plausible: (score, seconds) => (score <= QUESTIONS * 1000 && seconds >= 4 ? { ok: true } : { ok: false }),
  describe: m => `${m.right}/${QUESTIONS} right`,
  start(ctx, { seed, input, sound, onEnd }) {
    const s = createBrainState(seed);
    const parts = new Particles(), floats = new FloatText();
    let hover = -1;

    const pick = c => {
      const r = choose(s, c);
      if (!r) return;
      const o = OPT(c);
      if (r.ok) { sound.hit(); parts.burst(o.x + o.w / 2, o.y + o.h / 2, C.lime, 18); floats.add(o.x + o.w / 2, o.y - 6, `+${r.pts}`, C.lime); }
      else sound.bad();
    };
    input.on('pointerdown', p => pick(optionAt(p.x, p.y)));
    input.on('keydown', e => { if (/^[1-4]$/.test(e.key)) pick(Number(e.key) - 1); });

    const loop = createLoop({
      update(dt) {
        parts.update(dt); floats.update(dt);
        hover = input.pointer.inside && input.pointer.type === 'mouse' ? optionAt(input.pointer.x, input.pointer.y) : -1;
        const ev = tick(s, dt);
        if (ev === 'timeout') sound.miss();
        if (ev === 'next') sound.tick();
        if (ev === 'done') { loop.stop(); sound.end(); onEnd(s.score, { right: s.right }); }
      },
      render() {
        const q = s.quiz[s.i];
        ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
        // question
        ctx.save(); ctx.fillStyle = C.text; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const lines = q.text.split('\n');
        lines.forEach((ln, k) => {
          ctx.font = `800 ${lines.length > 1 && k === 0 ? 22 : 30}px ui-monospace, "SF Mono", Consolas, monospace`;
          ctx.fillStyle = lines.length > 1 && k === 0 ? C.muted : C.text;
          ctx.fillText(ln, W / 2, 150 + (k - (lines.length - 1) / 2) * 46);
        });
        ctx.restore();
        // options
        q.options.forEach((opt, c) => {
          const o = OPT(c);
          let border = 'rgba(141,136,179,.35)', fill = '#1a1640', text = C.text;
          if (s.phase === 'show') {
            if (c === q.correct) { border = C.lime; fill = 'rgba(156,255,87,.16)'; }
            else if (c === s.picked) { border = C.red; fill = 'rgba(255,77,77,.14)'; }
            else text = 'rgba(236,233,255,.45)';
          } else if (c === hover) border = C.cyan;
          ctx.save(); roundRect(ctx, o.x, o.y, o.w, o.h, 12); ctx.fillStyle = fill; ctx.fill();
          ctx.lineWidth = 2.5; ctx.strokeStyle = border; ctx.stroke();
          ctx.font = '700 13px ui-monospace, Consolas, monospace'; ctx.fillStyle = C.muted; ctx.textBaseline = 'middle';
          ctx.fillText(String(c + 1), o.x + 18, o.y + o.h / 2);
          ctx.font = '800 26px ui-monospace, "SF Mono", Consolas, monospace'; ctx.fillStyle = text; ctx.textAlign = 'center';
          ctx.fillText(opt, o.x + o.w / 2 + 8, o.y + o.h / 2 + 1); ctx.restore();
        });
        if (s.phase === 'show') {
          ctx.save(); ctx.font = MONO; ctx.textAlign = 'center';
          const ok = s.picked === q.correct;
          ctx.fillStyle = ok ? C.lime : s.picked === -1 ? C.muted : C.red;
          ctx.fillText(ok ? `✓ Correct! +${s.last}` : s.picked === -1 ? "Time's up!" : '✗ Not this one', W / 2, 232);
          ctx.restore();
        }
        parts.draw(ctx); floats.draw(ctx);
        drawHud(ctx, W, {
          left: `SCORE ${s.score.toLocaleString('en-US')}   ${s.right}/${QUESTIONS} RIGHT`,
          right: `PUZZLE ${s.i + 1}/${QUESTIONS}  ${s.phase === 'ask' ? `${Math.ceil(ANSWER_SECONDS - s.clock)}s` : ''}`,
          progress: s.phase === 'ask' ? Math.max(0, s.clock / ANSWER_SECONDS) : 1,
        });
      },
    });
    loop.start();
    return { stop: () => loop.stop() };
  },
};

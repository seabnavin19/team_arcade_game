// Brain Race: IQ-style puzzles for live parties.
// Puzzles are generated from the party's seed on the SERVER only; players get
// each question when it opens and the answer only at the reveal.
//
// Scoring per question: correct = 500 + up to 500 for speed, +200 for the
// first correct answer. Wrong = 0, and you're locked in (one try).

import { createRng } from '../core/rng.js';

export const QUESTIONS = 8;
export const ANSWER_SECONDS = 10;
export const REVEAL_SECONDS = 3;
export const PER_QUESTION = ANSWER_SECONDS + REVEAL_SECONDS;
export const QUIZ_SECONDS = QUESTIONS * PER_QUESTION; // 104 s
export const FIRST_BONUS = 200;

const shuffle = (rng, arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/** Four distinct options including the right one, shuffled. */
function withDistractors(rng, correct, near, fmt = String) {
  const opts = new Set([correct]);
  let guard = 0;
  while (opts.size < 4 && guard++ < 100) {
    const d = near[Math.floor(rng.next() * near.length)];
    const v = correct + d;
    if (v >= 0 && v !== correct) opts.add(v);
  }
  let k = 1;
  while (opts.size < 4) opts.add(correct + 10 * k++);
  const list = shuffle(rng, [...opts]);
  return { options: list.map(fmt), correct: list.indexOf(correct) };
}

const GENERATORS = {
  sequence(rng, level) {
    const kind = rng.pick(level < 2 ? ['add', 'double', 'squares'] : ['add', 'double', 'squares', 'fib', 'growing', 'alternate', 'triple']);
    let seq;
    if (kind === 'add') { const a = rng.int(1, 20), d = rng.int(3, 9 + level * 2); seq = Array.from({ length: 6 }, (_, i) => a + d * i); }
    if (kind === 'double') { const a = rng.int(1, 6); seq = Array.from({ length: 6 }, (_, i) => a * 2 ** i); }
    if (kind === 'triple') { const a = rng.int(1, 3); seq = Array.from({ length: 6 }, (_, i) => a * 3 ** i); }
    if (kind === 'squares') { const s = rng.int(1, 6); seq = Array.from({ length: 6 }, (_, i) => (s + i) ** 2); }
    if (kind === 'fib') { const a = rng.int(1, 5), b = rng.int(a, 8); seq = [a, b]; while (seq.length < 6) seq.push(seq.at(-1) + seq.at(-2)); }
    if (kind === 'growing') { const a = rng.int(1, 10), d = rng.int(1, 3); seq = [a]; for (let i = 1; i < 6; i++) seq.push(seq.at(-1) + d * i); }
    if (kind === 'alternate') { const a = rng.int(10, 30), up = rng.int(4, 9), down = rng.int(1, up - 1); seq = [a]; for (let i = 1; i < 6; i++) seq.push(seq.at(-1) + (i % 2 ? up : -down)); }
    const answer = seq[5];
    return { kind: 'sequence', text: `What comes next?\n${seq.slice(0, 5).join(',  ')},  ?`, ...withDistractors(rng, answer, [-2, -1, 1, 2, 3, -3, 4, 6, -5, 10]) };
  },
  math(rng, level) {
    const op = rng.pick(level < 2 ? ['+', '-', '×'] : ['+', '-', '×', 'mix']);
    let text, answer;
    if (op === '+') { const a = rng.int(18, 89), b = rng.int(17, 79); text = `${a} + ${b}`; answer = a + b; }
    if (op === '-') { const a = rng.int(60, 150), b = rng.int(17, 59); text = `${a} − ${b}`; answer = a - b; }
    if (op === '×') { const a = rng.int(6, 19), b = rng.int(3, 9); text = `${a} × ${b}`; answer = a * b; }
    if (op === 'mix') { const a = rng.int(3, 9), b = rng.int(3, 9), c = rng.int(5, 30); text = `${a} × ${b} + ${c}`; answer = a * b + c; }
    return { kind: 'math', text: `${text} = ?`, ...withDistractors(rng, answer, [-10, -2, -1, 1, 2, 10, 9, -9, 11]) };
  },
  missing(rng) {
    const b = rng.int(3, 12), x = rng.int(3, 12);
    const form = rng.pick(['mul', 'div', 'add']);
    if (form === 'mul') return { kind: 'missing', text: `? × ${b} = ${x * b}`, ...withDistractors(rng, x, [-2, -1, 1, 2, 3]) };
    if (form === 'div') return { kind: 'missing', text: `${x * b} ÷ ? = ${x}`, ...withDistractors(rng, b, [-2, -1, 1, 2, 3]) };
    const a = rng.int(12, 60), t = a + rng.int(15, 70);
    return { kind: 'missing', text: `${a} + ? = ${t}`, ...withDistractors(rng, t - a, [-10, -1, 1, 10, 2, -2]) };
  },
  largest(rng) {
    // four values written different ways; exactly one clear largest
    for (let tries = 0; tries < 50; tries++) {
      const items = [];
      while (items.length < 4) {
        const style = rng.pick(['frac', 'dec', 'pct']);
        let label, v;
        if (style === 'frac') { const d = rng.pick([3, 4, 5, 6, 8, 9]); const n = rng.int(1, d - 1); label = `${n}/${d}`; v = n / d; }
        if (style === 'dec') { v = rng.int(15, 95) / 100; label = `0.${String(Math.round(v * 100)).padStart(2, '0')}`; }
        if (style === 'pct') { v = rng.int(15, 95) / 100; label = `${Math.round(v * 100)}%`; }
        if (!items.some(it => Math.abs(it.v - v) < 0.03)) items.push({ label, v });
      }
      const max = Math.max(...items.map(i => i.v));
      if (items.filter(i => max - i.v < 0.03).length !== 1) continue;
      const list = shuffle(rng, items);
      return { kind: 'largest', text: 'Which is the LARGEST?', options: list.map(i => i.label), correct: list.findIndex(i => i.v === max) };
    }
    return GENERATORS.math(rng, 1);
  },
  time(rng) {
    const h = rng.int(6, 20), m = rng.pick([0, 10, 15, 20, 30, 40, 45, 50]);
    const addH = rng.int(1, 5), addM = rng.pick([15, 20, 25, 35, 40, 45, 50, 55]);
    const fmt = mins => { const t = ((mins % 1440) + 1440) % 1440; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
    const start = h * 60 + m, answer = start + addH * 60 + addM;
    const opts = withDistractors(rng, answer, [-60, 60, -10, 10, -5, 5, 30, -30]);
    return { kind: 'time', text: `${addH} h ${addM} min after ${fmt(start)} is…`, options: opts.options.map(v => fmt(Number(v))), correct: opts.correct };
  },
  odd(rng) {
    const kind = rng.pick(['multiple', 'even', 'square']);
    let good, bad, text;
    if (kind === 'multiple') {
      const k = rng.int(6, 9);
      const pool = Array.from({ length: 10 }, (_, i) => k * (i + 3));
      good = shuffle(rng, pool).slice(0, 3);
      do { bad = rng.int(k * 3, k * 12); } while (bad % k === 0);
      text = `Which one is NOT a multiple of ${k}?`;
    } else if (kind === 'even') {
      good = []; while (good.length < 3) { const v = rng.int(11, 99) * 2; if (!good.includes(v)) good.push(v); }
      bad = rng.int(20, 99) * 2 + 1; text = 'Which number is the odd one out?';
    } else {
      const s = shuffle(rng, [4, 5, 6, 7, 8, 9, 11, 12, 13]).slice(0, 3); good = s.map(x => x * x);
      do { bad = rng.int(20, 170); } while (Number.isInteger(Math.sqrt(bad))); text = 'Which one is NOT a square number?';
    }
    const list = shuffle(rng, [...good, bad]);
    return { kind: 'odd', text, options: list.map(String), correct: list.indexOf(bad) };
  },
};

const ORDER = ['sequence', 'math', 'largest', 'missing', 'time', 'odd'];

/** The party's questions. Server only: this includes the answers. */
export function buildQuiz(seed) {
  const rng = createRng(`quiz:${seed}`);
  const kinds = shuffle(rng, ORDER);
  const out = [];
  for (let i = 0; i < QUESTIONS; i++) {
    const kind = i < kinds.length ? kinds[i] : rng.pick(['sequence', 'math', 'missing', 'largest']);
    out.push(GENERATORS[kind](rng, i < 3 ? 1 : 2));
  }
  return out;
}

/** Where the quiz is at a given moment: question i open, or its reveal, or done. */
export function phaseAt(startAt, now) {
  const t = (now - startAt) / 1000;
  if (t < 0) return { phase: 'before', i: -1 };
  const i = Math.floor(t / PER_QUESTION);
  if (i >= QUESTIONS) return { phase: 'done', i: QUESTIONS };
  const into = t - i * PER_QUESTION;
  const opensAt = startAt + i * PER_QUESTION * 1000;
  return { phase: into < ANSWER_SECONDS ? 'question' : 'reveal', i, opensAt, closesAt: opensAt + ANSWER_SECONDS * 1000 };
}

export const pointsFor = (secondsTaken, first) => 500 + Math.round(500 * Math.max(0, 1 - secondsTaken / ANSWER_SECONDS)) + (first ? FIRST_BONUS : 0);

/** A player answers question i with option c. One try per question. */
export function answer(p, quiz, key, i, c, now) {
  const pl = p.players[key];
  if (p.status !== 'running' || !pl) return { kind: 'invalid' };
  const ph = phaseAt(p.startAt, now);
  if (ph.phase !== 'question' || ph.i !== i || !Number.isInteger(c) || c < 0 || c > 3) return { kind: 'invalid' };
  p.answers ||= {};
  const row = (p.answers[i] ||= {});
  if (row[key]) return { kind: 'already' };
  const ok = c === quiz[i].correct;
  const first = ok && !Object.values(row).some(a => a.ok);
  const pts = ok ? pointsFor((now - ph.opensAt) / 1000, first) : 0;
  row[key] = { c, ok, pts, first };
  if (ok) { pl.score += pts; pl.hits++; }
  return { kind: ok ? 'right' : 'wrong', pts, first };
}

/** What players may see of a question while it's open (no answer!). */
export const questionMsg = (quiz, ph) => ({ type: 'question', i: ph.i, n: QUESTIONS, text: quiz[ph.i].text, options: quiz[ph.i].options, opensAt: ph.opensAt, closesAt: ph.closesAt });

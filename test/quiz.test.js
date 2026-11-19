import { describe, it, expect } from 'vitest';
import { buildQuiz, phaseAt, answer, pointsFor, questionMsg, QUESTIONS, PER_QUESTION, ANSWER_SECONDS, QUIZ_SECONDS } from '../src/party/quiz.js';
import { createParty, join, start } from '../src/party/rules.js';

// An independent solver, so a wrong "correct" answer would be caught.
function solve(q) {
  const t = q.text;
  if (q.kind === 'math') {
    const e = t.replace(' = ?', '').replace(/×/g, '*').replace(/−/g, '-');
    return String(Function(`return (${e})`)());
  }
  if (q.kind === 'missing') {
    let m;
    if ((m = t.match(/^\? × (\d+) = (\d+)$/))) return String(m[2] / m[1]);
    if ((m = t.match(/^(\d+) ÷ \? = (\d+)$/))) return String(m[1] / m[2]);
    if ((m = t.match(/^(\d+) \+ \? = (\d+)$/))) return String(m[2] - m[1]);
  }
  if (q.kind === 'largest') {
    const val = s => (s.includes('/') ? s.split('/')[0] / s.split('/')[1] : s.endsWith('%') ? parseFloat(s) / 100 : parseFloat(s));
    return q.options.reduce((a, b) => (val(b) > val(a) ? b : a));
  }
  if (q.kind === 'time') {
    const m = t.match(/^(\d+) h (\d+) min after (\d\d):(\d\d)/);
    const mins = (+m[3] * 60 + +m[4] + +m[1] * 60 + +m[2]) % 1440;
    return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  }
  if (q.kind === 'odd') {
    const nums = q.options.map(Number);
    let m;
    if ((m = t.match(/multiple of (\d+)/))) return String(nums.find(n => n % m[1] !== 0));
    if (/square/.test(t)) return String(nums.find(n => !Number.isInteger(Math.sqrt(n))));
    return String(nums.find(n => n % 2 === 1));
  }
  if (q.kind === 'sequence') {
    const s = t.split('\n')[1].replace(/,\s*\?/, '').split(',').map(x => Number(x.trim()));
    const cands = [];
    const d = s.map((x, i) => s[i + 1] - x).slice(0, 4);
    if (d.every(x => x === d[0])) cands.push(s[4] + d[0]);
    if (s.every((x, i) => i === 0 || x === s[i - 1] * (s[1] / s[0]))) cands.push(s[4] * (s[1] / s[0]));
    if (s.every((x, i) => i < 2 || x === s[i - 1] + s[i - 2])) cands.push(s[4] + s[3]);
    if (s.every(x => Number.isInteger(Math.sqrt(x)))) cands.push((Math.sqrt(s[4]) + 1) ** 2);
    if (d.every((x, i) => i === 0 || x - d[i - 1] === d[1] - d[0])) cands.push(s[4] + d[3] + (d[1] - d[0]));
    if (d[0] === d[2] && d[1] === d[3] && d[0] !== d[1]) cands.push(s[4] + d[0]);
    return cands.map(String);
  }
  throw new Error(`no solver for ${q.kind}`);
}

describe('brain race puzzles', () => {
  it('every generated question has 4 different options and a correct answer that checks out', () => {
    const kinds = new Set();
    for (let s = 0; s < 300; s++) {
      const quiz = buildQuiz(`seed-${s}`);
      expect(quiz).toHaveLength(QUESTIONS);
      for (const q of quiz) {
        kinds.add(q.kind);
        expect(new Set(q.options).size).toBe(4);
        expect(q.correct).toBeGreaterThanOrEqual(0); expect(q.correct).toBeLessThan(4);
        const sol = solve(q);
        if (Array.isArray(sol)) expect(sol).toContain(q.options[q.correct]);
        else expect(q.options[q.correct]).toBe(sol);
      }
    }
    expect([...kinds].sort()).toEqual(['largest', 'math', 'missing', 'odd', 'sequence', 'time']);
  });
  it('same party → same questions; next party → different', () => {
    expect(buildQuiz('a')).toEqual(buildQuiz('a'));
    expect(buildQuiz('a')).not.toEqual(buildQuiz('b'));
  });
  it('schedule: answer window, then reveal, then the next question', () => {
    expect(phaseAt(1000, 500).phase).toBe('before');
    expect(phaseAt(0, 1000)).toMatchObject({ phase: 'question', i: 0 });
    expect(phaseAt(0, (ANSWER_SECONDS + 0.5) * 1000)).toMatchObject({ phase: 'reveal', i: 0 });
    expect(phaseAt(0, (PER_QUESTION + 0.1) * 1000)).toMatchObject({ phase: 'question', i: 1 });
    expect(phaseAt(0, QUIZ_SECONDS * 1000).phase).toBe('done');
  });
  it('scoring: fast and first earn more; wrong and second tries earn nothing', () => {
    expect(pointsFor(0, true)).toBe(1200);
    expect(pointsFor(ANSWER_SECONDS, false)).toBe(500);
    const p = createParty({ id: 'q', chat: -1, seed: 'z', now: 0, game: 'quiz', joinSeconds: 0 });
    join(p, { key: 'a', name: 'A' }, 0); join(p, { key: 'b', name: 'B' }, 0); join(p, { key: 'c', name: 'C' }, 0);
    start(p);
    const quiz = buildQuiz(p.seed), right = quiz[0].correct, wrong = (right + 1) % 4;
    expect(answer(p, quiz, 'b', 0, right, p.startAt + 2000)).toMatchObject({ kind: 'right', first: true, pts: 500 + 400 + 200 });
    expect(answer(p, quiz, 'a', 0, right, p.startAt + 5000)).toMatchObject({ kind: 'right', first: false, pts: 750 });
    expect(answer(p, quiz, 'c', 0, wrong, p.startAt + 1000)).toMatchObject({ kind: 'wrong', pts: 0 });
    expect(answer(p, quiz, 'c', 0, right, p.startAt + 1500).kind).toBe('already');
    expect(answer(p, quiz, 'a', 1, 0, p.startAt + 3000).kind).toBe('invalid'); // question 2 not open yet
    expect(answer(p, quiz, 'a', 0, right, p.startAt + (ANSWER_SECONDS + 1) * 1000).kind).toBe('invalid'); // closed
    expect(p.players.b.score).toBe(1100); expect(p.players.b.hits).toBe(1);
  });
  it('the question message never contains the answer', () => {
    const quiz = buildQuiz('x');
    const msg = questionMsg(quiz, phaseAt(0, 1000));
    expect(msg).not.toHaveProperty('correct');
    expect(JSON.stringify(msg)).not.toMatch(/correct/);
  });
});

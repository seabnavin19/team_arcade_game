// Brain Race in the browser: the question, four big answer buttons, a timer,
// then the reveal. Answers can also be picked with keys 1–4.

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => Math.round(n).toLocaleString('en-US');

export function createQuizView(root, { send, serverNow, getMe, sound, input }) {
  root.innerHTML = `
    <div class="ta-quiz-top"><span data-qn>Get ready…</span><span class="ta-quiz-time" data-qtime></span></div>
    <div class="ta-quiz-bar"><i data-qbar></i></div>
    <div class="ta-quiz-q" data-qtext>The first puzzle is coming up.</div>
    <div class="ta-quiz-opts" data-qopts></div>
    <div class="ta-quiz-status" data-qstatus></div>`;
  const $ = s => root.querySelector(`[data-${s}]`);
  const el = { n: $('qn'), time: $('qtime'), bar: $('qbar'), text: $('qtext'), opts: $('qopts'), status: $('qstatus') };
  let q = null, picked = null, revealed = false, answeredCount = '';

  function pick(c) {
    if (!q || revealed || picked !== null || serverNow() > q.closesAt) return;
    picked = c;
    send({ type: 'answer', i: q.i, c });
    sound.tick();
    paint();
  }
  el.opts.addEventListener('click', e => { const b = e.target.closest('[data-c]'); if (b) pick(Number(b.dataset.c)); });
  input.on('keydown', e => { if (/^[1-4]$/.test(e.key)) pick(Number(e.key) - 1); });

  function paint() {
    el.opts.querySelectorAll('[data-c]').forEach(b => {
      const c = Number(b.dataset.c);
      b.classList.toggle('is-picked', picked === c);
      b.disabled = picked !== null || revealed;
    });
  }

  return {
    onQuestion(m) {
      q = m; picked = null; revealed = false; answeredCount = '';
      el.n.textContent = `Puzzle ${m.i + 1} of ${m.n}`;
      el.text.textContent = m.text;
      el.opts.innerHTML = m.options.map((o, c) => `<button type="button" class="ta-quiz-opt" data-c="${c}"><span class="ta-quiz-key">${c + 1}</span>${esc(o)}</button>`).join('');
      el.status.textContent = '';
      el.status.className = 'ta-quiz-status';
      sound.go();
    },
    onLocked(m) { if (q && m.i === q.i) { picked = m.c; paint(); el.status.textContent = `Locked in${answeredCount}`; } },
    onAnswered(m) {
      if (!q || m.i !== q.i || revealed) return;
      answeredCount = ` · ${m.count} of ${m.of} answered`;
      el.status.textContent = picked !== null ? `Locked in${answeredCount}` : `${m.count} of ${m.of} answered. Hurry!`;
    },
    onReveal(m) {
      if (!q || m.i !== q.i) return;
      revealed = true;
      const mine = m.answers[getMe()];
      el.opts.querySelectorAll('[data-c]').forEach(b => {
        const c = Number(b.dataset.c);
        b.classList.toggle('is-right', c === m.correct);
        b.classList.toggle('is-wrong', c === picked && c !== m.correct);
        b.disabled = true;
      });
      const right = esc(q.options[m.correct]);
      let html;
      if (mine?.ok) { html = `<b class="ta-ok">✓ Correct! +${fmt(mine.pts)}</b>${mine.first ? ' <span class="ta-quiz-first">FIRST!</span>' : ''}`; sound.hit(); }
      else if (mine) { html = `<b class="ta-warn">✗ Not this time.</b> The answer was <b>${right}</b>.`; sound.bad(); }
      else html = `<b class="ta-muted">Time's up.</b> The answer was <b>${right}</b>.`;
      if (m.firstName && !mine?.first) html += `<br><span class="ta-muted">${esc(m.firstName)} got it first.</span>`;
      el.status.innerHTML = html;
    },
    update() {
      if (!q) return;
      const left = Math.max(0, (q.closesAt - serverNow()) / 1000);
      el.time.textContent = revealed ? '' : `${Math.ceil(left)}s`;
      el.bar.style.width = `${revealed ? 0 : (left / ((q.closesAt - q.opensAt) / 1000)) * 100}%`;
      if (left <= 0 && !revealed && picked === null) { el.opts.querySelectorAll('[data-c]').forEach(b => { b.disabled = true; }); }
    },
  };
}

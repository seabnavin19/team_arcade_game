// In Sync in the browser: whose round it is, the question, four answers,
// then the reveal of both picks. Answers can also be picked with keys 1–4.

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => Math.round(n).toLocaleString('en-US');

export function createSyncView(root, { send, serverNow, getMe, getParty, sound, input }) {
  root.innerHTML = `
    <div class="ta-quiz-top"><span data-sn>Get ready…</span><span class="ta-quiz-time" data-stime></span></div>
    <div class="ta-quiz-bar"><i data-sbar></i></div>
    <div class="ta-sync-about" data-sabout></div>
    <div class="ta-quiz-q ta-sync-q" data-sq>The first question is coming up.</div>
    <div class="ta-quiz-opts" data-sopts></div>
    <div class="ta-quiz-status" data-sstatus></div>
    <div class="ta-sync-meter"><span data-steam>Team 0</span><span class="ta-sync-dots" data-sdots></span></div>`;
  const $ = s => root.querySelector(`[data-${s}]`);
  const el = { n: $('sn'), time: $('stime'), bar: $('sbar'), about: $('sabout'), q: $('sq'), opts: $('sopts'), status: $('sstatus'), team: $('steam'), dots: $('sdots') };
  let r = null, picked = null, revealed = false, partnerIn = false;
  const results = []; // per round: true (in sync) / false

  const nameOf = key => getParty()?.players.find(p => p.key === key)?.name || '?';
  const partnerName = () => { const me = getMe(); return getParty()?.players.find(p => p.key !== me)?.name || 'your partner'; };

  function choose(c) {
    if (!r || revealed || picked !== null || serverNow() > r.closesAt) return;
    picked = c;
    send({ type: 'pick', i: r.i, c });
    sound.tick();
    paint();
  }
  el.opts.addEventListener('click', e => { const b = e.target.closest('[data-c]'); if (b) choose(Number(b.dataset.c)); });
  input.on('keydown', e => { if (/^[1-4]$/.test(e.key)) choose(Number(e.key) - 1); });

  function paint() {
    el.opts.querySelectorAll('[data-c]').forEach(b => {
      const c = Number(b.dataset.c);
      b.classList.toggle('is-picked', picked === c);
      b.disabled = picked !== null || revealed;
    });
    if (!revealed && r) {
      const aboutMe = r.subject === getMe();
      el.status.innerHTML = picked !== null
        ? (partnerIn ? '<b class="ta-ok">Both locked in!</b>' : `Locked in. Waiting for <b>${esc(partnerName())}</b>…`)
        : (partnerIn ? `<b>${esc(partnerName())}</b> has locked in. Your turn!` : (aboutMe ? 'Answer honestly!' : `What would <b>${esc(r.subjectName)}</b> pick?`));
    }
  }

  function paintDots(n) {
    el.dots.innerHTML = Array.from({ length: n }, (_, i) => `<i class="${results[i] === true ? 'is-hit' : results[i] === false ? 'is-miss' : ''}"></i>`).join('');
    const team = getParty()?.players[0]?.score || 0;
    el.team.textContent = `Team ${fmt(team)}`;
  }

  return {
    onRound(m) {
      if (r && r.i === m.i) { partnerIn = (m.locked || []).some(k => k !== getMe()); paint(); return; } // reconnect: same round
      r = m; picked = null; revealed = false;
      partnerIn = (m.locked || []).some(k => k !== getMe());
      const aboutMe = m.subject === getMe();
      el.n.textContent = `Round ${m.i + 1} of ${m.n}`;
      el.about.innerHTML = aboutMe
        ? '<span class="ta-sync-tag is-me">About you</span> Pick your real answer.'
        : `<span class="ta-sync-tag">About ${esc(m.subjectName)}</span> Guess what they’ll pick.`;
      el.q.textContent = m.q;
      el.opts.innerHTML = m.o.map((o, c) => `<button type="button" class="ta-quiz-opt ta-sync-opt" data-c="${c}"><span class="ta-quiz-key">${c + 1}</span><span>${esc(o)}</span></button>`).join('');
      paintDots(m.n);
      paint();
      sound.go();
    },
    onLocked(m) { if (r && m.i === r.i) { picked = m.c; paint(); } },
    onPartner(m) { if (r && m.i === r.i) { partnerIn = (m.locked || []).some(k => k !== getMe()); paint(); } },
    onReveal(m) {
      if (!r || m.i !== r.i) return;
      revealed = true;
      results[m.i] = m.match;
      el.opts.querySelectorAll('[data-c]').forEach(b => {
        const c = Number(b.dataset.c);
        b.disabled = true;
        b.classList.remove('is-picked');
        b.classList.toggle('is-right', m.match && c === m.subjectPick);
        b.classList.toggle('is-wrong', !m.match && c === m.guesserPick);
        b.classList.toggle('is-answer', !m.match && c === m.subjectPick);
        b.querySelectorAll('.ta-sync-who').forEach(x => x.remove());
        const who = [];
        if (c === m.subjectPick) who.push(m.subject === getMe() ? 'You' : nameOf(m.subject));
        if (c === m.guesserPick) who.push(m.guesser === getMe() ? 'You' : nameOf(m.guesser));
        if (who.length) b.insertAdjacentHTML('beforeend', `<span class="ta-sync-who">${who.map(esc).join(' + ')}</span>`);
      });
      let html;
      if (m.match) {
        html = `<b class="ta-ok">💞 In sync! +${fmt(m.pts)}</b>${m.streak >= 3 ? ` <span class="ta-quiz-first">${m.streak} IN A ROW · x2</span>` : ''}`;
        sound.hit();
      } else if (m.subjectPick === null || m.guesserPick === null) {
        html = '<b class="ta-muted">Time ran out before you both picked.</b>';
        sound.miss();
      } else {
        html = `<b class="ta-warn">Not quite!</b> ${esc(m.subject === getMe() ? 'You' : nameOf(m.subject))} picked <b>${esc(m.o[m.subjectPick])}</b>.`;
        sound.bad();
      }
      el.status.innerHTML = html;
      paintDots(m.n);
    },
    update() {
      if (!r) return;
      const left = Math.max(0, (r.closesAt - serverNow()) / 1000);
      el.time.textContent = revealed ? '' : `${Math.ceil(left)}s`;
      el.bar.style.width = `${revealed ? 0 : (left / ((r.closesAt - r.opensAt) / 1000)) * 100}%`;
      if (left <= 0 && !revealed && picked === null) el.opts.querySelectorAll('[data-c]').forEach(b => { b.disabled = true; });
    },
  };
}

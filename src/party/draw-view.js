// Draw & Guess in the browser: the shared drawing board, the artist's tools,
// and the guess box with the live chat of (wrong) guesses.

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const W = 800, H = 480, PAPER = '#fbf8ff';
const COLORS = ['#1b1b2f', '#e63946', '#f4a261', '#ffd23f', '#2a9d8f', '#3a86ff', '#8338ec', '#ff006e', '#6b4f2a', PAPER];
const SIZES = [4, 9, 18];

export function createDrawView({ ctx, top, ui, input, send, serverNow, getMe, sound }) {
  top.innerHTML = `<span class="ta-draw-round" data-dround></span><span class="ta-draw-word" data-dword></span><span class="ta-draw-time" data-dtime></span>`;
  ui.innerHTML = `
    <div class="ta-draw-tools" data-dtools hidden>
      <div class="ta-draw-colors">${COLORS.map((c, i) => `<button type="button" class="ta-draw-color${i === 0 ? ' is-on' : ''}" data-color="${c}" style="--c:${c}" title="${c === PAPER ? 'Eraser' : c}">${c === PAPER ? '⌫' : ''}</button>`).join('')}</div>
      <div class="ta-draw-sizes">${SIZES.map((w, i) => `<button type="button" class="ta-draw-size${i === 1 ? ' is-on' : ''}" data-size="${w}"><i style="width:${w}px;height:${w}px"></i></button>`).join('')}
        <button type="button" class="ta-btn ta-btn-ghost" data-undo>Undo</button><button type="button" class="ta-btn ta-btn-ghost" data-clear>Clear</button></div>
    </div>
    <form class="ta-draw-guess" data-dguess hidden autocomplete="off"><input type="text" maxlength="40" placeholder="Type your guess…" data-dinput enterkeyhint="send"><button class="ta-btn" type="submit">Guess</button></form>
    <ol class="ta-draw-chat" data-dchat></ol>`;
  const $ = (root, k) => root.querySelector(`[data-${k}]`);
  const el = { round: $(top, 'dround'), word: $(top, 'dword'), time: $(top, 'dtime'), tools: $(ui, 'dtools'), form: $(ui, 'dguess'), inputBox: $(ui, 'dinput'), chat: $(ui, 'dchat') };

  let round = null, ops = [], dirty = true, color = COLORS[0], size = SIZES[1], strokeId = 0, live = null, guessedIt = false;
  const isArtist = () => round && round.artist === getMe() && round.phase === 'drawing';

  // ---- artist tools ----
  ui.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.color) { color = b.dataset.color; ui.querySelectorAll('[data-color]').forEach(x => x.classList.toggle('is-on', x === b)); }
    if (b.dataset.size) { size = Number(b.dataset.size); ui.querySelectorAll('[data-size]').forEach(x => x.classList.toggle('is-on', x === b)); }
    if (b.hasAttribute('data-undo') && isArtist()) { send({ type: 'undo' }); const id = ops.filter(o => o.t === 'stroke').at(-1)?.id; ops = ops.filter(o => o.id !== id); dirty = true; }
    if (b.hasAttribute('data-clear') && isArtist()) { send({ type: 'clear' }); ops = []; dirty = true; }
  });

  // ---- drawing: draw locally at once, send in small chunks ----
  let pending = [];
  const flush = () => {
    if (!live || pending.length < 4) return;
    send({ type: 'stroke', id: live.id, c: live.c, w: live.w, pts: pending });
    pending = pending.slice(-2); // keep the last point so chunks join up
  };
  setInterval(flush, 70);
  input.on('pointerdown', pt => {
    if (!isArtist()) return;
    live = { t: 'stroke', id: ++strokeId + Date.now() % 100000 * 100, c: color, w: color === PAPER ? size * 2 : size, pts: [Math.round(pt.x), Math.round(pt.y), Math.round(pt.x) + 0.01, Math.round(pt.y)] };
    ops.push(live); pending = [...live.pts]; dirty = true;
  });
  input.on('pointermove', pt => {
    if (!live || !pt.down) return;
    const x = Math.round(pt.x), y = Math.round(pt.y), n = live.pts.length;
    if (Math.hypot(x - live.pts[n - 2], y - live.pts[n - 1]) < 2) return;
    live.pts.push(x, y); pending.push(x, y); dirty = true;
  });
  input.on('pointerup', () => { flush(); if (pending.length >= 4) send({ type: 'stroke', id: live.id, c: live.c, w: live.w, pts: pending }); live = null; pending = []; });

  // ---- guessing ----
  el.form.addEventListener('submit', e => {
    e.preventDefault();
    const text = el.inputBox.value.trim();
    if (!text || !round || round.phase !== 'drawing' || guessedIt) return;
    send({ type: 'guess', text });
    el.inputBox.value = '';
  });
  const addChat = (html, cls = '') => {
    el.chat.insertAdjacentHTML('afterbegin', `<li class="${cls}">${html}</li>`);
    while (el.chat.children.length > 7) el.chat.lastChild.remove();
  };

  function paintRound() {
    if (!round) return;
    const me = getMe();
    el.round.textContent = `Round ${round.i + 1}/${round.n} · ${round.artist === me ? 'You are drawing!' : `${round.artistName} is drawing`}`;
    el.word.innerHTML = round.word ? `${round.phase === 'reveal' ? 'It was' : 'Draw'}: <b>${esc(round.word.toUpperCase())}</b>` : `<span class="ta-draw-mask">${esc(round.mask)}</span>`;
    el.tools.hidden = !isArtist();
    el.form.hidden = round.artist === me || round.phase !== 'drawing' || guessedIt;
    el.inputBox.disabled = el.form.hidden;
    ctx.canvas.style.cursor = isArtist() ? 'crosshair' : 'default';
  }

  function onMessage(m) {
    if (m.type === 'round') {
      const newRound = !round || round.i !== m.i;
      round = m;
      if (newRound) {
        guessedIt = false;
        if (m.phase === 'drawing') {
          addChat(`🎨 <b>${esc(m.artistName)}</b> is drawing now`, 'is-sys');
          if (m.artist === getMe()) sound.go();
        }
      }
      if (round.guessed?.includes(getMe())) guessedIt = true;
      paintRound();
      if (newRound && m.phase === 'drawing' && m.artist !== getMe()) setTimeout(() => el.inputBox.focus({ preventScroll: true }), 50);
    } else if (m.type === 'strokes') {
      for (const op of m.ops) {
        if (op.t === 'clear') ops = [];
        else if (op.t === 'undo') ops = ops.filter(o => o.id !== op.id);
        else { const same = ops.find(o => o.id === op.id); if (same) same.pts.push(...op.pts.slice(2)); else ops.push({ ...op, pts: [...op.pts] }); }
      }
      dirty = true;
    } else if (m.type === 'chat') {
      addChat(`<b>${esc(m.name)}:</b> ${esc(m.text)}`);
    } else if (m.type === 'close-guess') {
      addChat(`🔥 <b>“${esc(m.text)}” is very close!</b>`, 'is-close');
    } else if (m.type === 'guessed') {
      addChat(`✓ <b>${esc(m.name)}</b> guessed it! +${m.pts}${m.first ? ' (first!)' : ''}`, 'is-ok');
      if (round?.artist === getMe()) sound.hit();
    } else if (m.type === 'you-guessed') {
      guessedIt = true; sound.hit(); paintRound();
      addChat(`🎉 You got it: <b>${esc(m.word.toUpperCase())}</b> +${m.pts}`, 'is-ok');
    } else if (m.type === 'reveal') {
      addChat(m.skipped ? `⏭ ${esc(m.artistName)} wasn't here, so the round was skipped. The word was <b>${esc(m.word)}</b>.` : `The word was <b>${esc(m.word.toUpperCase())}</b>`, 'is-sys');
    }
  }

  function render() {
    if (!dirty) return;
    dirty = false;
    ctx.fillStyle = PAPER; ctx.fillRect(0, 0, W, H);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const o of ops) {
      if (o.t !== 'stroke' || o.pts.length < 4) continue;
      ctx.strokeStyle = o.c; ctx.lineWidth = o.w;
      ctx.beginPath(); ctx.moveTo(o.pts[0], o.pts[1]);
      for (let i = 2; i < o.pts.length; i += 2) ctx.lineTo(o.pts[i], o.pts[i + 1]);
      ctx.stroke();
    }
    if (round && !ops.length && round.phase === 'drawing') {
      ctx.fillStyle = 'rgba(27,27,47,.35)'; ctx.font = '700 20px system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(isArtist() ? 'Draw here! Your word is at the top.' : `Waiting for ${round.artistName} to draw…`, W / 2, H / 2);
    }
  }

  function update() {
    if (!round) return;
    const left = Math.max(0, Math.ceil((round.endsAt - serverNow()) / 1000));
    el.time.textContent = round.phase === 'drawing' ? `${left}s` : 'next…';
    el.time.classList.toggle('is-low', round.phase === 'drawing' && left <= 10);
  }

  return { onMessage, render, update, markDirty: () => { dirty = true; } };
}

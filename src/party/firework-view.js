// Water Festival Firework Show in the browser.
//  • Draw: a night sky to draw on with glowing firework colours.
//  • Show: each drawing rides a rocket up over the Royal Palace and bursts
//    into sparks that fly out to make the picture, glitter, then fall.
//  • Rate: 1–5 stars under the sky while it glows. Names come after.

import { COLORS, IDEAS, W, H, LAUNCH_Y, SKY_TOP, SKY_BOTTOM, MAX_POINTS } from './firework.js';
import { C, MONO, drawHud } from '../games/draw.js';
import { renderFireworkGif, toBase64 } from './firework-gif.js';

const RIVER = 404;
const RISE_MS = 1300, FORM_MS = 900, HOLD_END_MS = 6000;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const easeOut = u => 1 - Math.pow(1 - Math.max(0, Math.min(1, u)), 3);

export function createFireworkView({ ctx, panel, input, send, serverNow, getParty, getMe, sound }) {
  panel.innerHTML = `
    <div class="ta-fw-draw" data-drawbar>
      <div class="ta-fw-idea" data-idea></div>
      <div class="ta-fw-tools">
        <div class="ta-fw-colors">${COLORS.map((c, i) => `<button type="button" class="ta-fw-color${i === 1 ? ' is-on' : ''}" data-c="${c}" style="--c:${c}" aria-label="Colour ${i + 1}"></button>`).join('')}</div>
        <button type="button" class="ta-btn ta-btn-ghost" data-undo>Undo</button>
        <button type="button" class="ta-btn ta-btn-ghost" data-clear>Clear</button>
        <button type="button" class="ta-btn ta-fw-send" data-send>🎆 Launch it</button>
      </div>
      <div class="ta-fw-note" data-drawnote>Draw anything in the sky. Every line becomes sparks.</div>
    </div>
    <div class="ta-fw-rate" data-ratebar hidden>
      <div class="ta-fw-q" data-rateq>Rate this firework</div>
      <div class="ta-fw-stars" data-stars>${[1, 2, 3, 4, 5].map(n => `<button type="button" data-star="${n}" aria-label="${n} stars">★</button>`).join('')}</div>
      <div class="ta-fw-note" data-ratenote></div>
      <div class="ta-fw-reveal" data-reveal></div>
    </div>`;
  const $ = k => panel.querySelector(`[data-${k}]`);
  const el = { drawbar: $('drawbar'), idea: $('idea'), send: $('send'), drawnote: $('drawnote'), ratebar: $('ratebar'), rateq: $('rateq'), stars: $('stars'), ratenote: $('ratenote'), reveal: $('reveal') };

  const party = getParty();
  el.idea.innerHTML = `Need an idea? Try <b>${esc(IDEAS[[...party.seed].reduce((n, ch) => n + ch.charCodeAt(0), 0) % IDEAS.length])}</b>`;

  // ---------- state ----------
  let snap = null;
  let strokes = [], live = null, pen = COLORS[1], dirty = false, sent = false, autoSent = false;
  let show = { i: -1, art: null, at: 0, built: false }, myStars = {}, asked = -1;
  const reveals = [];
  const sparks = [], flashes = [];
  const stars = Array.from({ length: 70 }, (_, i) => [(i * 211) % W, 60 + ((i * 53) % 260), 0.25 + (i % 5) * 0.12, i]);
  const used = () => strokes.reduce((n, s) => n + s.pts.length / 2, 0) + (live ? live.pts.length / 2 : 0);

  // ---------- drawing ----------
  const drawing = () => getParty()?.status === 'running' && (!snap || snap.phase === 'draw') && serverNow() < (snap?.drawEnd ?? Infinity);
  input.on('pointerdown', pt => {
    if (!drawing() || used() >= MAX_POINTS) return;
    live = { c: pen, pts: [Math.round(pt.x), Math.round(Math.max(SKY_TOP, Math.min(SKY_BOTTOM, pt.y)))] };
  });
  input.on('pointermove', pt => {
    if (!live || !drawing()) return;
    const x = Math.round(pt.x), y = Math.round(Math.max(SKY_TOP, Math.min(SKY_BOTTOM, pt.y)));
    const lx = live.pts.at(-2), ly = live.pts.at(-1);
    if (Math.hypot(x - lx, y - ly) < 4 || used() >= MAX_POINTS) return;
    live.pts.push(x, y);
  });
  input.on('pointerup', () => { if (live) { strokes.push(live); live = null; dirty = true; noteDraw(); } });
  el.drawbar.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || !drawing()) return;
    if (b.dataset.c) { pen = b.dataset.c; el.drawbar.querySelectorAll('[data-c]').forEach(x => x.classList.toggle('is-on', x === b)); return; }
    if (b.dataset.undo !== undefined) { strokes.pop(); dirty = true; }
    if (b.dataset.clear !== undefined) { strokes = []; dirty = true; }
    if (b.dataset.send !== undefined) submit();
    noteDraw();
  });
  function submit() {
    if (live) { strokes.push(live); live = null; }
    send({ type: 'fw-submit', strokes });
    dirty = false; sent = true;
  }
  function noteDraw() {
    const n = used();
    el.send.textContent = sent && !dirty ? '✓ Launched' : sent ? '🎆 Update it' : '🎆 Launch it';
    el.drawnote.textContent = !strokes.length ? 'Draw anything in the sky. Every line becomes sparks.'
      : n >= MAX_POINTS ? 'That’s all the sparks one rocket holds!'
      : sent && !dirty ? 'Ready for the show. You can keep drawing and update it until time’s up.'
      : 'Tap Launch it when you’re happy (it’s sent anyway when time runs out).';
  }

  // ---------- rating ----------
  el.stars.addEventListener('click', e => {
    const b = e.target.closest('[data-star]');
    if (!b || !snap || snap.phase !== 'show' || snap.artist === getMe()) return;
    send({ type: 'fw-rate', i: snap.i, stars: Number(b.dataset.star) });
    myStars[snap.i] = Number(b.dataset.star); paintStars(); sound.tick();
  });
  function paintStars() {
    const mine = myStars[snap?.i] || 0, own = snap?.artist === getMe();
    el.stars.querySelectorAll('button').forEach(b => { b.classList.toggle('is-on', Number(b.dataset.star) <= mine); b.disabled = own; });
    const solo = snap.of <= 1;
    el.stars.hidden = solo;
    el.rateq.textContent = solo ? 'Your solo firework show 🎆' : own ? 'This one is yours! 🤫 Act natural…' : `Rate firework ${snap.i + 1} of ${snap.n}`;
    el.ratenote.textContent = solo ? 'Sit back and enjoy. It goes to the group as a GIF when it ends.' : `${snap.votes} of ${Math.max(0, snap.of - 1)} rated${mine ? ` · you gave ${mine} ★ (tap to change)` : ''}`;
  }

  // ---------- show particles ----------
  function targetsOf(art) {
    const pts = [];
    let total = 0;
    for (const s of art) for (let i = 2; i < s.pts.length; i += 2) total += Math.hypot(s.pts[i] - s.pts[i - 2], s.pts[i + 1] - s.pts[i - 1]);
    const gap = Math.max(5, total / 900);
    for (const s of art) {
      pts.push([s.pts[0], s.pts[1], s.c]);
      let carry = 0;
      for (let i = 2; i < s.pts.length; i += 2) {
        const x0 = s.pts[i - 2], y0 = s.pts[i - 1], x1 = s.pts[i], y1 = s.pts[i + 1];
        const d = Math.hypot(x1 - x0, y1 - y0);
        for (carry += d; carry >= gap; carry -= gap) { const k = 1 - (carry - gap) / (d || 1); pts.push([x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, s.c]); }
      }
    }
    return pts;
  }
  function buildShow() {
    const t = targetsOf(show.art);
    const xs = t.map(p => p[0]), ys = t.map(p => p[1]);
    show.cx = (Math.min(...xs) + Math.max(...xs)) / 2; show.cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    show.color = t[0]?.[2] || C.yellow;
    show.dots = t.map(([x, y, c]) => ({ x, y, c, d: Math.random() * 120, tw: Math.random() * 6 }));
    show.built = true; show.boomed = false;
  }
  function boom(x, y, hex) {
    flashes.push({ x, y, r: 70, age: 0, hex });
    for (let i = 0; i < 70; i++) {
      const a = (i / 70) * Math.PI * 2, v = 200 + Math.random() * 160;
      sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, age: 0, life: 0.9 + Math.random() * 0.5, hex, tx: x, ty: y });
    }
    sound.boom(true);
  }

  // ---------- messages ----------
  function onSnap(m) {
    snap = m;
    for (const e of m.events || []) {
      if (e.e === 'show') { show = { i: e.i, art: null, at: e.at, built: false }; asked = -1; }
      if (e.e === 'rated') {
        reveals.unshift(e);
        el.reveal.innerHTML = `That was <b>${esc(e.key === getMe() ? 'yours' : `${e.name}’s`)}</b>: ${e.n ? `${'★'.repeat(Math.round(e.avg))}<span>${'★'.repeat(5 - Math.round(e.avg))}</span> ${e.avg.toFixed(1)} from ${e.n}` : 'no ratings'}`;
      }
    }
    if (m.phase === 'draw' && !autoSent && dirty && serverNow() > m.drawEnd - 700) { autoSent = true; submit(); }
    if (m.phase === 'draw' && !autoSent && !sent && live && serverNow() > m.drawEnd - 700) { autoSent = true; submit(); }
    if (m.phase === 'show') {
      if (show.i !== m.i) show = { i: m.i, art: null, at: m.showAt, built: false };
      if (!show.art && asked !== m.i) { asked = m.i; send({ type: 'fw-art', i: m.i }); }
      paintStars();
    }
    const drawingNow = m.phase === 'draw';
    if (drawingNow && m.of > 0 && m.ready.length === m.of && !dirty && !live) el.drawnote.textContent = m.of === 1 ? 'Launching your firework… 🎆' : 'Everyone is ready! The show starts now 🎆';
    el.drawbar.hidden = !drawingNow;
    el.ratebar.hidden = m.phase !== 'show';
  }
  function onMessage(m) {
    if (m.type === 'fw-render') {
      // the room asks this screen to make the GIF that goes to the Telegram group
      Promise.resolve(renderFireworkGif(m.art, { seed: m.seed, yieldEvery: 6 }))
        .then(bytes => bytes && send({ type: 'fw-gif', i: m.i, data: toBase64(bytes) }))
        .catch(() => {});
      return;
    }
    if (m.type === 'fw-art' && m.i === show.i && m.art) { show.art = m.art; buildShow(); }
    if (m.type === 'fw-saved') { el.drawnote.textContent = m.points ? 'Ready for the show! You can keep drawing and update it until time’s up.' : 'Your sky is empty, so there’s nothing to launch yet.'; sound.hit(); }
    if (m.type === 'fw-rated' && m.kind === 'own') el.rateq.textContent = 'This one is yours! 🤫';
  }

  // ---------- frame ----------
  function update(dt) {
    for (const f of flashes) f.age += dt;
    for (let i = flashes.length - 1; i >= 0; i--) if (flashes[i].age > 0.3) flashes.splice(i, 1);
    for (const s of sparks) {
      s.age += dt; s.vx *= Math.exp(-2.2 * dt); s.vy *= Math.exp(-2.2 * dt); s.vy += 60 * dt;
      s.x += s.vx * dt; s.y += s.vy * dt; s.tx += (s.x - s.tx) * Math.min(1, dt * 9); s.ty += (s.y - s.ty) * Math.min(1, dt * 9);
    }
    for (let i = sparks.length - 1; i >= 0; i--) if (sparks[i].age >= sparks[i].life) sparks.splice(i, 1);
  }

  function drawPalace(x) {
    ctx.save(); ctx.fillStyle = '#1a1433';
    const base = RIVER;
    ctx.fillRect(x - 150, base - 26, 300, 26);
    [[110, 40], [76, 64], [46, 84]].forEach(([w, h]) => { ctx.beginPath(); ctx.moveTo(x - w, base - 26); ctx.lineTo(x, base - 26 - h); ctx.lineTo(x + w, base - 26); ctx.closePath(); ctx.fill(); });
    ctx.fillRect(x - 2, base - 140, 4, 34);
    for (const sx of [-250, 250]) { ctx.beginPath(); ctx.moveTo(x + sx - 50, base); ctx.lineTo(x + sx, base - 44); ctx.lineTo(x + sx + 50, base); ctx.fill(); }
    ctx.fillStyle = 'rgba(255,200,110,.85)';
    for (let i = -6; i <= 6; i++) ctx.fillRect(x + i * 22 - 2, base - 18, 4, 7);
    ctx.restore();
  }

  function scene(t) {
    const g = ctx.createLinearGradient(0, 0, 0, RIVER);
    g.addColorStop(0, '#05061a'); g.addColorStop(0.7, '#141038'); g.addColorStop(1, '#2a1a4a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, RIVER);
    for (const [x, y, a, i] of stars) { ctx.globalAlpha = a * (0.7 + 0.3 * Math.sin(t / 700 + i)); ctx.fillStyle = '#fff'; ctx.fillRect(x, y, 2, 2); }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#081a33'; ctx.fillRect(0, RIVER, W, H - RIVER);
  }
  function foreground(t) {
    ctx.strokeStyle = 'rgba(133,183,235,.14)'; ctx.lineWidth = 1.5;
    for (let y = RIVER + 10; y < H; y += 14) { ctx.beginPath(); for (let x = -20; x <= W + 20; x += 20) { const yy = y + Math.sin(x / 35 + t / 700 + y) * 1.6; x === -20 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy); } ctx.stroke(); }
    drawPalace(W / 2);
    for (let i = 0; i < 9; i++) {
      const lx = ((i * 97 + t * 0.012) % (W + 60)) - 30, ly = RIVER + 30 + (i * 37) % 40;
      ctx.fillStyle = 'rgba(255,190,80,.9)'; ctx.beginPath(); ctx.arc(lx, ly, 2.4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#04040c';
    for (let i = 0; i < 40; i++) { const x = i * 21 + (i % 3) * 4, h = 10 + (i * 7) % 8; ctx.beginPath(); ctx.arc(x, H - h, 7, 0, Math.PI * 2); ctx.fill(); ctx.fillRect(x - 9, H - h, 18, h); }
  }

  function strokeLines(list, alpha) {
    ctx.save(); ctx.lineCap = ctx.lineJoin = 'round'; ctx.globalAlpha = alpha;
    for (const s of list) {
      ctx.strokeStyle = s.c; ctx.shadowColor = s.c; ctx.shadowBlur = 12; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(s.pts[0], s.pts[1]);
      if (s.pts.length === 2) ctx.lineTo(s.pts[0] + 0.1, s.pts[1]);
      for (let i = 2; i < s.pts.length; i += 2) ctx.lineTo(s.pts[i], s.pts[i + 1]);
      ctx.stroke();
    }
    ctx.restore();
  }

  // where each spark of the drawing is `e` ms after launch (and how bright)
  function dotAt(d, e) {
    if (e < RISE_MS + FORM_MS) { const u = easeOut((e - RISE_MS - d.d * 0.6) / FORM_MS); return [show.cx + (d.x - show.cx) * u, show.cy + (d.y - show.cy) * u, 1]; }
    if (e < HOLD_END_MS) return [d.x, d.y + (e - RISE_MS - FORM_MS) * 0.002, 0.65 + 0.35 * Math.sin(e / 90 + d.tw)];
    const f = (e - HOLD_END_MS) / 1000;
    return [d.x + Math.sin(d.tw) * 6 * f, d.y + 10 + 38 * f * f, Math.max(0, 1 - f / 2.5)];
  }

  function render() {
    const t = performance.now(), now = serverNow();
    scene(t);
    let label = 'GET READY', right = '';
    if (snap?.phase === 'show' || (snap?.phase === 'done' && show.built)) {
      const e = now - show.at;
      label = `FIREWORK ${show.i + 1}/${snap.n}`;
      right = snap.phase === 'show' ? `${Math.max(0, Math.ceil((show.at + snap.showMs - now) / 1000))}s` : '';
      if (show.built) {
        if (e < RISE_MS) {
          // the rocket climbs to the middle of the drawing
          const u = easeOut(e / RISE_MS);
          const x = W / 2 + (show.cx - W / 2) * u, y = LAUNCH_Y + (show.cy - LAUNCH_Y) * u;
          ctx.save(); ctx.strokeStyle = '#ffcf8a'; ctx.lineWidth = 3; ctx.globalAlpha = 0.7;
          ctx.beginPath(); ctx.moveTo(x - (show.cx - W / 2) * 0.06, y + 40); ctx.lineTo(x, y); ctx.stroke();
          ctx.globalAlpha = 1; ctx.fillStyle = '#fff'; ctx.shadowColor = show.color; ctx.shadowBlur = 16; ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        } else {
          if (!show.boomed) { show.boomed = true; boom(show.cx, show.cy, show.color); }
          ctx.save(); ctx.globalCompositeOperation = 'lighter';
          for (const mirror of [true, false]) {
            for (const d of show.dots) {
              const [x, y, a] = dotAt(d, e);
              if (a <= 0.01) continue;
              const yy = mirror ? 2 * RIVER - y : y;
              if (mirror && (y > RIVER || yy > H)) continue;
              ctx.globalAlpha = a * (mirror ? 0.2 : 1); ctx.fillStyle = d.c;
              ctx.beginPath(); ctx.arc(x, yy, 2.2, 0, Math.PI * 2); ctx.fill();
              if (!mirror) { ctx.globalAlpha = a * 0.25; ctx.beginPath(); ctx.arc(x, yy, 6, 0, Math.PI * 2); ctx.fill(); }
            }
          }
          ctx.restore();
        }
      } else if (snap?.phase === 'show') {
        ctx.font = MONO; ctx.textAlign = 'center'; ctx.fillStyle = C.muted; ctx.fillText('Loading the next firework…', W / 2, 220);
      }
    } else if (!snap || snap.phase === 'draw') {
      const left = snap ? Math.max(0, Math.ceil((snap.drawEnd - now) / 1000)) : 0;
      label = 'DRAW YOUR FIREWORK';
      right = `${snap ? `${snap.ready.length}/${snap.of} ready · ` : ''}${left}s`;
      strokeLines(live ? [...strokes, live] : strokes, 1);
      if (!strokes.length && !live) { ctx.font = '700 22px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(236,233,255,.35)'; ctx.fillText('Draw your firework here ✨', W / 2, 220); }
    }
    // burst sparks and flashes
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const s of sparks) { const k = 1 - s.age / s.life; ctx.globalAlpha = k; ctx.strokeStyle = s.hex; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(s.tx, s.ty); ctx.lineTo(s.x, s.y); ctx.stroke(); }
    for (const f of flashes) {
      const k = 1 - f.age / 0.3; const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r);
      g.addColorStop(0, `rgba(255,255,255,${k})`); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    foreground(t);
    const p = getParty();
    const total = snap && snap.phase !== 'draw' ? snap.showMs * Math.max(1, snap.n) : 0;
    drawHud(ctx, W, {
      left: label, right,
      progress: snap?.phase === 'draw' ? Math.min(1, Math.max(0, 1 - (snap.drawEnd - now) / ((snap.drawEnd - p.startAt) || 1)))
        : total ? Math.min(1, ((show.i * snap.showMs) + (now - show.at)) / total) : 0,
    });
  }

  return { onSnap, onMessage, update, render };
}

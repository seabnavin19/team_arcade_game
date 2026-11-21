// Water Festival Boat Race in the browser: the river at night with the Royal
// Palace at the finish, lanterns drifting by, the dragon boats, the drum ring
// and the big Paddle button.

import { COURSE, CREWS } from './boat.js';
import { C, MONO, drawHud, Particles } from '../games/draw.js';

const W = 800, H = 480, SKY = 64, BANK = 108;
const SCALE = 2.2;                 // pixels per metre of course
const MY_X = 250;                  // where your boat sits on screen
export const CREW_COLORS = ['#ff5a4d', '#3a86ff', '#ffd23f', '#c77dff'];
const SOLO_COLORS = ['#ff5a4d', '#3a86ff', '#ffd23f'];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function createBoatView({ ctx, panel, input, send, serverNow, getParty, getMe, sound, parts, floats }) {
  panel.innerHTML = `
    <div class="ta-boat-drum">
      <div class="ta-boat-ring" data-ring><i data-ringin></i></div>
      <div class="ta-boat-help"><b data-judge>Tap on the drum beat</b><span>On the beat = full stroke. Whole crew together = sync boost.</span></div>
    </div>
    <button class="ta-btn ta-boat-paddle" type="button" data-paddle>Paddle</button>
    <div class="ta-boat-stats"><span data-sync></span><span data-mystats></span></div>
    <ol class="ta-boat-standings" data-standings></ol>`;
  const $ = k => panel.querySelector(`[data-${k}]`);
  const el = { ring: $('ring'), ringIn: $('ringin'), judge: $('judge'), paddle: $('paddle'), sync: $('sync'), mine: $('mystats'), standings: $('standings') };

  let prev = null, cur = null, curAt = 0;
  const beats = new Set();
  let lastBeatPlayed = 0, flashUntil = 0, stretchUntil = 0, myStrokeAt = 0;
  const strokeAt = new Map();      // boat index → when it last stroked (for the paddle animation)
  const lanterns = Array.from({ length: 14 }, (_, i) => ({ x: (i * 173) % 2600 - 200, y: BANK + 30 + ((i * 97) % 330), s: 0.6 + (i % 3) * 0.25 }));
  const stars = Array.from({ length: 40 }, (_, i) => [(i * 211) % W, 6 + ((i * 53) % (SKY - 12)), 0.4 + (i % 4) * 0.2]);

  const myBoat = () => (cur ? cur.me?.[getMe()]?.[0] : undefined);
  const boatColor = b => (cur?.mode === 'crews' ? CREW_COLORS[b[4]] || C.cyan : SOLO_COLORS[b[0] % SOLO_COLORS.length]);

  function paddle() {
    if (getParty()?.status !== 'running') return;
    send({ type: 'paddle', t: Math.round(serverNow()) });
    myStrokeAt = performance.now();
  }
  el.paddle.addEventListener('pointerdown', e => { e.preventDefault(); paddle(); });
  input.on('pointerdown', () => paddle());                       // tapping the river works too
  input.on('keydown', e => { if (e.key === ' ' || e.key === 'Enter') paddle(); });

  function onResult(m) {
    const words = { 1: ['Perfect!', C.lime], 0.7: ['Good', C.cyan], 0.3: [m.q > 0 ? 'Off beat' : 'Miss', C.yellow], 0: ['Miss', C.red] };
    const [w, col] = words[m.q] || words[0];
    el.judge.textContent = w; el.judge.style.color = col;
    if (m.q === 1) sound.hit();
  }

  function onSnap(m) {
    prev = cur; cur = m; curAt = performance.now();
    for (const t of m.beats) beats.add(t);
    for (const e of m.events || []) {
      if (e.e === 'stroke') strokeAt.set(e.b, performance.now());
      if (e.e === 'stroke' && e.sync && e.b === myBoat()) floats.add(MY_X + 60, laneY(e.b) - 30, 'SYNC!', C.yellow);
      if (e.e === 'stretch') { stretchUntil = performance.now() + 2500; sound.go(); }
      if (e.e === 'finish') {
        const y = laneY(e.b);
        for (let i = 0; i < 4; i++) parts.burst(W - 120 + Math.random() * 80, SKY + Math.random() * 40, [C.yellow, C.magenta, C.cyan, C.lime][i], 24);
        if (e.b === myBoat()) { sound.end(); floats.add(MY_X, y - 30, 'FINISHED!', C.yellow); }
      }
    }
    // live standings under the river
    const order = [...m.boats].sort((a, b) => (a[3] && b[3] ? a[3] - b[3] : a[3] ? -1 : b[3] ? 1 : b[1] - a[1]));
    el.standings.innerHTML = order.map((b, i) => `<li class="${b[0] === myBoat() ? 'is-me' : ''}" style="--c:${boatColor(b)}"><span class="ta-place">${i + 1}</span><span class="ta-name">${esc(b[5])}</span><span class="ta-score">${b[3] ? `${(b[3] / 1000).toFixed(1)} s` : `${Math.round(b[1])} m`}</span></li>`).join('');
    const mine = m.me?.[getMe()];
    if (mine) {
      const boat = m.boats.find(b => b[0] === mine[0]);
      el.mine.textContent = `Your strokes: ${mine[1]} · ${mine[2]} on beat${mine[3] >= 3 ? ` · streak ${mine[3]}` : ''}`;
      el.sync.textContent = m.mode === 'crews' ? (boat?.[7] >= 2 ? `Crew in sync ×${boat[7]}` : 'Stroke together for a sync boost') : (mine[3] >= 4 ? 'Rhythm boost!' : '4 good strokes in a row = rhythm boost');
    }
  }

  const laneCount = () => Math.max(1, cur?.boats.length || 1);
  const laneY = i => BANK + 24 + ((H - BANK - 30) / laneCount()) * (i + 0.5);
  const boatX = b => {
    if (!b) return 0;
    const dt = Math.min(0.2, (performance.now() - curAt) / 1000);
    return Math.min(COURSE, b[1] + (b[3] ? 0 : b[2] * dt));
  };

  function drawBoat(x, y, col, name, me, stroking, syncN, members) {
    const len = 150, k = Math.max(0, 1 - (performance.now() - stroking) / 350);
    ctx.save(); ctx.translate(x, y);
    if (me) { ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(-len / 2 + 10, 4, len / 2 + 14, 16, 0, 0, Math.PI * 2); ctx.stroke(); }
    // wake
    ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-len - 10, 6); ctx.lineTo(-len - 50, 10); ctx.moveTo(-len - 10, 0); ctx.lineTo(-len - 40, -4); ctx.stroke();
    // hull
    ctx.fillStyle = col; ctx.beginPath();
    ctx.moveTo(-len, -2); ctx.quadraticCurveTo(-len / 2, 12, 6, -2); ctx.lineTo(10, -6); ctx.lineTo(-len - 6, -6); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(-len + 4, -6, len, 3);
    // dragon head and tail
    ctx.strokeStyle = col; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(4, -5); ctx.quadraticCurveTo(20, -14, 16, -28); ctx.stroke();
    ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(22, -30, 9, 6, -0.3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(24, -32, 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(-len - 4, -5); ctx.quadraticCurveTo(-len - 18, -18, -len - 8, -26); ctx.stroke();
    // paddlers
    const n = Math.max(3, Math.min(8, (members || 1) * 3));
    for (let i = 0; i < n; i++) {
      const px = -len + 18 + (i * (len - 30)) / n;
      ctx.fillStyle = '#f4e7d0'; ctx.beginPath(); ctx.arc(px, -11, 3.4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(244,231,208,.85)'; ctx.lineWidth = 2;
      const a = -0.6 + k * 1.1;
      ctx.beginPath(); ctx.moveTo(px, -8); ctx.lineTo(px - 14 * Math.cos(a), 10 + 8 * Math.sin(a)); ctx.stroke();
    }
    ctx.restore();
    ctx.save(); ctx.font = '700 12px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillStyle = me ? C.text : col; ctx.fillText(me ? `${name} (you)` : name, x - len / 2, y - 26);
    if (syncN >= 2) { ctx.fillStyle = C.yellow; ctx.font = MONO; ctx.fillText(`SYNC ×${syncN}`, x - len / 2, y - 42); }
    ctx.restore();
  }

  function drawPalace(x) {
    // a simple golden silhouette of tiered Khmer roofs on the far bank
    ctx.save(); ctx.fillStyle = '#e8b64a'; ctx.strokeStyle = '#e8b64a';
    const base = BANK - 4;
    ctx.fillRect(x - 70, base - 18, 140, 18);
    [[0, 70, 34], [0, 50, 52], [0, 30, 66]].forEach(([dx, w, h]) => {
      ctx.beginPath(); ctx.moveTo(x - w, base - 18); ctx.lineTo(x, base - h - 18); ctx.lineTo(x + w, base - 18); ctx.closePath(); ctx.globalAlpha = 0.85; ctx.fill();
    });
    ctx.globalAlpha = 1; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, base - 84); ctx.lineTo(x, base - 104); ctx.stroke();
    ctx.fillStyle = 'rgba(255,214,120,.9)';
    for (let i = -3; i <= 3; i++) ctx.fillRect(x + i * 18 - 3, base - 12, 6, 8);
    ctx.restore();
  }

  function render() {
    const now = serverNow(), t = performance.now();
    // drum: play the beat, shrink the ring toward the next one
    const sorted = [...beats].sort((a, b) => a - b);
    const next = sorted.find(b => b > now - 40);
    for (const b of sorted) if (b <= now && b > lastBeatPlayed) { lastBeatPlayed = b; flashUntil = t + 120; sound.tick(); }
    for (const b of sorted) if (b < now - 5000) beats.delete(b);
    const interval = cur?.interval || 600;
    const k = next ? Math.max(0, Math.min(1, (next - now) / interval)) : 1;
    el.ringIn.style.transform = `scale(${0.25 + 0.75 * k})`;
    el.ring.classList.toggle('is-beat', t < flashUntil);

    // sky, stars, far bank
    ctx.fillStyle = '#0b1030'; ctx.fillRect(0, 0, W, SKY + 30);
    for (const [x, y, a] of stars) { ctx.globalAlpha = a; ctx.fillStyle = '#fff'; ctx.fillRect(x, y, 2, 2); }
    ctx.globalAlpha = 1;
    const mine = cur?.boats.find(b => b[0] === myBoat()) || cur?.boats[0];
    const camX = Math.max(0, boatX(mine) - MY_X / SCALE);
    const sx = m => (m - camX) * SCALE;
    ctx.fillStyle = '#141a3d'; ctx.fillRect(0, SKY, W, BANK - SKY);
    for (let i = 0; i < 24; i++) { const bx = ((i * 97 - camX * SCALE * 0.4) % (W + 120) + W + 120) % (W + 120) - 60; ctx.fillStyle = '#1d2552'; ctx.fillRect(bx, BANK - 14 - (i % 5) * 7, 34, 14 + (i % 5) * 7); }
    drawPalace(sx(COURSE) + 40);

    // the river
    ctx.fillStyle = '#0d2f52'; ctx.fillRect(0, BANK, W, H - BANK);
    ctx.strokeStyle = 'rgba(133,183,235,.18)'; ctx.lineWidth = 1.5;
    for (let y = BANK + 18; y < H; y += 26) {
      ctx.beginPath();
      for (let x = -20; x <= W + 20; x += 20) { const yy = y + Math.sin((x + camX * SCALE) / 40 + t / 600) * 2.5; x === -20 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy); }
      ctx.stroke();
    }
    // lane lines and distance markers
    if (cur) for (let i = 1; i < laneCount(); i++) { const y = (laneY(i - 1) + laneY(i)) / 2; ctx.setLineDash([6, 10]); ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); ctx.setLineDash([]); }
    ctx.font = '700 11px system-ui, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.textAlign = 'center';
    for (let m = 100; m < COURSE; m += 100) { const x = sx(m); if (x > -20 && x < W + 20) { ctx.fillRect(x - 1, BANK + 4, 2, 10); ctx.fillText(`${m} m`, x, BANK + 26); } }
    // finish line
    const fx = sx(COURSE);
    if (fx < W + 40) { for (let y = BANK; y < H; y += 12) { ctx.fillStyle = (y / 12) % 2 ? '#fff' : '#e63946'; ctx.fillRect(fx - 3, y, 6, 12); } }
    // lanterns (Loy Pratip) drifting
    for (const l of lanterns) {
      const lx = ((l.x - camX * SCALE * 0.9 + t * 0.008 * l.s) % 2600 + 2600) % 2600 - 200;
      if (lx < -20 || lx > W + 20) continue;
      ctx.fillStyle = '#c99a5b'; ctx.fillRect(lx - 7, l.y, 14, 4);
      ctx.fillStyle = 'rgba(255,190,80,.9)'; ctx.beginPath(); ctx.arc(lx, l.y - 3 + Math.sin(t / 200 + l.x) * 0.8, 2.6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,190,80,.12)'; ctx.beginPath(); ctx.arc(lx, l.y - 2, 10, 0, Math.PI * 2); ctx.fill();
    }
    // boats
    if (cur) {
      for (const b of cur.boats) {
        const x = sx(boatX(b));
        drawBoat(x, laneY(b[0]), boatColor(b), b[5], b[0] === myBoat(), Math.max(strokeAt.get(b[0]) || 0, b[0] === myBoat() ? myStrokeAt : 0), b[7], b[6].length);
      }
    }
    parts.draw(ctx); floats.draw(ctx);
    if (t < stretchUntil) {
      ctx.save(); ctx.font = '900 italic 36px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = C.yellow; ctx.shadowColor = C.yellow; ctx.shadowBlur = 18;
      ctx.fillText('FINAL STRETCH!', W / 2, H / 2 - 10); ctx.font = MONO; ctx.shadowBlur = 0; ctx.fillStyle = C.text; ctx.fillText('the drum speeds up', W / 2, H / 2 + 20); ctx.restore();
    }
    // HUD
    const party = getParty();
    const order = cur ? [...cur.boats].sort((a, b) => (a[3] && b[3] ? a[3] - b[3] : a[3] ? -1 : b[3] ? 1 : b[1] - a[1])) : [];
    const place = order.findIndex(b => b[0] === myBoat()) + 1;
    const ord = n => `${n}${['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : Math.min(n % 10, 4) % 4] || 'th'}`;
    const secs = party ? Math.max(0, (now - party.startAt) / 1000) : 0;
    drawHud(ctx, W, {
      left: mine ? `${mine[3] ? `FINISHED ${(mine[3] / 1000).toFixed(1)}s` : `${Math.round(boatX(mine))} m`}  ${place ? ord(place) : ''}` : 'GET READY',
      right: `Tonle Sap · ${secs.toFixed(0)}s`,
      progress: mine ? boatX(mine) / COURSE : 0,
    });
  }

  return { onSnap, onResult, render, update() {} };
}

/** Lobby: crews as they'd be if the race started now, with buttons to switch. */
export function crewLobbyHtml(party, me, assignCrews) {
  const keys = party.players.map(p => p.key);
  const prefs = Object.fromEntries(party.players.map(p => [p.key, p.crew]));
  const plan = assignCrews(keys, prefs);
  if (!plan) return `<p class="ta-boat-solo">Fewer than 4 paddlers, so everyone races their own boat. From 4 players you race in crews.</p>`;
  const count = Math.max(...Object.values(plan)) + 1;
  return `<div class="ta-boat-crews">${Array.from({ length: count }, (_, c) => {
    const members = party.players.filter(p => plan[p.key] === c);
    const mine = plan[me] === c;
    return `<button type="button" class="ta-boat-crew${mine ? ' is-mine' : ''}" data-crew="${c}" style="--c:${CREW_COLORS[c]}">
      <b>${CREWS[c]}</b><span>${members.map(p => esc(p.key === me ? 'You' : p.name)).join(' · ') || '—'}</span>${mine ? '' : '<em>Tap to join</em>'}</button>`;
  }).join('')}</div>`;
}

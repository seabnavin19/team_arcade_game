// Night Market Duo in the browser. The server runs the stall 10 times a
// second and sends a snapshot each time; this draws it as tappable tiles.
//
// Cook:   tap a dish in the pantry (or press 1–3) to put it on a free burner,
//         tap a ready burner to move the dish to the counter.
// Server: tap a dish on the counter, then the customer who ordered it.

import { DISHES } from './market.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CUSTOMERS = ['🧑', '👩', '👨', '🧒', '👵', '👴', '🧑‍🦱', '👩‍🦰', '🧔', '👱'];

export function createMarketView(root, { send, serverNow, getMe, getParty, sound }) {
  root.innerHTML = `
    <div class="ta-mk">
      <div class="ta-mk-hud">
        <span>Tips <b data-mtips>$0</b></span>
        <span class="ta-mk-combo" data-mcombo></span>
        <span class="ta-quiz-time" data-mtime>1:30</span>
      </div>
      <div class="ta-quiz-bar"><i data-mbar></i></div>
      <div class="ta-mk-role" data-mrole>Get ready…</div>
      <div class="ta-mk-banner" data-mbanner hidden></div>
      <section class="ta-mk-zone" data-zone="server">
        <h4 class="ta-mk-h"><span>Customers</span><span class="ta-mk-who" data-mwho-server></span></h4>
        <div class="ta-mk-seats" data-mseats></div>
        <h4 class="ta-mk-h"><span>Counter</span><span class="ta-mk-hint" data-mhint-server></span></h4>
        <div class="ta-mk-counter" data-mcounter></div>
      </section>
      <section class="ta-mk-zone" data-zone="cook">
        <h4 class="ta-mk-h"><span>Burners</span><span class="ta-mk-who" data-mwho-cook></span></h4>
        <div class="ta-mk-burners" data-mburners></div>
        <div class="ta-mk-pantry" data-mpantry>
          ${DISHES.map((d, i) => `<button type="button" class="ta-mk-dish" data-act="cook" data-d="${i}"><span class="ta-mk-emoji">${d.emoji}</span><span>${esc(d.name)}</span><small>${(d.cook / 10).toFixed(1)}s · key ${i + 1}</small></button>`).join('')}
        </div>
      </section>
    </div>`;
  const $ = s => root.querySelector(`[data-${s}]`);
  const el = {
    tips: $('mtips'), combo: $('mcombo'), time: $('mtime'), bar: $('mbar'), role: $('mrole'), banner: $('mbanner'),
    seats: $('mseats'), counter: $('mcounter'), burners: $('mburners'), pantry: $('mpantry'),
    whoServer: $('mwho-server'), whoCook: $('mwho-cook'), hintServer: $('mhint-server'),
    zoneServer: root.querySelector('[data-zone=server]'), zoneCook: root.querySelector('[data-zone=cook]'),
  };
  let snap = null, selected = null, bannerUntil = 0, lastRole = null;
  const floats = new Map(); // seat → { text, until }

  const nameOf = key => getParty()?.players.find(p => p.key === key)?.name || '?';
  const myRole = () => (!snap ? null : snap.cook === getMe() ? 'cook' : snap.server === getMe() ? 'server' : null);

  function banner(text) { el.banner.textContent = text; el.banner.hidden = false; bannerUntil = performance.now() + 2200; }

  // pointerdown, not click: tiles are redrawn 10 times a second.
  root.addEventListener('pointerdown', e => {
    const b = e.target.closest('[data-act]');
    if (!b || !snap || b.disabled) return;
    e.preventDefault();
    const act = b.dataset.act, role = myRole();
    if (act === 'cook' && role === 'cook') { send({ type: 'cook', d: Number(b.dataset.d) }); sound.tick(); }
    if (act === 'plate' && role === 'cook') { send({ type: 'plate', b: Number(b.dataset.b) }); sound.tick(); }
    if (act === 'trash' && role === 'cook') send({ type: 'trash', b: Number(b.dataset.b) });
    if (act === 'pick' && role === 'server') { const c = Number(b.dataset.c); selected = selected === c ? null : c; sound.tick(); draw(); }
    if (act === 'toss' && role === 'server') { send({ type: 'toss', c: Number(b.dataset.c) }); if (selected === Number(b.dataset.c)) selected = null; }
    if (act === 'serve' && role === 'server') {
      const s = Number(b.dataset.s);
      if (selected === null) {
        // no dish picked yet: pick the first matching one on the counter for them
        const want = snap.seats[s]?.[0];
        const c = snap.counter.findIndex(d => d === want);
        if (c < 0) { floats.set(s, { text: 'Not cooked yet', until: performance.now() + 900, bad: true }); draw(); return; }
        selected = c;
      }
      send({ type: 'serve', c: selected, s });
      selected = null;
    }
  });
  window.addEventListener('keydown', e => {
    if (!snap || !root.isConnected || myRole() !== 'cook' || !/^[1-3]$/.test(e.key)) return;
    send({ type: 'cook', d: Number(e.key) - 1 }); sound.tick();
  });

  function onSnap(m) {
    const before = snap;
    snap = m;
    if (selected !== null && m.counter[selected] == null) selected = null;
    for (const ev of m.events || []) {
      if (ev.e === 'tip') { floats.set(ev.s, { text: `+$${ev.tip}`, until: performance.now() + 1100 }); sound.hit(); }
      if (ev.e === 'wrong') { floats.set(ev.s, { text: 'Wrong dish!', until: performance.now() + 900, bad: true }); sound.bad(); }
      if (ev.e === 'walk') { floats.set(ev.s, { text: 'Walked out 😤', until: performance.now() + 1200, bad: true }); sound.miss(); }
      if (ev.e === 'burn') sound.bad();
      if (ev.e === 'full') banner('The counter is full! Serve or toss a dish.');
      if (ev.e === 'swap') { banner('🔄 Swap! New jobs for the second half.'); sound.go(); }
      if (ev.e === 'rush') { banner('🛺 Rush hour! A tuk tuk full of customers.'); sound.go(); }
    }
    const role = myRole();
    if (role !== lastRole) { lastRole = role; selected = null; }
    if (!before) banner(role === 'cook' ? '🍳 You’re the cook first!' : role === 'server' ? '🛎️ You’re the server first!' : 'Watching the stall');
    draw();
  }

  function draw() {
    if (!snap) return;
    const role = myRole(), now = performance.now();
    const cookName = snap.cook === getMe() ? 'You' : nameOf(snap.cook);
    const serverName = snap.server === getMe() ? 'You' : snap.server ? nameOf(snap.server) : 'nobody';
    el.role.innerHTML = role === 'cook'
      ? '🍳 You’re the <b>cook</b>. Cook what customers ordered and tap ready dishes to plate them.'
      : role === 'server' ? '🛎️ You’re the <b>server</b>. Tap a customer to hand them their dish.'
      : `Watching ${esc(cookName)} and ${esc(serverName)}`;
    el.whoCook.textContent = `${cookName} ${cookName === 'You' ? 'cook' : 'cooks'}`;
    el.whoServer.textContent = `${serverName} ${serverName === 'You' ? 'serve' : 'serves'}`;
    el.zoneCook.classList.toggle('is-mine', role === 'cook');
    el.zoneServer.classList.toggle('is-mine', role === 'server');
    el.hintServer.textContent = role === 'server' ? (selected !== null ? 'Now tap the customer' : 'Tap a customer, or a dish first') : '';

    el.seats.innerHTML = snap.seats.map((c, s) => {
      const f = floats.get(s);
      const fl = f && f.until > now ? `<span class="ta-mk-float${f.bad ? ' is-bad' : ''}">${esc(f.text)}</span>` : '';
      if (!c) return `<div class="ta-mk-seat is-empty">${fl}<span class="ta-muted">empty</span></div>`;
      const [d, p, id] = c;
      const match = selected !== null && snap.counter[selected] === d;
      const col = p > 0.5 ? 'var(--lime)' : p > 0.25 ? 'var(--yellow)' : 'var(--red)';
      return `<button type="button" class="ta-mk-seat${match ? ' is-match' : ''}" data-act="serve" data-s="${s}" ${role !== 'server' ? 'disabled' : ''} aria-label="Customer wants ${esc(DISHES[d].name)}">
        ${fl}<span class="ta-mk-face"><span class="ta-mk-cust">${CUSTOMERS[id % CUSTOMERS.length]}</span><span class="ta-mk-order">${DISHES[d].emoji}</span></span>
        <span class="ta-mk-pat"><i style="width:${Math.round(p * 100)}%;background:${col}"></i></span></button>`;
    }).join('');

    el.counter.innerHTML = snap.counter.map((d, c) => (d == null
      ? '<div class="ta-mk-slot is-empty"></div>'
      : `<div class="ta-mk-slotwrap"><button type="button" class="ta-mk-slot${selected === c ? ' is-sel' : ''}" data-act="pick" data-c="${c}" ${role !== 'server' ? 'disabled' : ''} aria-label="${esc(DISHES[d].name)} on the counter">${DISHES[d].emoji}</button>${role === 'server' ? `<button type="button" class="ta-mk-x" data-act="toss" data-c="${c}" aria-label="Toss it">✕</button>` : ''}</div>`)).join('');

    el.burners.innerHTML = snap.burners.map((b, i) => {
      if (!b) return `<div class="ta-mk-burner is-empty"><span class="ta-muted">free</span></div>`;
      const [d, prog, burned, over] = b;
      if (burned) return `<button type="button" class="ta-mk-burner is-burned" data-act="trash" data-b="${i}" ${role !== 'cook' ? 'disabled' : ''}><span class="ta-mk-emoji">🔥</span><small>Burned!</small></button>`;
      const ready = prog >= 1;
      return `<button type="button" class="ta-mk-burner${ready ? ' is-ready' : ''}${ready && over > 0.6 ? ' is-hot' : ''}" data-act="plate" data-b="${i}" ${role !== 'cook' || !ready ? 'disabled' : ''}>
        <span class="ta-mk-emoji">${DISHES[d].emoji}</span><small>${ready ? (over > 0.6 ? 'Hurry!' : 'Ready, tap!') : 'Cooking…'}</small>
        <span class="ta-mk-pat"><i style="width:${Math.round(Math.min(1, ready ? 1 - over : prog) * 100)}%;background:${ready ? (over > 0.6 ? 'var(--red)' : 'var(--lime)') : 'var(--yellow)'}"></i></span></button>`;
    }).join('');

    const freeBurner = snap.burners.some(b => !b);
    el.pantry.querySelectorAll('[data-act=cook]').forEach(b => { b.disabled = role !== 'cook' || !freeBurner; });
    el.tips.textContent = `$${snap.tips.toLocaleString('en-US')}`;
    el.combo.innerHTML = snap.combo >= 3 ? `<b>${snap.combo} served in a row · tips x${snap.mult}</b>` : snap.rush ? '<b class="ta-warn">RUSH HOUR</b>' : '';
  }

  return {
    onSnap,
    update() {
      const party = getParty();
      if (!party) return;
      const left = Math.max(0, Math.ceil((party.endAt - serverNow()) / 1000));
      el.time.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
      el.bar.style.width = `${Math.min(100, (left / ((party.endAt - party.startAt) / 1000)) * 100)}%`;
      if (!el.banner.hidden && performance.now() > bannerUntil) el.banner.hidden = true;
    },
  };
}

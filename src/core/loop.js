// Fixed-step game loop: game logic runs at exactly 60 updates per second on
// any screen, and the clock stops while the browser tab is hidden.

export const STEP = 1 / 60;

export function createLoop({ update, render, raf = globalThis.requestAnimationFrame, caf = globalThis.cancelAnimationFrame, doc = globalThis.document }) {
  let id = 0, last = 0, acc = 0, running = false;

  function frame(ts) {
    if (!running) return;
    const dt = last ? Math.min((ts - last) / 1000, 0.25) : 0; // cap: no huge jump after a stall
    last = ts;
    acc += dt;
    while (acc >= STEP && running) { update(STEP); acc -= STEP; }
    if (running) { render(); id = raf(frame); }
  }
  const onVisibility = () => { last = 0; }; // don't count time spent hidden

  return {
    start() {
      if (running) return;
      running = true; last = 0; acc = 0;
      doc?.addEventListener?.('visibilitychange', onVisibility);
      id = raf(frame);
    },
    stop() {
      running = false;
      caf?.(id);
      doc?.removeEventListener?.('visibilitychange', onVisibility);
    },
  };
}

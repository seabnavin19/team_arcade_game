// Tiny synthesised sound effects (no audio files). Off by default.

const PREF = 'team-arcade.sound';

export function createSound(storage = globalThis.localStorage) {
  let ctx = null;
  let on = false;
  try { on = storage?.getItem(PREF) === 'on'; } catch { /* storage blocked */ }

  function tone(freq, dur = 0.08, type = 'square', vol = 0.06, slide = 0) {
    if (!on) return;
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      const t = ctx.currentTime;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(ctx.destination);
      o.start(t); o.stop(t + dur + 0.02);
    } catch { /* audio unavailable */ }
  }

  return {
    get on() { return on; },
    toggle() {
      on = !on;
      try { storage?.setItem(PREF, on ? 'on' : 'off'); } catch { /* ignore */ }
      if (on) tone(660, 0.06);
      return on;
    },
    hit: () => tone(880, 0.07, 'square', 0.05, 400),
    bad: () => tone(160, 0.18, 'sawtooth', 0.06, -60),
    miss: () => tone(220, 0.05, 'triangle', 0.04),
    tick: () => tone(520, 0.05, 'sine', 0.05),
    go: () => tone(990, 0.15, 'square', 0.05),
    boom: (big = false) => { tone(big ? 70 : 110, big ? 0.5 : 0.28, 'sawtooth', 0.07, -50); tone(big ? 1400 : 1800, 0.12, 'triangle', 0.025, -600); },
    fizz: () => tone(300, 0.25, 'sawtooth', 0.035, -220),
    end: () => { tone(660, 0.1); setTimeout(() => tone(880, 0.16), 110); },
  };
}

// Fitting a party game's 800 × 480 arena to whatever screen it's on.
//
// The arena is always the same size in game units, so every player shares it.
// What changes is how it's shown: scaled to fill the space, and — for games
// that allow it — turned sideways on an upright phone so it fills the tall
// screen. In that case the HUD strip (the top TOP units) stays at the top of
// the screen, and text is drawn the right way up with `upright`.

export const W = 800, H = 480, TOP = 60;

/** How to show the arena in a box of boxW × boxH CSS pixels. */
export function fitLayout(boxW, boxH, { rotate = false } = {}) {
  const portrait = rotate && boxH > boxW * 1.15;
  const sw = portrait ? H - TOP : W, sh = portrait ? W + TOP : H; // screen size in game units
  const css = Math.max(0.1, Math.min(boxW / sw, boxH / sh));      // CSS px per game unit
  return { portrait, sw, sh, css };
}

/** Game point → screen point (game units), and a 0–1 canvas position → game point. */
export function toScreen(view, x, y) { return view.portrait ? { sx: H - y, sy: x + TOP } : { sx: x, sy: y }; }
export function fromScreen(view, u, v) {
  const sx = u * view.sw, sy = v * view.sh;
  return view.portrait ? { x: sy - TOP, y: H - sx } : { x: sx, y: sy };
}

/** A direction the player pressed on screen → the arena direction (for arrow buttons). */
export function screenDir(view, d) {
  if (!view.portrait) return d;
  return { up: 'left', down: 'right', left: 'down', right: 'up' }[d] || d;
}

/** Drawing helpers bound to a canvas and a (live, mutable) view. */
export function createSpace(ctx, view) {
  const k = () => ctx.canvas.width / view.sw; // canvas pixels per game unit
  const space = {
    view,
    /** draw in arena coordinates */
    world() {
      const s = k();
      if (view.portrait) ctx.setTransform(0, s, -s, 0, s * H, s * TOP);
      else ctx.setTransform(s, 0, 0, s, 0, 0);
    },
    /** draw in screen coordinates (0..view.sw × 0..view.sh), never rotated */
    screen() { const s = k(); ctx.setTransform(s, 0, 0, s, 0, 0); },
    /** an arena point moved by (dx, dy) in *screen* directions */
    off(x, y, dx, dy) { return view.portrait ? [x + dy, y - dx] : [x + dx, y + dy]; },
    /** draw f() at an arena point, the right way up on screen */
    upright(x, y, f) { ctx.save(); ctx.translate(x, y); if (view.portrait) ctx.rotate(-Math.PI / 2); f(); ctx.restore(); },
    /** shared FloatText list (rises on screen, stays upright) */
    floats(list, font) {
      for (const f of list) {
        const [fx, fy] = space.off(f.x, f.y + 40 * f.age, 0, -40 * f.age); // FloatText moves y up; redo that in screen space
        space.upright(fx, fy, () => { ctx.globalAlpha = 1 - f.age / 0.8; ctx.font = font; ctx.textAlign = 'center'; ctx.fillStyle = f.color; ctx.fillText(f.text, 0, 0); });
      }
    },
  };
  return space;
}

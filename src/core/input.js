// Keyboard and pointer input for one game. While a game is open, its keys are
// captured before Confluence sees them (so arrows/space don't scroll the page
// and letters don't fire Confluence shortcuts).

const SWALLOW = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Spacebar', 'PageUp', 'PageDown', 'Home', 'End', 'Tab']);

export function createInput(canvas, { width, height, onEscape, captureAllKeys = true } = {}) {
  const keys = new Set();
  const listeners = { pointerdown: [], pointermove: [], pointerup: [], keydown: [] };
  const pointer = { x: width / 2, y: height / 2, inside: false };

  const toLogical = e => {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * width, y: ((e.clientY - r.top) / r.height) * height };
  };
  const onDown = e => {
    e.preventDefault();
    canvas.focus?.({ preventScroll: true });
    try { canvas.setPointerCapture?.(e.pointerId); } catch { /* not supported */ }
    Object.assign(pointer, toLogical(e), { inside: true, type: e.pointerType || 'mouse', down: true });
    listeners.pointerdown.forEach(f => f(pointer, e));
  };
  const onMove = e => {
    Object.assign(pointer, toLogical(e), { inside: true, type: e.pointerType || 'mouse' });
    listeners.pointermove.forEach(f => f(pointer, e));
  };
  const onUp = e => { pointer.down = false; listeners.pointerup.forEach(f => f(pointer, e)); };
  const onLeave = () => { if (!pointer.down) pointer.inside = false; };
  const onKeyDown = e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); onEscape?.(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return; // leave browser shortcuts alone
    if (captureAllKeys || SWALLOW.has(e.key)) e.stopImmediatePropagation();
    if (SWALLOW.has(e.key)) e.preventDefault();
    keys.add(e.key);
    listeners.keydown.forEach(f => f(e));
  };
  const onKeyUp = e => { keys.delete(e.key); if (captureAllKeys) e.stopImmediatePropagation(); };
  const onBlur = () => keys.clear();

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('blur', onBlur);

  return {
    keys, pointer,
    on(type, f) { listeners[type].push(f); },
    destroy() {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', onBlur);
      keys.clear();
    },
  };
}

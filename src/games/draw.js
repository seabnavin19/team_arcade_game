// Shared drawing helpers and palette for the canvas games.

export const C = {
  bg: '#0c0a1d', panel: '#15122e', text: '#ece9ff', muted: '#8d88b3',
  cyan: '#2de2e6', magenta: '#ff3d9a', yellow: '#ffd23f', lime: '#9cff57', red: '#ff4d4d',
};
export const MONO = '700 18px ui-monospace, "SF Mono", "Cascadia Mono", Consolas, monospace';

export function glowCircle(ctx, x, y, r, color, cross = false) {
  if (r <= 0) return;
  ctx.save();
  ctx.shadowColor = color; ctx.shadowBlur = 18;
  ctx.strokeStyle = color; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 0.18; ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1; ctx.lineWidth = 3;
  if (cross) {
    const k = r * 0.42;
    ctx.beginPath(); ctx.moveTo(x - k, y - k); ctx.lineTo(x + k, y + k); ctx.moveTo(x + k, y - k); ctx.lineTo(x - k, y + k); ctx.stroke();
  } else {
    ctx.beginPath(); ctx.arc(x, y, r * 0.55, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, Math.max(2, r * 0.16), 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

export function drawHud(ctx, width, { left, right, progress }) {
  ctx.save();
  ctx.fillStyle = 'rgba(12,10,29,0.92)'; ctx.fillRect(0, 0, width, 56);
  ctx.font = MONO; ctx.textBaseline = 'middle';
  ctx.fillStyle = C.text; ctx.textAlign = 'left'; ctx.fillText(left, 20, 26);
  ctx.textAlign = 'right'; ctx.fillStyle = C.yellow; ctx.fillText(right, width - 20, 26);
  ctx.fillStyle = 'rgba(141,136,179,0.25)'; ctx.fillRect(0, 52, width, 4);
  const g = ctx.createLinearGradient(0, 0, width, 0);
  g.addColorStop(0, C.cyan); g.addColorStop(1, C.magenta);
  ctx.fillStyle = g; ctx.fillRect(0, 52, width * (1 - progress), 4);
  ctx.restore();
}

export class Particles {
  constructor() { this.list = []; }
  burst(x, y, color, n = 16) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = 80 + Math.random() * 220;
      this.list.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.5 + Math.random() * 0.3, age: 0, color });
    }
  }
  update(dt) {
    for (const p of this.list) { p.age += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.94; p.vy *= 0.94; }
    this.list = this.list.filter(p => p.age < p.life);
  }
  draw(ctx) {
    for (const p of this.list) {
      ctx.globalAlpha = 1 - p.age / p.life; ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;
  }
}

export class FloatText {
  constructor() { this.list = []; }
  add(x, y, text, color) { this.list.push({ x, y, text, color, age: 0 }); }
  update(dt) { for (const f of this.list) { f.age += dt; f.y -= 40 * dt; } this.list = this.list.filter(f => f.age < 0.8); }
  draw(ctx) {
    ctx.save(); ctx.font = MONO; ctx.textAlign = 'center';
    for (const f of this.list) { ctx.globalAlpha = 1 - f.age / 0.8; ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, f.y); }
    ctx.restore();
  }
}

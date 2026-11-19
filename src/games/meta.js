// Facts about each game shared by the browser and the Telegram server:
// names, which way is better, how to show a score, and sane limits.

const fmtTime = s => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
const fmtPoints = s => Math.round(s).toLocaleString('en-US');

export const GAME_META = {
  shooter: { title: 'Drone Shooter', emoji: '🚀', better: 'higher', format: fmtPoints, min: 0, max: 400000, minSeconds: 15 },
  reaction: { title: 'Reaction Tap', emoji: '⚡', better: 'higher', format: fmtPoints, min: 0, max: 25000, minSeconds: 29 },
  memory: { title: 'Memory Match', emoji: '🧠', better: 'lower', format: fmtTime, min: 4, max: 3600, minSeconds: 4 },
  typing: { title: 'Typing Race', emoji: '⌨️', better: 'higher', format: s => `${Math.round(s)} wpm`, min: 0, max: 200, minSeconds: 8 },
};
export const GAME_IDS = Object.keys(GAME_META);

/** Server-side check of a submitted run. Returns null if fine, else a reason. */
export function checkRun(game, score, meta, seconds) {
  const m = GAME_META[game];
  if (!m) return 'Unknown game.';
  if (typeof score !== 'number' || !Number.isFinite(score)) return 'Invalid score.';
  if (score < m.min || score > m.max) return "That score is outside what's possible, so it wasn't saved.";
  if (seconds < m.minSeconds) return 'That run was too quick to be real, so it wasn\'t saved.';
  if (game === 'typing' && !(meta && meta.accuracy >= 90)) return 'Runs need 90% accuracy or more to be ranked.';
  return null;
}

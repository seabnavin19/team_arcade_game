// Turns stored boards into ranked lists and Champion points.

export const PLACE_POINTS = [10, 8, 6, 5, 4, 3, 2, 1];

export function rankBoard(board, better) {
  const rows = Object.entries(board?.entries || {}).map(([key, e]) => ({ key, ...e }));
  rows.sort((a, b) =>
    a.score === b.score
      ? String(a.at).localeCompare(String(b.at))
      : better === 'lower' ? a.score - b.score : b.score - a.score);
  let place = 0;
  return rows.map((r, i) => {
    if (i === 0 || r.score !== rows[i - 1].score) place = i + 1;
    return { ...r, place, points: PLACE_POINTS[place - 1] || 0 };
  });
}

/** ranked: { [gameId]: rankBoard(...) } -> ranked champion list */
export function championBoard(ranked) {
  const totals = new Map();
  for (const [game, rows] of Object.entries(ranked)) {
    for (const r of rows) {
      const t = totals.get(r.key) || { key: r.key, name: r.name, score: 0, games: {} };
      t.score += r.points;
      t.games[game] = r.place;
      t.name = r.name;
      totals.set(r.key, t);
    }
  }
  const rows = [...totals.values()].filter(r => r.score > 0).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  let place = 0;
  return rows.map((r, i) => {
    if (i === 0 || r.score !== rows[i - 1].score) place = i + 1;
    return { ...r, place };
  });
}

// Builds dist/party-demo.html: every party game against bot players, running the real
// game server in the page. Open it with #battle, #snake, #reaction, #quiz, #boat, #firework, #draw, #sync or #market.
import { build } from 'esbuild';
import { writeFileSync, mkdirSync } from 'node:fs';

const out = await build({ entryPoints: ['dev/party-demo-entry.js'], bundle: true, format: 'esm', write: false, loader: { '.css': 'text' } });
mkdirSync('dist', { recursive: true });
writeFileSync('dist/party-demo.html', `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Team Arcade · Party games preview</title></head><body><div id="team-arcade"></div>
<script type="module">${out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script></body></html>`);
console.log('built dist/party-demo.html (open with #battle, #snake, … or no hash for a picker)');

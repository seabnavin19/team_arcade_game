// Builds dist/duo-demo.html: Duo Mode with a bot partner, for trying the
// screens locally. Open it with ?game=sync or ?game=market.
import { build } from 'esbuild';
import { writeFileSync, mkdirSync } from 'node:fs';

const out = await build({ entryPoints: ['dev/duo-demo-entry.js'], bundle: true, format: 'esm', write: false, loader: { '.css': 'text' } });
mkdirSync('dist', { recursive: true });
writeFileSync('dist/duo-demo.html', `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Team Arcade · Duo Mode preview</title></head><body><div id="team-arcade"></div>
<script type="module">${out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script></body></html>`);
console.log('built dist/duo-demo.html (open with ?game=sync or ?game=market)');

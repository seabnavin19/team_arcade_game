// Builds dist/firework-demo.html: the Firework Show with bot players, for trying the
// screens locally. Add ?bots=5 for more bots.
import { build } from 'esbuild';
import { writeFileSync, mkdirSync } from 'node:fs';

const out = await build({ entryPoints: ['dev/firework-demo-entry.js'], bundle: true, format: 'esm', write: false, loader: { '.css': 'text' } });
mkdirSync('dist', { recursive: true });
writeFileSync('dist/firework-demo.html', `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Team Arcade · Water Festival Firework Show (demo)</title></head><body><div id="team-arcade"></div>
<script type="module">${out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script></body></html>`);
console.log('built dist/firework-demo.html');

// Builds dist/battle-demo.html: Ship Battle with bot ships and pretend lag, for trying the
// screens locally. Open it with ?lag=150 (round-trip ms).
import { build } from 'esbuild';
import { writeFileSync, mkdirSync } from 'node:fs';

const out = await build({ entryPoints: ['dev/battle-demo-entry.js'], bundle: true, format: 'esm', write: false, loader: { '.css': 'text' } });
mkdirSync('dist', { recursive: true });
writeFileSync('dist/battle-demo.html', `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Team Arcade · Ship Battle preview</title></head><body><div id="team-arcade"></div>
<script type="module">${out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script></body></html>`);
console.log('built dist/battle-demo.html (open with ?lag=150)');

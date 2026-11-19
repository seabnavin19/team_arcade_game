import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['chrome100', 'firefox100', 'edge100', 'safari15'],
  loader: { '.css': 'text' },
  banner: { js: `/* Team Arcade v${pkg.version} · built ${new Date().toISOString()} */` },
  outfile: 'dist/arcade.js',
});

// Paste this into the Confluence HTML macro. It loads arcade.js from this
// page's own attachments, so nothing comes from the internet.
writeFileSync('dist/loader-snippet.html', `<div id="team-arcade">Loading Team Arcade…</div>
<script>
(function () {
  var A = window.AJS || {};
  var pageId = (A.Meta && A.Meta.get && A.Meta.get('page-id')) || '';
  var ctx = (A.contextPath && A.contextPath()) || '';
  if (!pageId) { document.getElementById('team-arcade').textContent = 'Team Arcade loads on the published page.'; return; }
  var s = document.createElement('script');
  // the hourly ?v= makes a newly uploaded arcade.js show up within an hour
  s.src = ctx + '/download/attachments/' + pageId + '/arcade.js?v=' + Math.floor(Date.now() / 3600000);
  s.onerror = function () { document.getElementById('team-arcade').textContent = 'Team Arcade: arcade.js is not attached to this page yet.'; };
  document.body.appendChild(s);
})();
</script>
`);
console.log('built dist/arcade.js', (readFileSync('dist/arcade.js').length / 1024).toFixed(1), 'KB');

// A self-contained preview (fake Confluence inside) for trying the arcade anywhere.
const demo = await build({
  entryPoints: ['dev/demo-entry.js'], bundle: true, minify: true, format: 'esm', write: false,
  target: ['chrome100', 'firefox100', 'edge100', 'safari15'], loader: { '.css': 'text' },
});
writeFileSync('dist/demo.html', `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Team Arcade · preview</title><meta name="ajs-page-id" content="98765">
<style>body{margin:0;padding:24px;background:#fff;font:14px/1.5 -apple-system,"Segoe UI",Roboto,sans-serif;color:#172b4d}
.demo-note{max-width:1040px;margin:0 0 12px;padding:10px 14px;background:#deebff;border-radius:6px}</style></head>
<body><p class="demo-note"><b>Preview.</b> This runs on a pretend Confluence. Scores are kept in this browser only, and the three "Sample player" entries are made up so the board isn't empty.</p>
<div id="team-arcade"></div>
<script type="module">${demo.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script></body></html>
`);
console.log('built dist/demo.html');

// ---- Telegram version → site/ (published to GitHub Pages)
mkdirSync('site/confluence', { recursive: true });
await build({
  entryPoints: ['src/telegram-main.js'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['chrome90', 'firefox90', 'edge90', 'safari14', 'ios14'],
  loader: { '.css': 'text' },
  banner: { js: `/* Team Arcade (Telegram) v${pkg.version} */` },
  outfile: 'site/arcade-telegram.js',
});
copyFileSync('web/index.html', 'site/index.html');
if (existsSync('web/cover.png')) copyFileSync('web/cover.png', 'site/cover.png');
// The Confluence files are published too, so they're easy to download.
for (const f of ['arcade.js', 'loader-snippet.html', 'demo.html']) copyFileSync(`dist/${f}`, `site/confluence/${f}`);
writeFileSync('site/.nojekyll', '');
console.log('built site/ (Telegram version + Confluence downloads)');

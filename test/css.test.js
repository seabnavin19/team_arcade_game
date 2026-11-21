import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// A missing "}" silently turns every rule after it into a phone-only rule
// (this happened once after a merge), so check the braces balance.
describe('arcade.css', () => {
  it('has no unclosed blocks', () => {
    const css = readFileSync(new URL('../src/ui/arcade.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    let depth = 0, line = 1, worst = null;
    for (const ch of css) {
      if (ch === '\n') line++;
      if (ch === '{') depth++;
      if (ch === '}') depth--;
      if (depth < 0 && worst === null) worst = line;
    }
    expect(worst, 'a "}" with no matching "{"').toBeNull();
    expect(depth, 'blocks left open at the end of the file').toBe(0);
  });
  it('keeps media-query blocks short (game styles must not end up inside one)', () => {
    const css = readFileSync(new URL('../src/ui/arcade.css', import.meta.url), 'utf8');
    for (const m of css.matchAll(/@media[^{]*\{/g)) {
      let depth = 1, i = m.index + m[0].length, rules = 0;
      while (depth && i < css.length) { if (css[i] === '{') { depth++; rules++; } if (css[i] === '}') depth--; i++; }
      expect(rules, `@media at offset ${m.index} wraps ${rules} rules`).toBeLessThan(25);
    }
  });
});

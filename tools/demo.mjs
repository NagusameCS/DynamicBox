// Builds demo/index.html: the demo as one file that opens from a file:// URL.
//
// A module imported over file:// is blocked by the browser's origin rules, so a demo
// that imports src/dynamicbox.mjs only works behind a server. Inlining the library
// instead means the demo is a thing you can double-click, which is the difference
// between a demo that gets read and one that does not. It also proves the module's
// side of the bargain: it can be concatenated into a page with nothing to resolve.
//
//   node tools/demo.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const library = readFileSync(join(ROOT, 'src', 'dynamicbox.mjs'), 'utf8');
const app = readFileSync(join(ROOT, 'demo', 'app.js'), 'utf8');
const template = readFileSync(join(ROOT, 'demo', 'page.html'), 'utf8');

// A literal string inside the module would end the script element early, and the
// failure would be a page that half-works rather than an error anyone can read.
for (const [name, source] of [['library', library], ['app', app]]) {
  if (source.includes('</script')) throw new Error('tools/demo.mjs: ' + name + ' contains a script end tag');
}

for (const marker of ['/*INLINE_LIBRARY*/', '/*INLINE_APP*/']) {
  if (!template.includes(marker)) throw new Error('tools/demo.mjs: demo/page.html is missing ' + marker);
}

// Replacement functions, not strings: a dollar sign in the source would otherwise be
// read as a capture reference by String.replace and quietly corrupt the output.
const out = template
  .replace('/*INLINE_LIBRARY*/', () => library)
  .replace('/*INLINE_APP*/', () => app);

if (out.includes('/*INLINE_')) throw new Error('tools/demo.mjs: a marker survived the build');

const target = join(ROOT, 'demo', 'index.html');
writeFileSync(target, out);
process.stdout.write('demo: ' + target + ' (' + (out.length / 1024).toFixed(1) + ' KB, library inlined)\n');

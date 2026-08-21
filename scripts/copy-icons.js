/**
 * Copy node icons into dist.
 *
 * tsc only emits JavaScript, but n8n resolves `icon: 'file:slide.svg'` relative
 * to the COMPILED node file. Without this the package builds and loads fine and
 * every node renders with a broken image — a failure that never surfaces in a
 * typecheck or a unit test, only in the editor.
 */
const fs = require('fs');
const path = require('path');

let copied = 0;
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const from = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(from); continue; }
    if (!/\.(svg|png)$/.test(entry.name)) continue;
    const to = path.join('dist', from);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    copied++;
  }
};

walk('nodes');
console.log(`copied ${copied} icon(s) into dist/`);

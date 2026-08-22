/**
 * Validate and copy node icons AND codex metadata into dist.
 *
 * tsc emits JavaScript only, but n8n resolves `icon: 'file:slide.svg'` relative
 * to the COMPILED node file. Without the copy step the package builds, loads,
 * and renders every node with a broken image.
 *
 * The validation exists because a broken icon shipped once: an XML comment
 * contained "--accent" (a CSS variable name), and XML forbids "--" inside
 * comments. n8n served the file with 200 OK, the browser's parser aborted, and
 * the node showed a broken-image placeholder. Nothing in the build, the linter,
 * the tests, or n8n's own scanner catches that — so it is checked here.
 */
const fs = require('fs');
const path = require('path');

/** Minimal XML well-formedness checks aimed at the ways an SVG realistically breaks. */
function validateSvg(file, xml) {
  const problems = [];

  for (const [, body] of xml.matchAll(/<!--([\s\S]*?)-->/g)) {
    if (body.includes('--')) {
      const line = body.split('\n').find((l) => l.includes('--')) || '';
      problems.push(`XML comments may not contain "--": ${line.trim()}`);
    }
  }

  if (!/^\s*<svg[\s>]/.test(xml)) problems.push('does not start with an <svg> element');
  if (!xml.includes('xmlns="http://www.w3.org/2000/svg"')) problems.push('missing the SVG xmlns');
  if (!/<\/svg>\s*$/.test(xml)) problems.push('does not end with </svg>');

  // Unbalanced angle brackets catch most truncation and bad string surgery.
  const opens = (xml.match(/</g) || []).length;
  const closes = (xml.match(/>/g) || []).length;
  if (opens !== closes) problems.push(`unbalanced angle brackets (${opens} "<" vs ${closes} ">")`);

  return problems;
}

let copied = 0;
const failures = [];

(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const from = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(from); continue; }
    // Icons AND codex metadata both have to reach dist/.
    if (!/\.(svg|png|node\.json)$/.test(entry.name)) continue;

    if (entry.name.endsWith('.node.json')) {
      // A malformed codex is silently ignored by n8n, so fail the build instead.
      try {
        JSON.parse(fs.readFileSync(from, 'utf8'));
      } catch (err) {
        failures.push(`${from}: invalid JSON — ${err.message}`);
        continue;
      }
    }

    if (entry.name.endsWith('.svg')) {
      const problems = validateSvg(from, fs.readFileSync(from, 'utf8'));
      if (problems.length) { failures.push(`${from}: ${problems.join('; ')}`); continue; }
    }

    const to = path.join('dist', from);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    copied++;
  }
})('nodes');

if (failures.length) {
  console.error('Invalid asset(s) — refusing to build:\n  ' + failures.join('\n  '));
  process.exit(1);
}

console.log(`validated and copied ${copied} icon/codex file(s) into dist/`);

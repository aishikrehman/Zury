const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// The trimmed icon font (scripts/build-assets.js) must have every icon the code names.
test('trimmed assets are up to date: run npm run build:assets after adding icons', () => {
  const css = fs.readFileSync(path.join(ROOT, 'public/icons/tabler-icons.css'), 'utf8');
  const have = new Set([...css.matchAll(/\.ti-([a-z0-9-]+):before/g)].map((m) => m[1]));
  const files = [];
  const walk = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(ejs|js)$/.test(e.name)) files.push(full);
    });
  walk(path.join(ROOT, 'src'));
  walk(path.join(ROOT, 'public/js'));
  const named = new Set();
  for (const f of files) for (const m of fs.readFileSync(f, 'utf8').matchAll(/['" ]ti ti-([a-z0-9]+(?:-[a-z0-9]+)*)['" ]/g)) named.add(m[1]);
  const { PROJECTS } = require('../src/utils/projectStyle');
  for (const p of Object.values(PROJECTS)) named.add(p.icon);
  const missing = [...named].filter((n) => !have.has(n));
  assert.deepEqual(missing, []);
  assert.ok(fs.statSync(path.join(ROOT, 'public/css/tabler.css')).size < 400 * 1024, 'Tabler CSS is the trimmed one');
});

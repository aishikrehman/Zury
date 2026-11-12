// Builds the one stylesheet, public/css/style.css, and the icon font. Run after changing
// views, scripts or src/styles/zury.css: npm run build:assets
//   style.css = fonts (Inter, Noto Serif Bengali) + @tabler/core trimmed to the classes the code
//               uses + src/styles/zury.css (its unused rules dropped too)
//   public/icons/icons.css + tabler-icons.woff2 = only the icons the code names
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// ── Words used in the code: views, scripts and server code (class names are built there too) ──
function sourceFiles(dir, exts) {
  const out = [];
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...sourceFiles(rel, exts));
    else if (exts.some((x) => e.name.endsWith(x))) out.push(rel);
  }
  return out;
}
const SOURCES = [...sourceFiles('src', ['.ejs', '.js']), ...sourceFiles('public/js', ['.js'])];
const text = SOURCES.map(read).join('\n');
const words = new Set(text.match(/[A-Za-z0-9_-]+/g));
// Classes made from pieces, e.g. bg-<%= color %>-lt or `btn-${kind}`: keep every class with that start.
const dynamicPrefixes = [...new Set([...text.matchAll(/([a-z][a-z0-9-]*-)(?:<%[=-]|\$\{|'\s*\+|"\s*\+)/g)].map((m) => m[1]))];
// Classes that Bootstrap's and Tabler's scripts add or need at run time.
const RUNTIME = ['show', 'showing', 'hiding', 'collapsing', 'collapse', 'fade', 'active', 'disabled', 'dropdown-menu-end', 'dropdown-menu-start', 'dropstart', 'dropend', 'dropup',
  'modal', 'modal-open', 'modal-backdrop', 'modal-static', 'offcanvas', 'offcanvas-backdrop', 'tooltip', 'tooltip-inner', 'tooltip-arrow', 'bs-tooltip-auto', 'popover', 'is-invalid', 'is-valid', 'was-validated',
  'focus', 'input-active', 'has-items', 'single', 'multi', 'ts-wrapper', 'ts-control', 'ts-dropdown', 'form-select', 'form-control', 'plugin-remove_button', 'tab-pane', 'nav-link'];
const runtimePrefixes = ['bs-', 'apexcharts', 'ts-', 'tooltip', 'popover', 'offcanvas', 'modal'];
const used = (cls) => words.has(cls) || RUNTIME.includes(cls) || dynamicPrefixes.some((p) => cls.startsWith(p)) || runtimePrefixes.some((p) => cls.startsWith(p));

// ── A small CSS reader: rules and at-rules, nested as written ──
function parse(css) {
  let i = 0;
  const skipComment = () => {
    if (css.startsWith('/*', i)) {
      const end = css.indexOf('*/', i + 2);
      i = end < 0 ? css.length : end + 2;
      return true;
    }
    return false;
  };
  function block() {
    const nodes = [];
    let buf = '';
    while (i < css.length) {
      if (skipComment()) continue;
      const c = css[i];
      if (c === '"' || c === "'") {
        const q = c;
        let j = i + 1;
        while (j < css.length && css[j] !== q) j += css[j] === '\\' ? 2 : 1;
        buf += css.slice(i, j + 1);
        i = j + 1;
        continue;
      }
      if (c === '{') {
        i += 1;
        const head = buf.trim();
        buf = '';
        if (/^@(media|supports|layer|container|document)\b/.test(head)) nodes.push({ type: 'group', head, children: block() });
        else {
          // A declaration block (keep it as written), possibly with nested blocks (@keyframes).
          let depth = 1;
          const start = i;
          while (i < css.length && depth) {
            if (skipComment()) continue;
            if (css[i] === '{') depth += 1;
            else if (css[i] === '}') depth -= 1;
            i += 1;
          }
          nodes.push({ type: head.startsWith('@') ? 'at' : 'rule', head, body: css.slice(start, i - 1) });
        }
        continue;
      }
      if (c === '}') {
        i += 1;
        return nodes;
      }
      if (c === ';' && buf.trim().startsWith('@')) {
        nodes.push({ type: 'statement', head: buf.trim() });
        buf = '';
        i += 1;
        continue;
      }
      buf += c;
      i += 1;
    }
    return nodes;
  }
  return block();
}

// Splits "a, b:is(c, d)" at top-level commas only.
function splitSelectors(sel) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of sel) {
    if (ch === '(' || ch === '[') depth += 1;
    if (ch === ')' || ch === ']') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

const classesIn = (sel) => [...sel.replace(/:(not|where|is|has)\([^)]*\)/g, '').matchAll(/\.((?:\\.|[A-Za-z0-9_-])+)/g)].map((m) => m[1].replace(/\\/g, ''));

// Keeps the rules whose classes all appear in the code; counts what it keeps and drops.
function trim(nodes, stats) {
  let out = '';
  for (const n of nodes) {
    if (n.type === 'statement') out += `${n.head};`;
    else if (n.type === 'at') out += `${n.head}{${n.body}}`;
    else if (n.type === 'group') {
      const inner = trim(n.children, stats);
      if (inner) out += `${n.head}{${inner}}`;
    } else {
      const sels = splitSelectors(n.head).filter((s) => classesIn(s).every(used));
      if (sels.length) {
        stats.kept += 1;
        out += `${sels.join(',')}{${n.body.trim()}}`;
      } else stats.dropped += 1;
    }
  }
  return out;
}

const squeeze = (css) => css
  .replace(/\/\*[^]*?\*\//g, '')
  .replace(/\s*\n\s*/g, ' ')
  .replace(/;\s*}/g, '}')
  .replace(/\s*([{};,>])\s*/g, '$1')
  .trim();

function build(file, label) {
  const source = read(file);
  const stats = { kept: 0, dropped: 0 };
  const out = squeeze(trim(parse(source), stats));
  console.log(`${label}: ${Math.round(source.length / 1024)} KB → ${Math.round(out.length / 1024)} KB (${stats.kept} rules kept, ${stats.dropped} dropped)`);
  return out;
}

// Self-hosted fonts; their files are served from /vendor/<name>/files.
function fonts() {
  return [['inter', 'inter', 'index.css'], ['noto-bengali', 'noto-serif-bengali', 'wght.css']]
    .map(([at, pkg, file]) => squeeze(read(`node_modules/@fontsource-variable/${pkg}/${file}`).replace(/url\(\.\/files\//g, `url(/vendor/${at}/files/`)))
    .join('');
}

// ── Icons: only the ones named in the code, in a small font of their own ──
async function icons() {
  const subsetFont = require('subset-font');
  const dist = path.join(ROOT, 'node_modules/@tabler/icons-webfont/dist');
  const css = fs.readFileSync(path.join(dist, 'tabler-icons.min.css'), 'utf8');
  const all = [...css.matchAll(/\.ti-([a-z0-9-]+):before\{content:"\\([0-9a-f]+)"\}/g)].map((m) => ({ name: m[1], code: m[2] }));
  const keep = all.filter((i) => words.has(i.name) || words.has(`ti-${i.name}`));
  const font = await subsetFont(fs.readFileSync(path.join(dist, 'fonts/tabler-icons.woff2')), keep.map((i) => String.fromCodePoint(parseInt(i.code, 16))).join(''), { targetFormat: 'woff2' });
  fs.mkdirSync(path.join(ROOT, 'public/icons'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'public/icons/tabler-icons.woff2'), font);
  console.log(`icons: ${all.length} → ${keep.length} (${Math.round(font.length / 1024)} KB font)`);
  const base = css.slice(css.indexOf('.ti{'), css.indexOf('}', css.indexOf('.ti{')) + 1);
  return '@font-face{font-family:"tabler-icons";font-style:normal;font-weight:400;font-display:block;src:url("/icons/tabler-icons.woff2?v=' + require('crypto').createHash('md5').update(font).digest('hex').slice(0, 8) + '") format("woff2")}'
    + base + keep.map((i) => `.ti-${i.name}:before{content:"\\${i.code}"}`).join('');
}

async function main() {
  // Only the short licence notice that the MIT and OFL licences require in copies; never shown on a page.
  const banner = '/*! Built from src/styles/zury.css by scripts/build-assets.js; edit that, not this. Contains MIT-licensed code (c) codecalm and OFL-licensed fonts. */\n';
  const style = banner + fonts() + build('node_modules/@tabler/core/dist/css/tabler.css', 'tabler') + build('src/styles/zury.css', 'zury');
  // Icons keep a stylesheet of their own next to their font.
  fs.writeFileSync(path.join(ROOT, 'public/icons/icons.css'), `/*! Tabler Icons, MIT licence. Built by scripts/build-assets.js. */\n${await icons()}`);
  fs.writeFileSync(path.join(ROOT, 'public/css/style.css'), style);
  console.log(`style.css: ${Math.round(style.length / 1024)} KB`);
}

module.exports = { words, used };

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

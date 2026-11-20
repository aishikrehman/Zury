// Every address Zury answers, read from its own routers (so nothing is left out, hidden ones too).
// Used by Admin › Links. Event pages come from the event router and are shown after an event's address.
const MODULES = ['notifications', 'preferences', 'index', 'auth', 'users', 'account', 'api', 'admin', 'chat', 'events'];

function routesOf(router) {
  const out = [];
  for (const layer of router.stack || []) {
    if (!layer.route) continue;
    const path = typeof layer.route.path === 'string' ? layer.route.path : String(layer.route.path);
    const methods = Object.keys(layer.route.methods).filter((m) => layer.route.methods[m]).map((m) => m.toUpperCase());
    for (const p of Array.isArray(layer.route.path) ? layer.route.path : [path]) out.push({ path: String(p), methods });
  }
  return out;
}

// Readable form: /tools/tracking/:id(\d+) -> /tools/tracking/:id
const tidy = (p) => p.replace(/\(\\\\?[^)]*\)/g, '').replace(/\([^)]*\)/g, '');

let cached = null;
function all() {
  if (cached) return cached;
  const site = [];
  for (const name of MODULES) {
    const r = require(`../routes/${name === 'index' ? 'index' : name}`);
    for (const x of routesOf(r)) site.push({ ...x, path: tidy(x.path) });
  }
  const eventRouter = require('../routes/events').eventRouter;
  const event = eventRouter ? routesOf(eventRouter).map((x) => ({ ...x, path: tidy(x.path) })) : [];
  // One row per address, its methods together.
  const merge = (list) => {
    const m = new Map();
    for (const x of list) { const e = m.get(x.path) || { path: x.path, methods: new Set() }; x.methods.forEach((k) => e.methods.add(k)); m.set(x.path, e); }
    return [...m.values()].map((e) => ({ path: e.path, methods: [...e.methods].sort(), open: e.methods.has('GET') && !e.path.includes(':') })).sort((a, b) => a.path.localeCompare(b.path));
  };
  const group = (list) => {
    const g = new Map();
    for (const x of list) { const k = x.path.split('/')[1] || '/'; if (!g.has(k)) g.set(k, []); g.get(k).push(x); }
    return [...g.entries()];
  };
  cached = { site: group(merge(site)), event: merge(event) };
  return cached;
}

module.exports = { all };

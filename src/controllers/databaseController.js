// A read-only look at the database for superusers: every table, its row count, and its rows
// page by page. Nothing here writes. Sessions are left out: they hold people's logins.
const { Prisma } = require('@prisma/client');
const prisma = require('../config/prisma');

const HIDDEN = new Set(['Session']);
const PER_PAGE = 50;

const models = () => Prisma.dmmf.datamodel.models.filter((m) => !HIDDEN.has(m.name));
const delegate = (name) => prisma[name.charAt(0).toLowerCase() + name.slice(1)];

// Shown as text, cut short so a page stays light.
function cell(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().replace('T', ' ').slice(0, 19);
  const s = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return s.length > 200 ? `${s.slice(0, 200)}…` : s;
}

async function index(req, res, next) {
  try {
    const list = models();
    const counts = await Promise.all(list.map((m) => delegate(m.name).count()));
    const tables = list.map((m, i) => ({ name: m.name, rows: counts[i] }));
    const name = String(req.query.table || '');
    const model = list.find((m) => m.name === name);
    let view = null;
    if (model) {
      const columns = model.fields.filter((f) => f.kind === 'scalar' || f.kind === 'enum').map((f) => f.name);
      const total = tables.find((t) => t.name === name).rows;
      const pages = Math.max(1, Math.ceil(total / PER_PAGE));
      const page = Math.min(pages, Math.max(1, parseInt(req.query.page, 10) || 1));
      const id = model.fields.find((f) => f.isId);
      const rows = await delegate(name).findMany({
        select: Object.fromEntries(columns.map((c) => [c, true])),
        ...(id ? { orderBy: { [id.name]: 'desc' } } : {}),
        skip: (page - 1) * PER_PAGE,
        take: PER_PAGE,
      });
      view = { name, columns, rows: rows.map((r) => columns.map((c) => cell(r[c]))), total, page, pages };
    }
    res.render('pages/admin/database', { title: 'Database — Zury', tables, view });
  } catch (err) {
    next(err);
  }
}

module.exports = { index };

const prisma = require('../config/prisma');
const audit = require('../services/auditService');
const statsService = require('../services/statsService');
const platformRoles = require('../services/platformRoleService');
const { buildSubject, expand } = require('../services/permissionService');
const { PERMISSIONS, PLATFORM_ROLES, EVENT_ROLES, IMPLIES } = require('../permissions/registry');

const pageParam = (req) => Math.max(1, Number.parseInt(req.query.page, 10) || 1);

async function index(req, res, next) {
  try {
    const [users, contests, admins, auditEntries, platform] = await Promise.all([
      prisma.user.count(),
      prisma.contest.count({ where: { deletedAt: null } }),
      prisma.userGlobalRole.count({ where: { role: 'platform-admin' } }),
      prisma.auditLog.count(),
      statsService.platformStats(),
    ]);
    res.render('pages/admin/index', { title: 'Administration — Zury', stats: { users, contests, admins, auditEntries }, platform });
  } catch (err) {
    next(err);
  }
}

async function users(req, res, next) {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 85) : '';
    const page = pageParam(req);
    const perPage = 50;
    const where = q ? { username: { contains: q } } : {};
    const [list, total] = await Promise.all([
      prisma.user.findMany({
        where,
        include: { globalRoles: true, wikiRoles: true },
        orderBy: { username: 'asc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      prisma.user.count({ where }),
    ]);
    res.render('pages/admin/users', {
      title: 'Users — Administration',
      q,
      page,
      pages: Math.max(1, Math.ceil(total / perPage)),
      rows: list.map((u) => ({ user: u, subject: buildSubject(u) })),
      assignableRoles: Object.entries(PLATFORM_ROLES).filter(([, r]) => r.source === 'zury'),
    });
  } catch (err) {
    next(err);
  }
}

async function grantRole(req, res, next) {
  try {
    await platformRoles.grant({ actorId: req.user.id, userId: Number(req.params.userId), role: req.body.role });
    res.redirect('/admin/users');
  } catch (err) {
    next(err);
  }
}

async function revokeRole(req, res, next) {
  try {
    await platformRoles.revoke({ actorId: req.user.id, userId: Number(req.params.userId), role: req.body.role });
    res.redirect('/admin/users');
  } catch (err) {
    next(err);
  }
}

function permissions(req, res) {
  const roles = [
    ...Object.entries(PLATFORM_ROLES).map(([key, r]) => ({ key, kind: 'Platform', ...r })),
    ...Object.entries(EVENT_ROLES).map(([key, r]) => ({ key, kind: 'Event', ...r })),
  ].map((r) => ({ ...r, effective: expand(r.permissions), viaGlobal: new Set(r.globalPermissions || []) }));
  res.render('pages/admin/permissions', { title: 'Permissions — Administration', roles, PERMISSIONS, IMPLIES });
}

async function logs(req, res, next) {
  try {
    const result = await audit.list({ page: pageParam(req) });
    res.render('pages/admin/logs', { title: 'Audit log — Administration', result });
  } catch (err) {
    next(err);
  }
}

module.exports = { index, users, grantRole, revokeRole, permissions, logs };

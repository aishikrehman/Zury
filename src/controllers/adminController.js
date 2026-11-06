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
    const roleFilter = typeof req.query.role === 'string' && PLATFORM_ROLES[req.query.role] ? req.query.role : '';
    // Wikimedia-derived roles live in wikiRoles; Zury's own in globalRoles.
    const byRole = {
      steward: { wikiRoles: { some: { wiki: '*', rightName: 'steward' } } },
      'global-sysop': { wikiRoles: { some: { wiki: '*', rightName: 'global-sysop' } } },
      'local-admin': { wikiRoles: { some: { rightName: 'sysop', NOT: { wiki: '*' } } } },
    }[roleFilter] || (roleFilter ? { globalRoles: { some: { role: roleFilter } } } : {});
    const where = { ...(q && { username: { contains: q } }), ...byRole };
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
      roleFilter,
      total,
      page,
      pages: Math.max(1, Math.ceil(total / perPage)),
      rows: list.map((u) => ({ user: u, subject: buildSubject(u) })),
      assignableRoles: Object.entries(PLATFORM_ROLES).filter(([, r]) => r.source === 'zury' && !r.cliOnly),
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

const rolePermissions = require('../services/rolePermissionService');

// Permissions in groups, for the matrix.
const PERMISSION_GROUPS = [
  ['Events', /Event$|^createEvent$|Series|Wiki/],
  ['Entries', /Submission|Entry|Entries|Submit|Appeal|Contribution|exportData/],
  ['Reviewers and results', /Review|review|Jury|Assignment|Results|Score|massReview/],
  ['People', /Participant|Member|Role|Block|Notification|Message|Organizer/],
  ['Site', /.*/],
];

function permissions(req, res) {
  const roles = [
    ...Object.entries(PLATFORM_ROLES).map(([key, r]) => ({ key, kind: 'platform', kindLabel: r.source === 'wikimedia' ? 'Wikimedia' : 'Zury', ...r })),
    ...Object.entries(EVENT_ROLES).map(([key, r]) => ({ key, kind: 'event', kindLabel: 'Event', ...r })),
  ].map((r) => ({ ...r, effective: expand(r.permissions), viaGlobal: new Set(r.globalPermissions || []), locked: rolePermissions.LOCKED(r.kind, r.key) }));
  const groups = PERMISSION_GROUPS.map(([label]) => ({ label, keys: [] }));
  for (const key of Object.keys(PERMISSIONS)) groups[PERMISSION_GROUPS.findIndex(([, re]) => re.test(key))].keys.push(key);
  res.render('pages/admin/permissions', {
    title: 'Permissions — Administration',
    roles,
    groups: groups.filter((g) => g.keys.length),
    PERMISSIONS,
    IMPLIES,
    changed: new Set(rolePermissions.changes().map((c) => `${c.kind}:${c.role}:${c.permission}`)),
    canEdit: req.permissions.has('maintainSite'),
  });
}

async function setRolePermission(req, res, next) {
  try {
    await rolePermissions.set({ actor: req.user, kind: req.body.kind, role: req.body.role, permission: req.body.permission, allowed: req.body.allowed === '1' });
    req.flash('success', 'Saved.');
  } catch (err) {
    if (!(err instanceof rolePermissions.RolePermissionError)) return next(err);
    req.flash('danger', err.message);
  }
  res.redirect(`/admin/permissions#perm-${req.body.permission}`);
}

async function resetRolePermissions(req, res, next) {
  try {
    const n = await rolePermissions.resetAll(req.user);
    req.flash('success', req.t('{n} changes undone.', { n }));
    res.redirect('/admin/permissions');
  } catch (err) {
    next(err);
  }
}

async function logs(req, res, next) {
  try {
    const result = await audit.list({ page: pageParam(req) });
    res.render('pages/admin/logs', { title: 'Audit log — Administration', result });
  } catch (err) {
    next(err);
  }
}

const maintenance = require('../services/maintenanceService');

async function maintenancePage(req, res, next) {
  try {
    res.render('pages/admin/maintenance', { title: 'Maintenance — Zury', status: await maintenance.status() });
  } catch (err) {
    next(err);
  }
}

async function downloadBackup(req, res, next) {
  try {
    const file = await maintenance.backup(req.user.id);
    res.download(file, require('path').basename(file));
  } catch (err) {
    next(err);
  }
}

async function cleanUp(req, res, next) {
  try {
    const removed = await maintenance.cleanUp({ actorId: req.user.id, task: req.params.task });
    req.flash('success', req.t('{n} rows removed.', { n: removed }));
    res.redirect('/admin/maintenance');
  } catch (err) {
    next(err);
  }
}

module.exports = { setRolePermission, resetRolePermissions, maintenancePage, downloadBackup, cleanUp, index, users, grantRole, revokeRole, permissions, logs };

// Superusers: remove an account from Zury, with its entries, reviews and roles (not one's own).
async function deleteUser(req, res, next) {
  try {
    const id = Number(req.params.userId);
    if (id === req.user.id) {
      req.flash('danger', req.t("You can't delete your own account."));
      return res.redirect('/admin/users');
    }
    const u = await prisma.user.findUnique({ where: { id }, select: { id: true, username: true } });
    if (u) {
      const [entries, reviews] = await Promise.all([prisma.submission.count({ where: { participantId: id } }), prisma.review.count({ where: { jurorId: id } })]);
      await prisma.user.delete({ where: { id } });
      await require('../services/auditService').record({ actorId: req.user.id, action: 'user.deleted', entityType: 'User', entityId: id, details: { username: u.username, entries, reviews } });
      req.flash('success', req.t('Account {name} deleted.', { name: u.username }));
    }
    res.redirect('/admin/users');
  } catch (err) {
    next(err);
  }
}
module.exports.deleteUser = deleteUser;

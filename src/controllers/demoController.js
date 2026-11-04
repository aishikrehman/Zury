const prisma = require('../config/prisma');
const { buildSubject } = require('../services/permissionService');
const { ensureCsrfToken } = require('../middleware/csrf');

// The switcher lists people who hold a role worth trying (organizers, jury, wiki or platform
// rights) and a few participants; with real event data there are hundreds of writers.
async function switchable() {
  const include = { globalRoles: true, wikiRoles: true, memberships: { where: { status: 'active' }, select: { role: true } } };
  const [staff, writers] = await Promise.all([
    prisma.user.findMany({
      where: { isDemo: true, status: 'active', OR: [{ globalRoles: { some: {} } }, { wikiRoles: { some: {} } }, { memberships: { some: { status: 'active', role: { in: ['organizer', 'jury'] } } } }] },
      include,
      orderBy: { wikimediaId: 'desc' },
    }),
    prisma.user.findMany({
      where: { isDemo: true, status: 'active', memberships: { some: { status: 'active', role: 'participant' } }, NOT: { memberships: { some: { role: { in: ['organizer', 'jury'] } } } } },
      include,
      orderBy: { submissions: { _count: 'desc' } },
      take: 8,
    }),
  ]);
  return [...staff, ...writers];
}

async function index(req, res, next) {
  try {
    const users = await switchable();
    ensureCsrfToken(req, res);
    res.render('pages/demo/index', {
      title: 'Demo users — Zury',
      rows: users.map((u) => ({
        user: u,
        subject: buildSubject(u),
        roleCounts: u.memberships.reduce((acc, m) => ({ ...acc, [m.role]: (acc[m.role] || 0) + 1 }), {}),
      })),
    });
  } catch (err) {
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const user = await prisma.user.findFirst({ where: { id: Number(req.body.userId), isDemo: true, status: 'active' } });
    if (!user) return res.redirect('/demo');
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.userId = user.id;
      req.session.save((saveErr) => (saveErr ? next(saveErr) : res.redirect('/dashboard')));
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { index, login, switchable };

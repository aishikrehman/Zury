const prisma = require('../config/prisma');
const { buildSubject } = require('../services/permissionService');
const { ensureCsrfToken } = require('../middleware/csrf');

async function index(req, res, next) {
  try {
    const users = await prisma.user.findMany({
      where: { isDemo: true },
      include: {
        globalRoles: true,
        wikiRoles: true,
        memberships: { where: { status: 'active' }, select: { role: true } },
      },
      orderBy: { wikimediaId: 'desc' },
    });
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

module.exports = { index, login };

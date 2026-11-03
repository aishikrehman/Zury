const prisma = require('../config/prisma');
const permissionService = require('../services/permissionService');
const contestService = require('../services/contestService');
const { defaultSettings } = require('../services/contestFormService');
const { requireAuth } = require('./auth');

function forbidden() {
  const err = new Error("You don't have permission to do that.");
  err.status = 403;
  return err;
}

// Loads :contestId and switches req.permissions / can() to that event's scope.
// Deleted events, and events the user may not see, return 404 so their
// existence isn't revealed.
async function loadContest(req, res, next) {
  try {
    const id = Number(req.params.contestId);
    const contest =
      Number.isSafeInteger(id) && id > 0
        ? await prisma.contest.findFirst({ where: { id, deletedAt: null }, include: { settings: true } })
        : null;
    const scope = contest && (await permissionService.contestScope(req.subject, contest));
    if (!contest || !contestService.isVisible(contest, scope)) {
      return res.status(404).render('pages/404', { title: 'Event Not Found' });
    }
    const { settings, ...rest } = contest;
    req.contest = rest;
    req.settings = settings || { contestId: contest.id, ...defaultSettings(contest.type) };
    req.scope = scope;
    req.permissions = scope.permissions;
    res.locals.contest = rest;
    res.locals.settings = req.settings;
    res.locals.scope = scope;
    res.locals.can = (permission) => scope.permissions.has(permission);
    next();
  } catch (err) {
    next(err);
  }
}

// Checks against the current scope: the event's if loadContest ran, else global.
function requirePermission(...anyOf) {
  return (req, res, next) => {
    if (!req.user) return requireAuth(req, res, next);
    if (anyOf.some((p) => req.permissions.has(p))) return next();
    next(forbidden());
  };
}

module.exports = { loadContest, requirePermission, forbidden };

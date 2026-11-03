const permissionService = require('../services/permissionService');
const rightsService = require('../services/rightsService');

function setGlobalScope(req, res, subject) {
  req.subject = subject;
  req.permissions = permissionService.globalPermissions(subject);
  res.locals.currentUser = subject.user;
  res.locals.subject = subject;
  res.locals.can = (permission) => req.permissions.has(permission);
}

async function attachUser(req, res, next) {
  setGlobalScope(req, res, permissionService.EMPTY_SUBJECT);
  const userId = req.session?.userId;
  if (!userId) return next();

  try {
    let subject = await permissionService.loadSubject(userId);
    if (!subject || subject.user.status !== 'active') {
      delete req.session.userId;
      return next();
    }
    if (rightsService.needsRefresh(subject.user)) {
      // A failed lookup keeps the last verified rights until they expire.
      if (await rightsService.refreshFromWikimedia(subject.user)) {
        subject = await permissionService.loadSubject(userId);
      }
    }
    req.user = subject.user;
    setGlobalScope(req, res, subject);
    next();
  } catch (err) {
    next(err);
  }
}

function requireAuth(req, res, next) {
  if (req.user) return next();
  if (req.method === 'GET') req.session.returnTo = req.originalUrl;
  res.redirect('/login');
}

module.exports = { attachUser, requireAuth };

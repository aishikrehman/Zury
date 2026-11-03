const userService = require('../services/userService');

async function attachUser(req, res, next) {
  const userId = req.session?.userId;
  if (!userId) return next();

  try {
    const user = await userService.findById(userId);
    if (user && user.status === 'active') {
      req.user = user;
      res.locals.currentUser = user;
    } else {
      delete req.session.userId;
    }
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

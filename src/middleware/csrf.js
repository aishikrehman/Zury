const crypto = require('crypto');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function tokensMatch(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

function csrfProtection(req, res, next) {
  // Only signed-in sessions get a token, so anonymous visitors don't create sessions.
  if (!req.session.csrfToken && req.session.userId) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken || '';

  if (SAFE_METHODS.has(req.method)) return next();

  const submitted = req.body?._csrf || req.get('x-csrf-token');
  if (tokensMatch(submitted, req.session.csrfToken)) return next();

  const err = new Error('Invalid or missing form token. Please go back, reload the page and try again.');
  err.status = 403;
  next(err);
}

module.exports = { csrfProtection };

const oauthService = require('../services/wikimediaOAuthService');
const userService = require('../services/userService');

function safeReturnTo(value) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : '/dashboard';
}

function renderLoginError(res, status, message) {
  res.status(status).render('pages/error', { title: 'Login Failed', message });
}

async function login(req, res, next) {
  if (req.user) return res.redirect('/dashboard');
  try {
    const requestToken = await oauthService.getRequestToken();
    req.session.oauthRequestToken = requestToken;
    req.session.save((err) => {
      if (err) return next(err);
      res.redirect(oauthService.getAuthorizeUrl(requestToken.key));
    });
  } catch (err) {
    if (err instanceof oauthService.WikimediaOAuthError) {
      console.error(err.message);
      return renderLoginError(res, 502, 'Could not start Wikimedia login. Please try again later.');
    }
    next(err);
  }
}

async function callback(req, res, next) {
  const { oauth_token: oauthToken, oauth_verifier: verifier } = req.query;
  const requestToken = req.session.oauthRequestToken;

  if (!requestToken || !verifier || requestToken.key !== oauthToken) {
    return renderLoginError(res, 400, 'This login link is invalid or has expired. Please log in again.');
  }

  try {
    const accessToken = await oauthService.getAccessToken(requestToken, verifier);
    const identity = await oauthService.identify(accessToken);
    const homeWiki = await oauthService.fetchHomeWiki(identity.username);
    const user = await userService.syncFromWikimedia({ ...identity, homeWiki });

    if (user.status !== 'active') {
      return renderLoginError(res, 403, 'This Zury account is not active.');
    }

    const returnTo = safeReturnTo(req.session.returnTo);
    // New session ID on login to prevent session fixation.
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.userId = user.id;
      req.session.save((saveErr) => {
        if (saveErr) return next(saveErr);
        res.redirect(returnTo);
      });
    });
  } catch (err) {
    if (err instanceof oauthService.WikimediaOAuthError) {
      console.error(err.message);
      return renderLoginError(res, 502, 'Wikimedia login could not be completed. Please try again.');
    }
    next(err);
  }
}

function logout(req, res, next) {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('zury.sid');
    res.redirect('/');
  });
}

module.exports = { login, callback, logout };

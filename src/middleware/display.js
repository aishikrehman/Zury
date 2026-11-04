// Display options (wide pages, larger text): from the user's record when logged in,
// from the server-side session otherwise. Nothing is kept in the browser.
function displayPreferences(req, res, next) {
  const saved = req.user
    ? { wide: req.user.uiWide, textLarge: req.user.uiTextLarge }
    : req.session?.ui || {};
  res.locals.ui = { wide: Boolean(saved.wide), textLarge: Boolean(saved.textLarge) };
  next();
}

module.exports = { displayPreferences };

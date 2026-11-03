const { LAYOUTS, DEFAULT_LAYOUT } = require('../utils/layouts');

// Layout and display options: from the user's record when logged in, from the
// server-side session otherwise. Nothing is kept in the browser.
function displayPreferences(req, res, next) {
  const saved = req.user
    ? { layout: req.user.uiLayout, wide: req.user.uiWide, textLarge: req.user.uiTextLarge }
    : req.session?.ui || {};
  res.locals.layoutKey = LAYOUTS[saved.layout] ? saved.layout : DEFAULT_LAYOUT;
  res.locals.ui = { wide: Boolean(saved.wide), textLarge: Boolean(saved.textLarge) };
  next();
}

module.exports = { displayPreferences };

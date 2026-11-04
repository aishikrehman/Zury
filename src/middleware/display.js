// Display options: from the user's record when logged in, from the server-side session
// otherwise. Nothing is kept in the browser.
const display = require('../config/displayOptions');

function displayPreferences(req, res, next) {
  let saved = req.session?.ui || {};
  if (req.user) {
    try { saved = JSON.parse(req.user.uiPrefs || '{}'); } catch { saved = {}; }
    saved = { ...saved, wide: req.user.uiWide, textLarge: req.user.uiTextLarge };
  }
  res.locals.ui = display.read(saved);
  res.locals.uiClasses = display.classes(res.locals.ui);
  res.locals.DISPLAY_SWITCHES = display.SWITCHES;
  next();
}

module.exports = { displayPreferences };

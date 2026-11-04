// Display preferences only; changing them affects nothing else, so plain links are fine.
const express = require('express');
const prisma = require('../config/prisma');
const { LANGUAGES } = require('../i18n');

const router = express.Router();

const safeNext = (value, fallback) =>
  typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : fallback;

const display = require('../config/displayOptions');

async function save(req, changes) {
  if (!Object.keys(changes).length) return;
  if (req.user) {
    let prefs = {};
    try { prefs = JSON.parse(req.user.uiPrefs || '{}'); } catch { prefs = {}; }
    const { wide, textLarge, ...rest } = changes;
    const data = { uiPrefs: JSON.stringify({ ...prefs, ...rest }) };
    if (wide !== undefined) data.uiWide = wide;
    if (textLarge !== undefined) data.uiTextLarge = textLarge;
    await prisma.user.update({ where: { id: req.user.id }, data });
  } else {
    req.session.ui = { ...(req.session.ui || {}), ...changes };
  }
}

router.get('/preferences/display', async (req, res, next) => {
  try {
    const changes = {};
    for (const key of Object.keys(display.SWITCHES)) {
      if (req.query[key] === '1' || req.query[key] === '0') changes[key] = req.query[key] === '1';
    }
    if (display.THEMES.includes(req.query.theme)) changes.theme = req.query.theme;
    await save(req, changes);
    // The page's script asks for no redirect: the option is already applied, nothing reloads.
    if (req.get('x-requested-with') === 'zury') return res.status(204).end();
    res.redirect(safeNext(req.query.next, '/'));
  } catch (err) {
    next(err);
  }
});

// Interface language: on the account when logged in, else in the session.
router.get('/preferences/language/:code', async (req, res, next) => {
  try {
    const { code } = req.params;
    if (LANGUAGES[code]) {
      if (req.user) await prisma.user.update({ where: { id: req.user.id }, data: { preferredLanguage: code } });
      else req.session.lang = code;
    }
    res.redirect(safeNext(req.query.next, '/'));
  } catch (err) {
    next(err);
  }
});

module.exports = router;

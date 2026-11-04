// Display preferences only; changing them affects nothing else, so plain links are fine.
const express = require('express');
const prisma = require('../config/prisma');
const { LANGUAGES } = require('../i18n');

const router = express.Router();

const safeNext = (value, fallback) =>
  typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : fallback;

async function save(req, changes) {
  if (!Object.keys(changes).length) return;
  if (req.user) {
    const data = {};
    if ('wide' in changes) data.uiWide = changes.wide;
    if ('textLarge' in changes) data.uiTextLarge = changes.textLarge;
    await prisma.user.update({ where: { id: req.user.id }, data });
  } else {
    req.session.ui = { ...(req.session.ui || {}), ...changes };
  }
}

router.get('/preferences/display', async (req, res, next) => {
  try {
    const changes = {};
    for (const key of ['wide', 'textLarge']) {
      if (req.query[key] === '1' || req.query[key] === '0') changes[key] = req.query[key] === '1';
    }
    await save(req, changes);
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

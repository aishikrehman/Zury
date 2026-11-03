const userService = require('../services/userService');

const TIMEZONES = ['UTC', ...Intl.supportedValuesOf('timeZone')];

function dashboard(req, res) {
  res.render('pages/account/dashboard', { title: 'Dashboard — Zury' });
}

function renderSettings(res, { values, errors = {}, saved = false, status = 200 }) {
  res.status(status).render('pages/account/settings', {
    title: 'Settings — Zury',
    values,
    errors,
    saved,
    timezones: TIMEZONES,
  });
}

function showSettings(req, res) {
  renderSettings(res, {
    values: { preferredLanguage: req.user.preferredLanguage, timezone: req.user.timezone },
    saved: req.query.saved === '1',
  });
}

async function updateSettings(req, res, next) {
  const { errors, values } = userService.validatePreferences(req.body);
  if (Object.keys(errors).length) {
    return renderSettings(res, { values: req.body, errors, status: 422 });
  }
  try {
    await userService.updatePreferences(req.user.id, values);
    res.redirect('/settings?saved=1');
  } catch (err) {
    next(err);
  }
}

module.exports = { dashboard, showSettings, updateSettings };

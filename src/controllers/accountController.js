const userService = require('../services/userService');
const contestService = require('../services/contestService');

const TIMEZONES = ['UTC', ...Intl.supportedValuesOf('timeZone')];

async function dashboard(req, res, next) {
  try {
    const myEvents = await contestService.listForUser(req.user.id);
    res.render('pages/account/dashboard', {
      title: 'Dashboard — Zury',
      myEvents,
      juryEvents: myEvents.filter((e) => e.roles.includes('jury')),
      wikiRoles: req.subject.user.wikiRoles,
    });
  } catch (err) {
    next(err);
  }
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

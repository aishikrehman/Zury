const prisma = require('../config/prisma');
const userService = require('../services/userService');
const contestService = require('../services/contestService');
const statsService = require('../services/statsService');
const catalogService = require('../wiki/catalogService');

const { TIMEZONES } = require('../utils/time');

async function dashboard(req, res, next) {
  try {
    const [myEvents, submissionCount, activity, calendar] = await Promise.all([
      contestService.listForUser(req.user.id),
      prisma.submission.count({ where: { participantId: req.user.id, contest: { deletedAt: null } } }),
      statsService.userStats(req.user.id),
      require('../services/calendarService').month(req.query.month, { memberships: { some: { userId: req.user.id, status: 'active' } } }),
    ]);
    res.render('pages/account/dashboard', {
      title: 'Dashboard — Zury',
      myEvents,
      submissionCount,
      activity,
      calendar,
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
  try {
    const catalog = await catalogService.validators();
    const { errors, values } = userService.validatePreferences(req.body, catalog.language);
    if (Object.keys(errors).length) {
      return renderSettings(res, { values: req.body, errors, status: 422 });
    }
    await userService.updatePreferences(req.user.id, values);
    res.redirect('/settings?saved=1');
  } catch (err) {
    next(err);
  }
}

// Profile picture: a file on Commons, or none.
async function updateAvatar(req, res, next) {
  const { thumbnailFor, AvatarError } = require('../services/commonsAvatarService');
  try {
    if (req.body.remove === '1') {
      await prisma.user.update({ where: { id: req.user.id }, data: { avatarUrl: null } });
      req.flash('success', 'Profile picture removed.');
    } else {
      const { url } = await thumbnailFor(req.body.file);
      await prisma.user.update({ where: { id: req.user.id }, data: { avatarUrl: url } });
      req.flash('success', 'Profile picture saved.');
    }
  } catch (err) {
    if (!(err instanceof AvatarError)) return next(err);
    req.flash('danger', err.message);
  }
  res.redirect('/settings');
}

module.exports = { dashboard, showSettings, updateSettings, updateAvatar };

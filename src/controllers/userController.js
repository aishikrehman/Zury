const prisma = require('../config/prisma');
const contestService = require('../services/contestService');
const { buildSubject } = require('../services/permissionService');

async function showProfile(req, res, next) {
  try {
    const profileUser = await prisma.user.findUnique({
      where: { username: req.params.username },
      include: { globalRoles: true, wikiRoles: true },
    });
    if (!profileUser || profileUser.status !== 'active') {
      return res.status(404).render('pages/404', { title: 'User Not Found' });
    }
    // Public page: only public events are listed, even to the user themself.
    const events = await contestService.listForUser(profileUser.id, { publicOnly: true });
    res.render('pages/users/profile', {
      title: `${profileUser.username} — Zury`,
      profileUser,
      profileSubject: buildSubject(profileUser),
      isOwnProfile: req.user?.id === profileUser.id,
      organized: events.filter((e) => e.roles.includes('organizer')),
      judged: events.filter((e) => e.roles.includes('jury')),
      participated: events.filter((e) => e.roles.includes('participant')),
      prefs: req.user?.id === profileUser.id ? { values: { preferredLanguage: req.user.preferredLanguage, timezone: req.user.timezone }, errors: {}, saved: req.query.saved === '1', timezones: require('../utils/time').TIMEZONES } : null,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { showProfile };

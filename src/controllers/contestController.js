const contestService = require('../services/contestService');
const { PERMISSIONS } = require('../permissions/registry');

async function show(req, res, next) {
  try {
    const members = await contestService.members(req.contest.id);
    const byRole = (role) => members.filter((m) => m.role === role).map((m) => m.user);
    res.render('pages/contest/show', {
      title: `${req.contest.title} — Zury`,
      organizers: byRole('organizer'),
      jury: byRole('jury'),
      participantCount: byRole('participant').length,
      permissionList: Object.keys(PERMISSIONS).filter((p) => req.scope.permissions.has(p)),
      permissionLabels: PERMISSIONS,
    });
  } catch (err) {
    next(err);
  }
}

function config(req, res) {
  res.render('pages/contest/config', { title: `Configuration — ${req.contest.title}` });
}

async function participants(req, res, next) {
  try {
    const [members, overrides] = await Promise.all([
      contestService.members(req.contest.id),
      contestService.overrides(req.contest.id),
    ]);
    res.render('pages/contest/participants', {
      title: `People — ${req.contest.title}`,
      members,
      overrides,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { show, config, participants };

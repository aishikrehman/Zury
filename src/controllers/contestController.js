const contestService = require('../services/contestService');
const contestForm = require('../services/contestFormService');
const eventService = require('../services/eventService');
const membershipService = require('../services/membershipService');
const userDirectory = require('../services/userDirectoryService');
const lifecycle = require('../services/lifecycleService');
const statsService = require('../services/statsService');
const catalogService = require('../wiki/catalogService');
const { canUseWikiForEvents } = require('../services/permissionService');
const { EVENT_TYPES, readTypeConfig } = require('../events/eventTypes');
const { PERMISSIONS, EVENT_ROLES, OVERRIDABLE_PERMISSIONS, ROLE_MANAGEMENT_PERMISSION } = require('../permissions/registry');

const back = (req, suffix = '') => `/contest/${req.contest.id}${suffix}`;

// Expected, user-facing failures become a flash message; anything else is a real error.
function handled(err) {
  return (
    err instanceof membershipService.MembershipError ||
    err instanceof eventService.EventError ||
    err instanceof lifecycle.LifecycleError
  );
}

async function show(req, res, next) {
  try {
    const [members, roles, participants] = await Promise.all([
      contestService.members(req.contest.id),
      req.user ? membershipService.activeRoles(req.contest.id, req.user.id) : [],
      membershipService.participantCount(req.contest.id),
    ]);
    const byRole = (role) => members.filter((m) => m.role === role).map((m) => m.user);
    const eligibility = membershipService.checkEligibility({
      user: req.user,
      contest: req.contest,
      settings: req.settings,
      roles,
      participants,
    });
    res.render('pages/contest/show', {
      title: `${req.contest.title} — Zury`,
      organizers: byRole('organizer'),
      jury: byRole('jury'),
      participants: byRole('participant'),
      participantCount: participants,
      isParticipant: roles.includes('participant'),
      eligibility,
      typeDef: EVENT_TYPES[req.contest.type],
      typeConfig: readTypeConfig(req.contest.type, req.settings.typeConfig),
      additionalWikis: JSON.parse(req.contest.additionalWikis || '[]'),
      dateFields: contestForm.DATE_FIELDS,
      featureFields: contestForm.FEATURE_FIELDS,
      permissionList: Object.keys(PERMISSIONS).filter((p) => req.scope.permissions.has(p)),
      permissionLabels: PERMISSIONS,
    });
  } catch (err) {
    next(err);
  }
}

function wikiAllowedForEdit(req) {
  return (wiki) => wiki === req.contest.primaryWiki || canUseWikiForEvents(req.subject, wiki);
}

function renderConfig(req, res, { form, errors = {}, status = 200 }) {
  res.status(status).render('pages/contest/config', {
    title: `Configuration — ${req.contest.title}`,
    type: req.contest.type,
    typeDef: EVENT_TYPES[req.contest.type],
    form,
    errors,
    autoStatus: lifecycle.computeAutoStatus(req.contest, req.settings),
    manualStatuses: lifecycle.AUTO_STATUSES.filter((s) => s !== 'published'),
  });
}

function config(req, res) {
  renderConfig(req, res, { form: contestForm.toForm(req.contest, req.settings) });
}

async function updateConfig(req, res, next) {
  const type = req.contest.type;
  let loaded;
  try {
    loaded = await catalogService.validators();
  } catch (err) {
    return next(err);
  }
  // An event may keep its primary wiki even if that wiki has since closed.
  const catalog = { ...loaded, open: (w) => w === req.contest.primaryWiki || loaded.open(w) };
  const parsed = contestForm.parse({ ...req.body, type }, { type, wikiAllowed: wikiAllowedForEdit(req), catalog });
  if (Object.keys(parsed.errors).length) return renderConfig(req, res, { form: parsed.form, errors: parsed.errors, status: 422 });
  try {
    await eventService.update({ actorId: req.user.id, contest: req.contest, settings: req.settings, parsed, autoSlug: !req.body.slug?.trim() });
    req.flash('success', 'Event settings saved.');
    res.redirect(back(req, '/config'));
  } catch (err) {
    if (err instanceof eventService.EventError) {
      return renderConfig(req, res, { form: parsed.form, errors: { [err.field]: err.message }, status: 422 });
    }
    next(err);
  }
}

async function changeStatus(req, res, next) {
  try {
    await eventService.changeStatus({ actorId: req.user.id, contest: req.contest, settings: req.settings, action: req.body.action, status: req.body.status });
    req.flash('success', 'Event status updated.');
  } catch (err) {
    if (!handled(err)) return next(err);
    req.flash('danger', err.message);
  }
  res.redirect(back(req, '/config'));
}

async function destroy(req, res, next) {
  try {
    await eventService.softDelete({ actorId: req.user.id, contest: req.contest, confirmation: (req.body.confirmation || '').trim() });
    req.flash('success', `“${req.contest.title}” was deleted.`);
    res.redirect('/dashboard');
  } catch (err) {
    if (!handled(err)) return next(err);
    req.flash('danger', err.message);
    res.redirect(back(req, '/config'));
  }
}

async function people(req, res, next) {
  try {
    const [members, overrides] = await Promise.all([contestService.members(req.contest.id), contestService.overrides(req.contest.id)]);
    res.render('pages/contest/participants', {
      title: `People — ${req.contest.title}`,
      members,
      overrides,
      roleOptions: Object.entries(EVENT_ROLES).filter(([role]) => req.permissions.has(ROLE_MANAGEMENT_PERMISSION[role])),
      ROLE_MANAGEMENT_PERMISSION,
      overridable: OVERRIDABLE_PERMISSIONS,
      permissionLabels: PERMISSIONS,
    });
  } catch (err) {
    next(err);
  }
}

async function resolveUser(req) {
  const user = await userDirectory.findOrImport(req.body.username);
  if (!user) throw new membershipService.MembershipError(`No Wikimedia user named “${String(req.body.username || '').trim()}” was found.`);
  return user;
}

async function addMember(req, res, next) {
  const { role } = req.body;
  if (!EVENT_ROLES[role] || !req.permissions.has(ROLE_MANAGEMENT_PERMISSION[role])) {
    req.flash('danger', "You can't add people with that role.");
    return res.redirect(back(req, '/participants'));
  }
  try {
    const user = await resolveUser(req);
    await membershipService.addMember({ actorId: req.user.id, contest: req.contest, settings: req.settings, user, role });
    req.flash('success', `${user.username} added as ${EVENT_ROLES[role].label.toLowerCase()}.`);
  } catch (err) {
    if (!handled(err)) return next(err);
    req.flash('danger', err.message);
  }
  res.redirect(back(req, '/participants'));
}

async function removeMember(req, res, next) {
  try {
    await membershipService.removeMember({
      actorId: req.user.id,
      contest: req.contest,
      membershipId: Number(req.params.membershipId),
      allowed: (p) => req.permissions.has(p),
    });
    req.flash('success', 'Removed.');
  } catch (err) {
    if (!handled(err)) return next(err);
    req.flash('danger', err.message);
  }
  res.redirect(back(req, '/participants'));
}

async function setOverride(req, res, next) {
  try {
    const user = await resolveUser(req);
    await membershipService.setOverride({ actorId: req.user.id, contest: req.contest, user, permission: req.body.permission, allowed: req.body.allowed === 'true' });
    req.flash('success', `Override saved for ${user.username}.`);
  } catch (err) {
    if (!handled(err)) return next(err);
    req.flash('danger', err.message);
  }
  res.redirect(back(req, '/participants'));
}

async function removeOverride(req, res, next) {
  try {
    await membershipService.removeOverride({ actorId: req.user.id, contest: req.contest, overrideId: Number(req.params.overrideId) });
    req.flash('success', 'Override removed.');
  } catch (err) {
    if (!handled(err)) return next(err);
    req.flash('danger', err.message);
  }
  res.redirect(back(req, '/participants'));
}

async function join(req, res, next) {
  try {
    await membershipService.join({ user: req.user, contest: req.contest, settings: req.settings });
    req.flash('success', "You've joined this event.");
  } catch (err) {
    if (!handled(err)) return next(err);
    req.flash('danger', err.message);
  }
  res.redirect(back(req));
}

async function leave(req, res, next) {
  try {
    await membershipService.leave({ user: req.user, contest: req.contest });
    req.flash('success', "You've left this event.");
  } catch (err) {
    if (!handled(err)) return next(err);
    req.flash('danger', err.message);
  }
  res.redirect(back(req));
}

async function statistics(req, res, next) {
  if (!req.settings.publicStatisticsEnabled && !req.permissions.has('viewStatistics')) {
    const err = new Error("This event's statistics aren't public.");
    err.status = 403;
    return next(err);
  }
  try {
    res.render('pages/contest/statistics', {
      title: `Statistics — ${req.contest.title}`,
      stats: await statsService.eventStats(req.contest),
      showNames: !req.settings.anonymousParticipants || req.permissions.has('viewAllSubmissions'),
    });
  } catch (err) {
    next(err);
  }
}

async function activity(req, res, next) {
  try {
    res.render('pages/contest/activity', { title: `Activity — ${req.contest.title}`, entries: await contestService.activity(req.contest.id) });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  show,
  config,
  updateConfig,
  changeStatus,
  destroy,
  people,
  addMember,
  removeMember,
  setOverride,
  removeOverride,
  join,
  leave,
  activity,
  statistics,
};

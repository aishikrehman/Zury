const contestService = require('../services/contestService');
const contestForm = require('../services/contestFormService');
const eventService = require('../services/eventService');
const membershipService = require('../services/membershipService');
const userDirectory = require('../services/userDirectoryService');
const lifecycle = require('../services/lifecycleService');
const statsService = require('../services/statsService');
const eventWikiService = require('../services/eventWikiService');
const prisma = require('../config/prisma');
const { effectiveFor, buildOverrides } = require('../events/effective');
const mergeService = require('../services/eventMergeService');
const permissionService = require('../services/permissionService');
const { eventPath } = require('../utils/format');

// Events this one could move into: same type, run by this person as a global controller.
async function moveTargets(req) {
  if (req.wikiScope || req.eventWikis.length !== 1 || !req.scope.global.has('deleteEvent')) return [];
  const candidates = await prisma.contest.findMany({
    where: { type: req.contest.type, deletedAt: null, id: { not: req.contest.id } },
    include: { series: true, wikis: true },
    orderBy: { startDate: 'desc' },
    take: 100,
  });
  const allowed = [];
  for (const c of candidates) {
    const scope = await permissionService.contestScope(req.subject, c, { wikis: c.wikis.filter((w) => w.status !== 'pending').map((w) => w.wiki) });
    if (scope.global.has('manageEvent')) allowed.push({ id: c.id, title: c.title, path: eventPath(c), wikis: c.wikis.length });
  }
  return allowed;
}
const catalogService = require('../wiki/catalogService');
const { canUseWikiForEvents } = require('../services/permissionService');
const { EVENT_TYPES, readTypeConfig } = require('../events/eventTypes');
const { PERMISSIONS, EVENT_ROLES, OVERRIDABLE_PERMISSIONS, ROLE_MANAGEMENT_PERMISSION } = require('../permissions/registry');

const back = (req, suffix = "") => `${req.base}${suffix}`;

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
    const [members, roles, participants, blocked] = await Promise.all([
      contestService.members(req.contest.id),
      req.user ? membershipService.activeRoles(req.contest.id, req.user.id) : [],
      membershipService.participantCount(req.contest.id),
      req.user ? membershipService.isBlocked(req.contest.id, req.user.id) : false,
    ]);
    const inView = members.filter((m) => !m.wiki || !req.contextWiki || m.wiki === req.contextWiki.wiki);
    const byRole = (role) => [...new Map(inView.filter((m) => m.role === role).map((m) => [m.user.id, m.user])).values()];
    const eligibility = membershipService.checkEligibility({
      user: req.user,
      contest: req.contest,
      settings: req.settings,
      roles,
      participants,
      blocked,
    });
    const mine = req.user && members.find((m) => m.user.id === req.user.id && m.role === 'participant');
    res.render('pages/contest/show', {
      joinWikis: req.eventWikis.length > 1 && !req.wikiScope ? req.eventWikis.filter((w) => w.status === 'active') : [],
      defaultJoinWiki: defaultWikiFor(req),
      myWiki: mine?.wiki || '',
      title: `${req.contest.title} — Zury`,
      organizers: byRole('organizer'),
      jury: byRole('jury'),
      participants: byRole('participant'),
      participantCount: participants,
      isParticipant: roles.includes('participant'),
      eligibility,
      typeDef: EVENT_TYPES[req.contest.type],
      typeConfig: readTypeConfig(req.contest.type, req.settings.typeConfig),
      wikiParts: await wikiParts(req, members),
      requestableWikis: req.user && !req.scope.isGlobalController,
      dateFields: contestForm.DATE_FIELDS,
      featureFields: contestForm.FEATURE_FIELDS,
      permissionList: Object.keys(PERMISSIONS).filter((p) => req.scope.permissions.has(p)),
      permissionLabels: PERMISSIONS,
      // Statistics sit on the overview for whoever may see them.
      stats: canSeeStats(req) && EVENT_TYPES[req.contest.type]?.entries !== false ? await statsService.eventStats(req.contest, { wiki: req.wikiScope?.wiki }) : null,
      showNames: !req.settings.anonymousParticipants || req.permissions.has('viewAllSubmissions'),
    });
  } catch (err) {
    next(err);
  }
}

// The central dashboard of a multi-wiki event: one row per wiki with its own status and numbers.
async function wikiParts(req, members) {
  if (req.wikiScope || req.allWikis.length < 2) return [];
  const counts = await prisma.submission.groupBy({
    by: ['wiki'],
    where: { contestId: req.contest.id, status: { notIn: ['withdrawn', 'removed'] } },
    _count: { _all: true },
  });
  const entries = Object.fromEntries(counts.map((c) => [c.wiki, c._count._all]));
  const visible = req.scope.isGlobalController ? req.allWikis : req.eventWikis;
  return visible.map((w) => {
    const staff = members.filter((m) => m.wiki === w.wiki);
    return {
      ...w,
      status: w.status === 'active' ? effectiveFor(req.contest, req.eventSettings, w).contest.status : w.status,
      entries: entries[w.wiki] || 0,
      organizers: staff.filter((m) => m.role === 'organizer').length,
      jury: staff.filter((m) => m.role === 'jury').length,
      overridden: effectiveFor(req.contest, req.eventSettings, w).overridden.size,
    };
  });
}

// The wiki someone joins from: the page they're on, else their home wiki if it takes part, else the event's only wiki.
function defaultWikiFor(req, chosen) {
  const open = req.eventWikis.filter((w) => w.status === 'active');
  if (chosen && open.some((w) => w.wiki === chosen)) return chosen;
  if (req.wikiScope) return req.wikiScope.wiki;
  if (open.length === 1) return open[0].wiki;
  return open.find((w) => w.wiki === req.user?.homeWiki)?.wiki || '';
}

function wikiAllowedForEdit(req) {
  return (wiki) => wiki === req.contest.primaryWiki || canUseWikiForEvents(req.subject, wiki);
}

// Never rejects: errors go to Express's error handler.
async function renderConfig(req, res, { form, errors = {}, status = 200 }) {
  let targets;
  try {
    targets = await moveTargets(req);
  } catch (err) {
    return req.next(err);
  }
  const inherited = await require('../services/inheritService').viewFor(req.contest, req.eventSettings).catch(() => []);
  const editionAdmin = req.edition && !req.wikiScope && (await require('../services/scopeRoleService').canRunEdition(req, req.edition)) ? `/series/${req.series.slug}/${req.edition.slug}` : null;
  const places = req.wikiScope || !req.scope.global.has('manageEvent') ? [] : await require('../services/scopeRoleService').placesFor(req);
  res.status(status).render('pages/contest/config', {
    inherited,
    places,
    editionAdmin,
    moveTargets: targets,
    wikiMode: !!req.wikiScope,
    canManageWikis: !req.wikiScope && req.scope.isGlobalController,
    title: `Configuration — ${req.contest.title}`,
    type: req.wikiScope ? req.effective.contest.type : req.contest.type,
    typeDef: EVENT_TYPES[req.wikiScope ? req.effective.contest.type : req.contest.type],
    form,
    errors,
  });
}

async function config(req, res) {
  // The data card: what could be cleared, and how much of it there is.
  res.locals.dataCounts = await eventData.counts(req.contest.id);
  const shown = req.wikiScope ? req.effective.contest : req.contest;
  renderConfig(req, res, { form: contestForm.toForm({ ...shown, series: req.edition ? null : req.series, editionOf: req.edition ? { ...req.edition, series: req.series } : null }, req.settings) });
}

// Fields a wiki part always takes from the event.
const EVENT_ONLY = ['title', 'slug', 'seriesSlug', 'edition', 'organizingCommunity', 'primaryWiki', 'language', 'visibility', 'logoUrl', 'bannerUrl'];
const same = (a, b) => (a instanceof Date || b instanceof Date ? (a && a.getTime()) === (b && b.getTime()) : JSON.stringify(a) === JSON.stringify(b));

// A wiki's settings form: every value that differs from the event's becomes an override.
async function updateWikiConfig(req, res, next) {
  // The wiki's own type, if it has one (its type settings are then all its own).
  const type = req.effective.contest.type;
  const ownType = type !== req.contest.type;
  const eventForm = contestForm.toForm({ ...req.contest, series: req.edition ? null : req.series, editionOf: req.edition ? { ...req.edition, series: req.series } : null }, req.eventSettings);
  if (req.body.reset) {
    await eventWikiService.saveOverrides({ actorId: req.user.id, contest: req.contest, eventWiki: req.wikiScope, overrides: { contest: {}, settings: {}, typeConfig: {} } });
    req.flash('success', 'This wiki now follows the event settings.');
    return res.redirect(back(req, '/config'));
  }
  const body = { ...req.body, type };
  for (const k of EVENT_ONLY) body[k] = eventForm[k];
  const parsed = contestForm.parse(body, { type, wikiAllowed: () => true });
  if (Object.keys(parsed.errors).length) return renderConfig(req, res, { form: { ...parsed.form, primaryWiki: req.wikiScope.wiki }, errors: parsed.errors, status: 422 });
  const baseline = contestForm.parse({ ...eventForm, type }, { type, wikiAllowed: () => true });
  const typeValues = JSON.parse(parsed.settings.typeConfig);
  const baseType = JSON.parse(baseline.settings.typeConfig);
  // A setting locked by the series or edition is the same on every wiki.
  const locked = Object.entries(await require('../services/inheritService').rulesFor(req.contest)).filter(([, r]) => r.mode === 'locked').map(([k]) => `settings.${k}`);
  const chosen = [
    ...Object.keys(parsed.contest).filter((k) => !same(parsed.contest[k], baseline.contest[k])).map((k) => `contest.${k}`),
    ...Object.keys(parsed.settings).filter((k) => k !== 'typeConfig' && !same(parsed.settings[k], baseline.settings[k])).map((k) => `settings.${k}`),
    ...Object.keys(typeValues).filter((k) => ownType || !same(typeValues[k], baseType[k])).map((k) => `type.${k}`),
  ].filter((k) => !locked.includes(k));
  try {
    await eventWikiService.saveOverrides({ actorId: req.user.id, contest: req.contest, eventWiki: req.wikiScope, overrides: buildOverrides(parsed, typeValues, chosen) });
    req.flash('success', chosen.length ? `Saved. ${chosen.length} setting${chosen.length === 1 ? '' : 's'} differ from the event.` : 'Saved. This wiki follows the event settings.');
    res.redirect(back(req, '/config'));
  } catch (err) {
    next(err);
  }
}

async function updateConfig(req, res, next) {
  if (req.wikiScope) return updateWikiConfig(req, res, next);
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
  if (!(await require('../services/scopeRoleService').mayPlace(req, parsed.series, { seriesId: req.contest.seriesId, editionId: req.contest.editionId }))) {
    return renderConfig(req, res, { form: parsed.form, errors: { seriesSlug: 'Only the organizers of that series or edition can add events to it.' }, status: 403 });
  }
  try {
    await eventService.update({ actorId: req.user.id, contest: { ...req.contest, series: req.series }, settings: req.eventSettings, parsed, autoSlug: parsed.autoSlug });
    req.flash('success', 'Event settings saved.');
    if (parsed.lockedRefused && parsed.lockedRefused.length) req.flash('warning', req.t('Some settings are locked by the series or edition and were kept: {list}.', { list: parsed.lockedRefused.map((k) => req.t(require('../services/inheritService').KEYS[k].label)).join(', ') }));
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

// Move into another event: first a confirmation page with what will move, then the move.
async function move(req, res, next) {
  try {
    const target = await prisma.contest.findFirst({ where: { id: Number(req.body.target), deletedAt: null }, include: { series: true, wikis: true } });
    if (!target || !(await moveTargets(req)).some((t) => t.id === target.id)) throw new mergeService.MergeError('Choose an event you run.');
    if (req.body.confirmation === undefined) {
      const plan = await mergeService.preview({ source: req.contest, target });
      return res.render('pages/contest/move', { title: `Move — ${req.contest.title}`, target, targetPath: eventPath(target), plan });
    }
    if (req.body.confirmation.trim() !== req.contest.slug) throw new mergeService.MergeError('Type the address exactly to confirm.');
    const result = await mergeService.mergeInto({ actorId: req.user.id, source: req.contest, target });
    req.flash('success', `Moved into “${target.title}”: ${result.submissions} entries, ${result.people} people, ${result.sessions} sessions. The old address now leads here.`);
    res.redirect(`${eventPath(target)}/${result.code}`);
  } catch (err) {
    if (!(err instanceof mergeService.MergeError)) return next(err);
    req.flash('danger', err.message);
    res.redirect(back(req, '/config#move'));
  }
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
    const wiki = req.wikiScope?.wiki;
    const blocks = await membershipService.activeBlocks(req.contest.id);
    res.render('pages/contest/participants', {
      blocks,
      canBlock: (req.wikiScope || req.eventWikis.length > 1 ? req.scope.global : req.permissions).has('manageParticipants'),
      title: `People — ${req.contest.title}`,
      members: wiki ? members.filter((m) => !m.wiki || m.wiki === wiki) : members,
      memberWikis: !req.wikiScope && req.eventWikis.length > 1 ? req.eventWikis : [],
      overrides,
      roleOptions: Object.entries(EVENT_ROLES).filter(([role]) => req.permissions.has(ROLE_MANAGEMENT_PERMISSION[role])),
      ROLE_MANAGEMENT_PERMISSION,
      overridable: OVERRIDABLE_PERMISSIONS,
      permissionLabels: PERMISSIONS,
      query: { show: typeof req.query.show === 'string' ? req.query.show : '', q: typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '', page: Number.parseInt(req.query.page, 10) || 1 },
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
    const wiki = req.wikiScope ? req.wikiScope.wiki : req.eventWikis.some((w) => w.wiki === req.body.wiki) ? req.body.wiki : '';
    await membershipService.addMember({ actorId: req.user.id, contest: req.contest, settings: req.settings, user, role, wiki });
    req.flash('success', `${user.username} added as ${EVENT_ROLES[role].label.toLowerCase()}${wiki ? ` for ${wiki}` : ''}.`);
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
      // Event-wide staff can only be removed with event-wide authority (unless the event has one wiki).
      allowed: (p, wiki) => (wiki ? req.scope.forWiki(wiki) : req.eventWikis.length > 1 && !p.includes('Participants') ? req.scope.global : req.permissions).has(p),
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
    const wiki = defaultWikiFor(req, req.body.wiki);
    if (req.eventWikis.length > 1 && !wiki) throw new membershipService.MembershipError('Choose the wiki you will take part from.');
    await membershipService.join({ user: req.user, contest: req.contest, settings: req.settings, wiki });
    req.flash('success', wiki && req.eventWikis.length > 1 ? `You've joined this event on ${wiki}.` : "You've joined this event.");
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

async function blockUser(req, res, next) {
  try {
    const user = await resolveUser(req);
    await membershipService.block({ actorId: req.user.id, contest: req.contest, user, reason: String(req.body.reason || '').trim() });
    req.flash('success', `${user.username} is blocked from this event.`);
  } catch (err) {
    if (!handled(err)) return next(err);
    req.flash('danger', err.message);
  }
  res.redirect(back(req, '/participants#blocks'));
}

async function unblockUser(req, res, next) {
  try {
    await membershipService.unblock({ actorId: req.user.id, contest: req.contest, blockId: Number(req.params.blockId) });
    req.flash('success', 'Block lifted.');
  } catch (err) {
    if (!handled(err)) return next(err);
    req.flash('danger', err.message);
  }
  res.redirect(back(req, '/participants#blocks'));
}

const canSeeStats = (req) => req.settings.publicStatisticsEnabled || req.permissions.has('viewStatistics');

// Statistics are part of the overview now; old links land there.
function statistics(req, res) {
  res.redirect(301, `${req.base || '/'}#statistics`);
}

async function activity(req, res, next) {
  try {
    res.render('pages/contest/activity', { title: `Activity — ${req.contest.title}`, entries: await contestService.activity(req.contest.id) });
  } catch (err) {
    next(err);
  }
}

const eventData = require('../services/eventDataService');

// /export/entries.csv and the like: one dataset in one format.
async function exportData(req, res, next) {
  try {
    const { dataset, format } = req.params;
    if (!eventData.DATASETS[dataset] || !eventData.FORMATS[format]) return res.status(404).render('pages/404', { title: 'Not Found' });
    const title = `${req.contest.title} — ${eventData.DATASETS[dataset]}`;
    const file = eventData.render(await eventData.table(req.contest, req.eventSettings, dataset, { wiki: req.wikiScope?.wiki }), format, title);
    const name = `${req.contest.slug}${req.wikiScope ? '-' + req.wikiScope.code : ''}-${dataset}.${file.ext}`;
    res.setHeader('Content-Type', file.type);
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.send(file.body);
  } catch (err) {
    next(err);
  }
}

async function clearData(req, res, next) {
  try {
    const n = await eventData.clear({ actor: req.user, contest: req.contest, what: req.params.what });
    req.flash('success', req.t('{n} rows removed.', { n }));
    res.redirect(`${req.base}/config#data`);
  } catch (err) {
    next(err);
  }
}

module.exports = { exportData, clearData,
  show,
  config,
  updateConfig,
  changeStatus,
  move,
  destroy,
  people,
  addMember,
  removeMember,
  setOverride,
  removeOverride,
  join,
  leave,
  blockUser,
  unblockUser,
  defaultWikiFor,
  activity,
  statistics,
};

// Take the series' or edition's value again for one setting.
async function followSetting(req, res, next) {
  const inherit = require('../services/inheritService');
  try {
    await inherit.follow({ actorId: req.user.id, contest: req.contest, key: String(req.body.key || '') });
    req.flash('success', req.t('Saved.'));
  } catch (err) {
    if (!(err instanceof inherit.InheritError)) return next(err);
    req.flash('danger', req.t(err.message));
  }
  res.redirect(`${req.eventBase}/config#inherited`);
}
module.exports.followSetting = followSetting;

// Stage 5 on one event: move it (or detach it) to another series or edition, or copy it there.
// The event's managers may do it when they also run the place it goes to; taking it out of a
// series or edition needs whoever runs that series or edition (or a platform manager).
async function structure(req, res, next) {
  const structureService = require('../services/structureService');
  const scopeRoles = require('../services/scopeRoleService');
  try {
    const raw = String(req.body.target || 'none');
    const m = /^([se]):(\d+)$/.exec(raw);
    const target = m ? (m[1] === 's' ? { seriesId: Number(m[2]) } : { editionId: Number(m[2]) }) : {};
    if (m && !(await scopeRoles.placesFor(req)).some((p) => p.value === raw)) throw new structureService.StructureError('Choose a series or edition you run.');
    const slug = String(req.body.slug || '').trim().toLowerCase() || undefined;
    if (req.params.action === 'move') {
      const parentRun = req.contest.editionId
        ? await scopeRoles.canRunEdition(req, req.edition)
        : req.contest.seriesId ? await scopeRoles.canRunSeries(req, req.contest.seriesId) : true;
      if (!parentRun) throw new structureService.StructureError('Only those who run its series or edition can take the event out of it.');
      const moved = await structureService.moveEvent({ actorId: req.user.id, contest: req.contest, target, slug });
      req.flash('success', req.t('Moved. The event is now at {path}; the old address no longer works.', { path: moved.path }));
      return res.redirect(`${moved.path}/config`);
    }
    const copy = await structureService.copyEvent({ actorId: req.user.id, contest: req.contest, target, slug });
    req.flash('success', req.t('Copied as a draft at {path}. Check its dates and settings, then publish it.', { path: copy.path }));
    res.redirect(`${copy.path}/config`);
  } catch (err) {
    if (!(err instanceof structureService.StructureError)) return next(err);
    req.flash('danger', req.t(err.message));
    res.redirect(`${req.eventBase}/config#structure`);
  }
}
module.exports.structure = structure;

// One field edited in place on the event's pages: its title or its description.
async function inlineUpdate(req, res, next) {
  try {
    const data = {};
    if ('title' in req.body) {
      const title = String(req.body.title || '').trim().slice(0, 1000);
      if (!title) {
        req.flash('danger', req.t('Give the event a title.'));
        return res.redirect(req.eventBase);
      }
      data.title = title;
    }
    if ('description' in req.body) data.description = String(req.body.description || '').trim().slice(0, 10000);
    const changed = Object.keys(data).filter((k) => data[k] !== req.contest[k]);
    if (changed.length) {
      await prisma.contest.update({ where: { id: req.contest.id }, data });
      await require('../services/auditService').record({ actorId: req.user.id, contestId: req.contest.id, action: 'contest.updated', entityType: 'Contest', entityId: req.contest.id, details: { changed } });
      req.flash('success', req.t('Saved.'));
    }
    res.redirect(req.eventBase);
  } catch (err) {
    next(err);
  }
}
module.exports.inlineUpdate = inlineUpdate;

// A wiki's own type, from the Wikis card.
async function setWikiType(req, res, next) {
  try {
    await eventWikiService.setType({ actorId: req.user.id, contest: req.contest, wikiId: Number(req.params.wikiId), type: String(req.body.type || '') });
    req.flash('success', req.t('Saved.'));
  } catch (err) {
    if (!(err instanceof eventWikiService.EventWikiError)) return next(err);
    req.flash('danger', req.t(err.message));
  }
  res.redirect(`${req.eventBase}/config#wikis`);
}
module.exports.setWikiType = setWikiType;

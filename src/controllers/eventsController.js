const prisma = require('../config/prisma');
const contestService = require('../services/contestService');
const contestForm = require('../services/contestFormService');
const eventService = require('../services/eventService');
const { canUseWikiForEvents } = require('../services/permissionService');
const { EVENT_TYPES } = require('../events/eventTypes');
const catalogService = require('../wiki/catalogService');
const { CONTEST_TYPES, STATUS_GROUPS } = require('../utils/contestLabels');
const membershipService = require('../services/membershipService');
const userDirectory = require('../services/userDirectoryService');
const { eventPath } = require('../utils/format');
const scopeRoles = require('../services/scopeRoleService');

const GROUP_TITLES = { active: 'Active events', upcoming: 'Upcoming events', completed: 'Completed events' };

async function index(req, res, next) {
  try {
    const group = STATUS_GROUPS[req.params.group] ? req.params.group : undefined;
    const filters = {
      group,
      type: CONTEST_TYPES[req.query.type] ? req.query.type : '',
      wiki: typeof req.query.wiki === 'string' ? req.query.wiki.slice(0, 64) : '',
      q: typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '',
      sort: contestService.SORTS[req.query.sort] ? req.query.sort : 'newest',
      project: require('../utils/projectStyle').PROJECTS[req.query.project] ? req.query.project : '',
      view: req.query.view === 'list' ? 'list' : 'grid',
    };
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const result = await contestService.listPublic({ ...filters, page, perPage: filters.view === 'list' ? 30 : 12 });
    res.render('pages/events/index', {
      title: `${GROUP_TITLES[group] || 'All events'} — Zury`,
      heading: GROUP_TITLES[group] || 'All events',
      filters,
      result,
      groups: Object.keys(GROUP_TITLES),
      PROJECTS: require('../utils/projectStyle').PROJECTS,
    });
  } catch (err) {
    next(err);
  }
}

// The type is chosen on the first page; ?type= preselects it (from "Create" links per type).
function renderForm(res, { type, form, errors = {}, status = 200 }) {
  res.status(status).render('pages/events/create', {
    title: 'Create an event — Zury',
    type: EVENT_TYPES[type] ? type : '',
    typeDef: EVENT_TYPES[type] || null,
    form,
    errors,
  });
}

function createForm(req, res) {
  const type = EVENT_TYPES[req.query.type] ? req.query.type : '';
  const form = contestForm.newForm(type || 'writing');
  if (!type) form.type = '';
  // From a series or edition page: the event is created there.
  if (/^[a-z0-9-]{1,80}$/.test(req.query.series || '')) form.seriesSlug = req.query.series;
  if (/^[a-z0-9-]{1,20}$/.test(req.query.edition || '')) form.edition = req.query.edition;
  renderForm(res, { type, form });
}

// Co-organizers and jury named on the form; people who can't be added are reported, not fatal.
async function addStartingTeam(req, contest, settings) {
  const problems = [];
  for (const [field, role] of [['organizers', 'organizer'], ['jury', 'jury']]) {
    for (const name of [].concat(req.body[field] || []).map((n) => String(n).trim()).filter(Boolean).slice(0, 20)) {
      try {
        const user = await userDirectory.findOrImport(name);
        if (!user) throw new Error(`No Wikimedia user named “${name}”.`);
        if (user.id === req.user.id && role === 'organizer') continue;
        await membershipService.addMember({ actorId: req.user.id, contest, settings, user, role });
      } catch (err) {
        problems.push(err.message);
      }
    }
  }
  return problems;
}

async function create(req, res, next) {
  const { type } = req.body;
  if (!EVENT_TYPES[type]) {
    return renderForm(res, { type: '', form: { ...contestForm.newForm('writing'), ...req.body, type: '' }, errors: { type: 'Choose the type of event.' }, status: 422 });
  }
  let catalog;
  try {
    catalog = await catalogService.validators();
  } catch (err) {
    return next(err);
  }
  const parsed = contestForm.parse(req.body, { type, wikiAllowed: (w) => canUseWikiForEvents(req.subject, w), catalog });
  if (Object.keys(parsed.errors).length) {
    return renderForm(res, { type, form: parsed.form, errors: parsed.errors, status: 422 });
  }
  if (!(await scopeRoles.mayPlace(req, parsed.series))) {
    return renderForm(res, { type, form: parsed.form, errors: { seriesSlug: 'Only the organizers of that series or edition can add events to it.' }, status: 403 });
  }
  try {
    const contest = await eventService.create({
      actorId: req.user.id,
      type,
      parsed,
      autoSlug: parsed.autoSlug,
    });
    const problems = await addStartingTeam(req, contest, { ...contestForm.defaultSettings(type), ...parsed.settings });
    req.flash('success', 'Event created as a draft. Review the settings, then publish it when ready.');
    if (problems.length) req.flash('warning', `Not added: ${problems.join(' ')}`);
    const pr = await require('../services/participationService').afterSave({ actorId: req.user.id, contest }).catch(() => ({}));
    if (pr.eligibleError) req.flash('warning', req.t('The eligible articles could not be fetched: {error}', { error: pr.eligibleError }));
    const full = await prisma.contest.findUnique({ where: { id: contest.id }, select: { id: true, path: true } });
    res.redirect(`${eventPath(full)}/config`);
  } catch (err) {
    if (err instanceof eventService.EventError) {
      return renderForm(res, { type, form: parsed.form, errors: { [err.field]: err.message }, status: 422 });
    }
    next(err);
  }
}

// /<series>: every edition of a recurring event. Unknown slugs fall through to 404.
// Its organizers (a series role) and people who manage every event run it and start editions.
function canRunSeries(req, seriesId) {
  return scopeRoles.canRunSeries(req, seriesId);
}

function seriesForm(req, res) {
  res.render('pages/events/seriesNew', { title: 'New series — Zury', form: { slug: '', title: '', description: '' }, errors: {} });
}

async function createSeries(req, res, next) {
  const seriesService = require('../services/seriesService');
  try {
    const created = await seriesService.create({ actorId: req.user.id, slug: req.body.slug, title: req.body.title, description: req.body.description });
    req.flash('success', 'Series created. Create its first edition with “Part of” set to it.');
    res.redirect(`/${created.slug}`);
  } catch (err) {
    if (!(err instanceof seriesService.SeriesError)) return next(err);
    res.status(400).render('pages/events/seriesNew', { title: 'New series — Zury', form: req.body, errors: { [err.field || 'title']: err.message } });
  }
}

async function nextEdition(req, res, next) {
  const seriesService = require('../services/seriesService');
  try {
    const found = await prisma.eventSeries.findUnique({ where: { slug: req.params.series } });
    if (!found) return next();
    if (!(await canRunSeries(req, found.id))) {
      const err = new Error("You don't have permission to do that.");
      err.status = 403;
      return next(err);
    }
    const created = await seriesService.nextEdition({ actorId: req.user.id, series: found });
    req.flash('success', 'The next edition is ready, with a draft copy of each event: check their dates and settings, then publish them.');
    res.redirect(`/${found.slug}/${created.slug}`);
  } catch (err) {
    const seriesService = require('../services/seriesService');
    if (!(err instanceof seriesService.SeriesError || err instanceof require('../services/structureService').StructureError)) return next(err);
    req.flash('danger', req.t(err.message));
    res.redirect(`/${req.params.series}`);
  }
}

// /series: every series and its editions, to edit or extend.
async function manageSeries(req, res, next) {
  try {
    const all = await require('../services/seriesService').listAll();
    const allowed = [];
    for (const sr of all) if (await canRunSeries(req, sr.id)) allowed.push(sr);
    res.render('pages/events/seriesManage', { title: 'Series and editions — Zury', seriesList: allowed });
  } catch (err) {
    next(err);
  }
}




function forbiddenPage(next) {
  const err = new Error("You don't have permission to do that.");
  err.status = 403;
  return next(err);
}

async function seriesAction(req, res, next) {
  const seriesService = require('../services/seriesService');
  try {
    const found = await prisma.eventSeries.findUnique({ where: { slug: req.params.series } });
    if (!found) return next();
    if (!(await canRunSeries(req, found.id))) {
      const err = new Error("You don't have permission to do that.");
      err.status = 403;
      return next(err);
    }
    if (req.params.action === 'delete') {
      // Only an empty series can be deleted (a soft delete; it can be restored).
      await require('../services/structureService').deleteLevel({ actorId: req.user.id, level: { seriesId: found.id } });
      req.flash('success', 'Series deleted. It can be restored from the deleted list.');
    } else {
      const { _csrf, back, ...fields } = req.body;
      await seriesService.update({ actorId: req.user.id, series: found, ...fields });
      req.flash('success', 'Saved.');
    }
  } catch (err) {
    if (!(err instanceof seriesService.SeriesError) && !(err instanceof require('../services/structureService').StructureError)) return next(err);
    req.flash('danger', req.t(err.message));
    if (req.params.action === 'delete') return res.redirect(`/${req.params.series}?tab=settings`);
  }
  res.redirect(req.params.action === 'delete' ? '/series' : `/${req.params.series}${req.body.back === 'overview' ? '' : '?tab=settings'}`);
}


module.exports = { index, createForm, create, seriesForm, createSeries, nextEdition, manageSeries, seriesAction };

// A series' first edition from a few fields: edition, type, wiki and dates. The rest has
// sensible defaults; the organizer fine-tunes it in the edition's settings afterwards.
// A new, empty edition of a series (events are added to it afterwards).
async function firstEdition(req, res, next) {
  const seriesService = require('../services/seriesService');
  const series = await prisma.eventSeries.findUnique({ where: { slug: req.params.series } }).catch(() => null);
  if (!series) return next();
  try {
    if (!(await canRunSeries(req, series.id))) {
      const err = new Error("You don't have permission to do that.");
      err.status = 403;
      return next(err);
    }
    const day = (v, end) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? new Date(`${v}T${end ? '23:59:59' : '00:00:00'}Z`) : null);
    const edition = await seriesService.createEdition({
      actorId: req.user.id, series, slug: req.body.edition, title: req.body.title, startDate: day(req.body.startDate), endDate: day(req.body.endDate, true),
    });
    req.flash('success', req.t('Edition created. Add its events next.'));
    res.redirect(`/${series.slug}/${edition.slug}`);
  } catch (err) {
    if (!(err instanceof seriesService.SeriesError)) return next(err);
    req.flash('danger', req.t(err.message));
    res.redirect(`/${series.slug}`);
  }
}
module.exports.firstEdition = firstEdition;

// People of a series and its editions: a role on one level, optionally for everything below it.
// Series organizers give roles anywhere in the series; an edition's organizers only on that edition.
async function peopleAction(req, res, next, fn) {
  try {
    const sr = await prisma.eventSeries.findUnique({ where: { slug: req.params.series }, include: { editionRecords: { where: { deletedAt: null }, select: { id: true, slug: true, seriesId: true } } } });
    if (!sr) return next();
    const runsSeries = await canRunSeries(req, sr.id);
    const editionIds = [];
    for (const e of sr.editionRecords) if (runsSeries || (await scopeRoles.canRunEdition(req, e))) editionIds.push(e.id);
    if (!runsSeries && !editionIds.length) return forbiddenPage(next);
    await fn({ sr, runsSeries, editionIds });
  } catch (err) {
    if (!(err instanceof scopeRoles.ScopeRoleError)) return next(err);
    req.flash('danger', req.t(err.message));
  }
  const tab = req.path.includes('/settings') ? 'settings' : 'people';
  const ed = Number(req.body.editionId) ? await prisma.edition.findUnique({ where: { id: Number(req.body.editionId) }, select: { slug: true } }) : null;
  res.redirect(ed ? `/series/${req.params.series}/${ed.slug}?tab=${tab}` : `/${req.params.series}?tab=${tab}`);
}

function grantRole(req, res, next) {
  return peopleAction(req, res, next, async ({ sr, runsSeries, editionIds }) => {
    const editionId = Number(req.body.editionId) || null;
    if (editionId ? !editionIds.includes(editionId) : !runsSeries) throw new scopeRoles.ScopeRoleError("You can't give roles there.");
    await scopeRoles.grant({ actorId: req.user.id, username: req.body.username, role: req.body.role, level: editionId ? { editionId } : { seriesId: sr.id }, appliesToChildren: req.body.appliesToChildren === 'on' });
    req.flash('success', req.t('Role given.'));
  });
}

function revokeRole(req, res, next) {
  return peopleAction(req, res, next, async ({ sr, runsSeries, editionIds }) => {
    await scopeRoles.revoke({ actorId: req.user.id, id: Number(req.params.id), seriesId: runsSeries ? sr.id : -1, editionIds });
    req.flash('success', req.t('Role removed.'));
  });
}
module.exports.grantRole = grantRole;
module.exports.revokeRole = revokeRole;

// Settings a series or edition gives the events below (locked, default or optional).
function setLevelSetting(req, res, next) {
  const inherit = require('../services/inheritService');
  return peopleAction(req, res, next, async ({ sr, runsSeries, editionIds }) => {
    const editionId = Number(req.body.editionId) || null;
    if (editionId ? !editionIds.includes(editionId) : !runsSeries) throw new scopeRoles.ScopeRoleError("You can't change settings there.");
    try {
      const { changed, events } = await inherit.setRule({ actorId: req.user.id, level: editionId ? { editionId } : { seriesId: sr.id }, key: req.body.key, value: req.body.value, mode: req.body.mode });
      req.flash('success', req.t('Saved. {changed} of {events} events below changed.', { changed, events }));
    } catch (err) {
      if (err instanceof inherit.InheritError) throw new scopeRoles.ScopeRoleError(err.message);
      throw err;
    }
  });
}

function removeLevelSetting(req, res, next) {
  const inherit = require('../services/inheritService');
  return peopleAction(req, res, next, async ({ sr, runsSeries, editionIds }) => {
    try {
      await inherit.removeRule({ actorId: req.user.id, id: Number(req.params.id), seriesId: runsSeries ? sr.id : -1, editionIds });
    } catch (err) {
      if (err instanceof inherit.InheritError) throw new scopeRoles.ScopeRoleError(err.message);
      throw err;
    }
    req.flash('success', req.t('Removed. Events below keep their current values as their own.'));
  });
}
module.exports.setLevelSetting = setLevelSetting;
module.exports.removeLevelSetting = removeLevelSetting;

// The edition named in the address, for adding events to it; null when there is none.
async function editionFromParams(req) {
  const sr = await prisma.eventSeries.findUnique({ where: { slug: req.params.series } });
  if (!sr) return null;
  const edition = await prisma.edition.findFirst({ where: { seriesId: sr.id, slug: req.params.edition, deletedAt: null } });
  return edition ? { sr, edition } : null;
}

// /wam/2026 → "Add event" → "Import from Fountain": the editathon becomes an event of this edition.
async function editionFountain(req, res, next) {
  const fountain = require('../services/fountainService');
  const found = await editionFromParams(req).catch(next);
  if (!found) return next();
  const { sr, edition } = found;
  const back = `/${sr.slug}/${edition.slug}`;
  if (!(await scopeRoles.canRunEdition(req, edition))) return forbiddenPage(next);
  try {
    const type = ['writing', 'editathon'].includes(req.body.type) ? req.body.type : 'writing';
    const { contest, existed } = await fountain.importEvent({ actorId: req.user.id, input: req.body.code, type, series: { slug: sr.slug, edition: edition.slug, title: sr.title } });
    const path = (await prisma.contest.findUnique({ where: { id: contest.id }, select: { path: true } })).path;
    req.flash(existed ? 'warning' : 'success', req.t(existed ? 'This editathon is already in Zury.' : 'Imported from Fountain.'));
    res.redirect(path || back);
  } catch (err) {
    const { EventWikiError } = require('../services/eventWikiService');
    if (!(err instanceof fountain.FountainError || err instanceof EventWikiError || err instanceof eventService.EventError)) return next(err);
    req.flash('danger', req.t(err.message));
    res.redirect(back);
  }
}

module.exports.editionFountain = editionFountain;

// Stage 5 on an edition or a series: copy an edition, archive or unarchive a level.
async function levelAction(req, res, next) {
  const structureService = require('../services/structureService');
  const back = `${req.params.edition ? `/series/${req.params.series}/${req.params.edition}` : `/${req.params.series}`}${req.body && req.body.back === 'overview' ? '' : '?tab=settings'}`;
  try {
    const sr = await prisma.eventSeries.findUnique({ where: { slug: req.params.series } });
    if (!sr) return next();
    let edition = null;
    if (req.params.edition) {
      edition = await prisma.edition.findFirst({ where: { seriesId: sr.id, slug: req.params.edition, deletedAt: null } });
      if (!edition) return next();
    }
    const allowed = edition ? await scopeRoles.canRunEdition(req, edition) : await canRunSeries(req, sr.id);
    // Copying an edition makes a new one in the series: that is for those who run the series.
    if (!allowed || (req.params.action === 'copy' && !(await canRunSeries(req, sr.id)))) return forbiddenPage(next);
    const level = edition ? { editionId: edition.id } : { seriesId: sr.id };
    if (req.params.action === 'delete') {
      if (!req.permissions.has('deleteAnything') && !req.permissions.has('deleteAnyEvent')) return forbiddenPage(next);
      await structureService.deleteLevel({ actorId: req.user.id, level });
      req.flash('success', req.t('Edition deleted. It can be restored from the deleted list.'));
      return res.redirect(`/${sr.slug}?tab=overview`);
    }
    if (req.params.action === 'update') {
      const title = String(req.body.title || '').trim().slice(0, 200);
      if (!title) throw new structureService.StructureError('Give the edition a title.');
      const day = (v, end) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? new Date(`${v}T${end ? '23:59:59' : '00:00:00'}Z`) : null);
      const startDate = day(req.body.startDate);
      const endDate = day(req.body.endDate, true);
      if (startDate && endDate && endDate < startDate) throw new structureService.StructureError('The end date must be after the start date.');
      const data = { title, description: String(req.body.description || '').trim().slice(0, 2000), startDate, endDate };
      // The rest only when the settings form sends it (an inline edit sends a few fields).
      if (req.body.identifier !== undefined) data.identifier = String(req.body.identifier).trim().slice(0, 100) || edition.slug;
      if (req.body.cycleType !== undefined) data.cycleType = ['annual', 'season', 'phase', 'special', 'other'].includes(req.body.cycleType) ? req.body.cycleType : null;
      if (req.body.year !== undefined) {
        const y = Number.parseInt(req.body.year, 10);
        data.year = Number.isInteger(y) && y >= 1900 && y <= 2200 ? y : null;
      }
      if (req.body.visibility !== undefined) data.visibility = ['public', 'unlisted', 'private'].includes(req.body.visibility) ? req.body.visibility : 'public';
      // Archived has its own button.
      if (req.body.status !== undefined && ['draft', 'planned', 'upcoming', 'active', 'completed', 'cancelled'].includes(req.body.status) && edition.status !== 'archived') data.status = req.body.status;
      await prisma.edition.update({ where: { id: edition.id }, data });
      await require('../services/auditService').record({ actorId: req.user.id, action: 'edition.updated', entityType: 'Edition', entityId: edition.id, details: { title } });
      req.flash('success', req.t('Saved.'));
      return res.redirect(back);
    }
    if (req.params.action === 'copy') {
      const years = Math.max(0, Math.min(10, Number.parseInt(req.body.years, 10) || 0));
      const created = await structureService.copyEdition({ actorId: req.user.id, edition, slug: req.body.slug, title: req.body.title, years });
      req.flash('success', req.t('Edition copied, with a draft of each event. Check their dates and settings, then publish them.'));
      return res.redirect(`/${sr.slug}/${created.slug}`);
    }
    if (req.params.action === 'archive') {
      await structureService.archive({ actorId: req.user.id, level });
      req.flash('success', req.t('Archived.'));
    } else {
      await structureService.unarchive({ actorId: req.user.id, level });
      req.flash('success', req.t('Taken out of the archive.'));
    }
    res.redirect(back);
  } catch (err) {
    if (!(err instanceof structureService.StructureError)) return next(err);
    req.flash('danger', req.t(err.message));
    res.redirect(back);
  }
}
module.exports.levelAction = levelAction;

// The series page (/wam) and the edition page (/wam/2026), in tabs. Settings and People are for
// those who run that level, and hold that level's own settings and roles only.
const SERIES_TABS = ['overview', 'editions', 'events', 'statistics', 'people', 'settings'];
const EDITION_TABS = ['overview', 'statistics', 'people', 'settings'];
const RUNNERS_ONLY = ['settings', 'people'];


async function levelExtras(level, tab) {
  const inherit = require('../services/inheritService');
  if (tab === 'settings') {
    const inside = await require('../services/structureService').impact(level);
    const ids = level.editionId ? { seriesId: -1, editionIds: [level.editionId] } : { seriesId: level.seriesId };
    const [rules, history] = await Promise.all([
      prisma.levelSetting.findMany({ where: level, orderBy: { key: 'asc' } }),
      inherit.history(ids),
    ]);
    return { rules, history, KEYS: inherit.KEYS, inside };
  }
  if (tab === 'people') {
    const people = await prisma.scopeRole.findMany({ where: level, include: { user: { select: { id: true, username: true } } }, orderBy: [{ role: 'asc' }, { assignedAt: 'asc' }] });
    // An edition also has the series' people whose role reaches its editions (shown apart, managed on the series).
    let inherited = [];
    if (level.editionId) {
      const ed1 = await prisma.edition.findUnique({ where: { id: level.editionId }, select: { seriesId: true } });
      inherited = await prisma.scopeRole.findMany({ where: { seriesId: ed1.seriesId, appliesToChildren: true }, include: { user: { select: { id: true, username: true } } }, orderBy: [{ role: 'asc' }] });
    }
    return { people, inherited, ROLES: scopeRoles.ROLES };
  }
  return {};
}

async function seriesPage(req, res, next) {
  try {
    const { RESERVED } = require('../middleware/permissions');
    if (RESERVED.has(req.params.series)) return next();
    const found = await prisma.eventSeries.findUnique({ where: { slug: req.params.series } });
    if (!found || found.deletedAt) return next();
    const canRun = await canRunSeries(req, found.id);
    // A draft or private series is only for those who run it.
    if (!canRun && (found.status === 'draft' || found.visibility === 'private')) return next();
    let tab = SERIES_TABS.includes(req.query.tab) ? req.query.tab : 'overview';
    if (!canRun && RUNNERS_ONLY.includes(tab)) tab = 'overview';
    const directEvents = await prisma.contest.findMany({
      where: { seriesId: found.id, deletedAt: null, ...(canRun ? {} : { visibility: 'public', status: { not: 'draft' } }) },
      orderBy: [{ sortOrder: 'asc' }, { startDate: 'desc' }],
      select: contestService.CARD_SELECT,
    });
    const summary = await require('../services/seriesService').summary(found.id, { drafts: canRun });
    const stats = require('../services/statsService');
    // The whole series at once: a person or an entry in several editions counts once.
    const totals = await stats.rollup([...summary.flatMap((e) => e.events.map((ev) => ev.id)), ...directEvents.map((ev) => ev.id)]);
    const rows = summary.map((e) => ({ label: e.slug, sub: e.title, href: `/${found.slug}/${e.slug}`, status: e.status, stats: e }));
    for (const c of directEvents) rows.push({ label: c.title, sub: req.t('Event of the series'), href: eventPath(c), status: c.status, stats: await stats.rollup([c.id]) });
    const wikiRows = tab === 'statistics' ? await stats.byWiki([...summary.flatMap((e) => e.events.map((ev) => ev.id)), ...directEvents.map((ev) => ev.id)]) : [];
    res.render('pages/events/series', { wikiRows, title: `${found.title} — Zury`, series: found, editions: summary, directEvents, summary, totals, rows, canRun, tab, ...(await levelExtras({ seriesId: found.id }, tab)) });
  } catch (err) {
    next(err);
  }
}

async function editionTabs(req, res, next) {
  try {
    const { RESERVED } = require('../middleware/permissions');
    if (RESERVED.has(req.params.series)) return next();
    const sr = await prisma.eventSeries.findUnique({ where: { slug: req.params.series } });
    if (!sr) return next();
    const entry = await prisma.seriesSlug.findUnique({ where: { seriesId_slug: { seriesId: sr.id, slug: req.params.edition } } });
    if (!entry || !entry.editionId) return next(); // a direct event of the series, or nothing
    const edition = await prisma.edition.findFirst({ where: { id: entry.editionId, deletedAt: null } });
    if (!edition) return next();
    // Its event, when it has one, is at this address; the edition's own tabs are under /series.
    if (!req.path.startsWith('/series/') && (await prisma.contest.findFirst({ where: { path: `/${sr.slug}/${edition.slug}`, deletedAt: null }, select: { id: true } }))) return next();
    // The edition's own people (or the series' with a role for its children) see its drafts.
    const canRun = await scopeRoles.canRunEdition(req, edition);
    const canSee = canRun || (await scopeRoles.canSeeEdition(req, edition));
    let tab = EDITION_TABS.includes(req.query.tab) ? req.query.tab : 'overview';
    if (!canSee && (edition.visibility === 'private' || edition.status === 'draft')) return next();
    if (!canRun && RUNNERS_ONLY.includes(tab)) tab = 'overview';
    const events = await prisma.contest.findMany({
      where: { editionId: edition.id, deletedAt: null, ...(canSee ? {} : { visibility: 'public', status: { not: 'draft' } }) },
      orderBy: { startDate: 'asc' },
      select: contestService.CARD_SELECT,
    });
    const stats = require('../services/statsService');
    let totals = null;
    let rows = [];
    if (tab === 'overview' || tab === 'statistics') {
      totals = await stats.rollup(events.map((ev) => ev.id));
      rows = await Promise.all(events.map(async (c) => ({ label: c.title, href: eventPath(c), status: c.status, stats: await stats.rollup([c.id]) })));
    }
    const canRunSeriesHere = canRun && (await canRunSeries(req, sr.id));
    // An edition with its one event shows that event's status (an archived edition stays archived).
    const shown = { ...edition, status: edition.status !== 'archived' && events.length === 1 ? events[0].status : edition.status };
    const wikiRows = tab === 'statistics' ? await stats.byWiki(events.map((ev) => ev.id)) : [];
    res.render('pages/events/edition', { wikiRows, title: `${edition.title} — Zury`, sr, edition: shown, ownStatus: edition.status, events, canRun, canRunSeries: canRunSeriesHere, tab, totals, rows, ...(await levelExtras({ editionId: edition.id }, tab)) });
  } catch (err) {
    next(err);
  }
}

// The old management pages now live in the tabs.
function manageOneSeriesTabs(req, res) {
  res.redirect(`/${req.params.series}?tab=settings`);
}
function manageEditionTabs(req, res, next) {
  return editionTabs(req, res, next);
}
module.exports.series = seriesPage;
module.exports.editionPage = editionTabs;
module.exports.manageOneSeries = manageOneSeriesTabs;
module.exports.manageEdition = manageEditionTabs;

// Moves an edition or a direct event of a series up or down, or makes it the featured one.
async function seriesOrder(req, res, next) {
  try {
    const sr = await prisma.eventSeries.findUnique({ where: { slug: req.params.series } });
    if (!sr) return next();
    if (!(await canRunSeries(req, sr.id))) return forbiddenPage(next);
    const kind = req.body.kind === 'event' ? 'event' : 'edition';
    const id = Number(req.body.id);
    const model = kind === 'event' ? prisma.contest : prisma.edition;
    const where = kind === 'event' ? { seriesId: sr.id, deletedAt: null } : { seriesId: sr.id, deletedAt: null };
    const list = await model.findMany({ where, orderBy: kind === 'event' ? [{ sortOrder: 'asc' }, { startDate: 'desc' }] : [{ sortOrder: 'asc' }, { year: 'desc' }, { slug: 'desc' }], select: { id: true, featured: true } });
    const i = list.findIndex((x) => x.id === id);
    if (i < 0) return next();
    await prisma.$transaction(async (tx) => {
      const m = kind === 'event' ? tx.contest : tx.edition;
      if (req.body.action === 'feature') {
        const on = !list[i].featured;
        await m.updateMany({ where, data: { featured: false } });
        if (on) await m.update({ where: { id }, data: { featured: true } });
      } else {
        const j = req.body.action === 'up' ? i - 1 : i + 1;
        if (j >= 0 && j < list.length) [list[i], list[j]] = [list[j], list[i]];
        for (let k = 0; k < list.length; k += 1) await m.update({ where: { id: list[k].id }, data: { sortOrder: k + 1 } });
      }
    });
    await require('../services/auditService').record({ actorId: req.user.id, action: `series.${req.body.action === 'feature' ? 'featured' : 'reordered'}`, entityType: 'EventSeries', entityId: sr.id, details: { kind, id } });
  } catch (err) {
    return next(err);
  }
  res.redirect(`/${req.params.series}?tab=${req.body.kind === 'event' ? 'events' : 'editions'}`);
}
module.exports.seriesOrder = seriesOrder;

// An event out of a series or edition, keeping everything it has: under the series directly, or standalone.
async function detachEvent(req, res, next) {
  const structureService = require('../services/structureService');
  const back = req.body.back === 'edition' && req.body.edition ? `/series/${req.params.series}/${req.body.edition}?tab=settings` : `/${req.params.series}?tab=settings`;
  try {
    const sr = await prisma.eventSeries.findUnique({ where: { slug: req.params.series } });
    if (!sr) return next();
    if (!(await canRunSeries(req, sr.id))) return forbiddenPage(next);
    const contest = await prisma.contest.findFirst({ where: { id: Number(req.body.eventId), deletedAt: null, OR: [{ seriesId: sr.id }, { editionOf: { seriesId: sr.id } }] } });
    if (!contest) return next();
    const target = req.body.to === 'series' ? { seriesId: sr.id } : {};
    const moved = await structureService.moveEvent({ actorId: req.user.id, contest, target });
    req.flash('success', req.t('The event is now at {path}.', { path: moved.path }));
  } catch (err) {
    if (!(err instanceof structureService.StructureError)) return next(err);
    req.flash('danger', req.t(err.message));
  }
  res.redirect(back);
}

// Deleted series and editions: restore them, or (superusers) remove them for good.
async function deletedPage(req, res, next) {
  try {
    const list = await require('../services/structureService').deletedLevels();
    res.render('pages/events/seriesDeleted', { title: 'Deleted series and editions — Zury', list });
  } catch (err) {
    next(err);
  }
}

async function deletedAction(req, res, next) {
  const structureService = require('../services/structureService');
  const kind = req.params.kind === 'edition' ? 'edition' : 'series';
  const id = Number(req.params.id);
  try {
    if (req.params.action === 'purge') {
      if (!req.permissions.has('deleteAnything')) return forbiddenPage(next);
      await structureService.purgeLevel({ actorId: req.user.id, kind, id });
      req.flash('success', req.t('Removed for good.'));
    } else {
      const path = await structureService.restoreLevel({ actorId: req.user.id, kind, id });
      req.flash('success', req.t('Restored at {path}.', { path }));
    }
  } catch (err) {
    if (!(err instanceof structureService.StructureError)) return next(err);
    req.flash('danger', req.t(err.message));
  }
  res.redirect('/series/deleted');
}
module.exports.detachEvent = detachEvent;
module.exports.deletedPage = deletedPage;
module.exports.deletedAction = deletedAction;

// A new edition: blank (nothing copied) or copied from an earlier one, choosing what to copy.
async function newEditionForm(req, res, next) {
  try {
    const sr = await prisma.eventSeries.findFirst({ where: { slug: req.params.series, deletedAt: null } });
    if (!sr) return next();
    if (!(await canRunSeries(req, sr.id))) return forbiddenPage(next);
    const list = await prisma.edition.findMany({ where: { seriesId: sr.id, deletedAt: null }, orderBy: [{ sortOrder: 'asc' }, { year: 'desc' }, { slug: 'desc' }], select: { id: true, slug: true, identifier: true, title: true, _count: { select: { events: { where: { deletedAt: null } } } } } });
    const { COPY_PARTS } = require('../services/structureService');
    const from = list.find((e) => e.slug === req.query.from) || list[0] || null;
    const next1 = from && /^\d{4}$/.test(from.slug) ? String(Number(from.slug) + 1) : '';
    res.render('pages/events/editionNew', { title: `${req.t('New edition')} — ${sr.title}`, sr, list, from, COPY_PARTS, method: req.query.method === 'copy' && from ? 'copy' : 'blank', suggested: next1 || String(new Date().getFullYear()) });
  } catch (err) {
    next(err);
  }
}

async function newEdition(req, res, next) {
  const seriesService = require('../services/seriesService');
  const structureService = require('../services/structureService');
  const sr = await prisma.eventSeries.findFirst({ where: { slug: req.params.series, deletedAt: null } }).catch(() => null);
  if (!sr) return next();
  try {
    if (!(await canRunSeries(req, sr.id))) return forbiddenPage(next);
    const day = (v, end) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? new Date(`${v}T${end ? '23:59:59' : '00:00:00'}Z`) : null);
    let edition;
    if (req.body.method === 'copy') {
      const source = await prisma.edition.findFirst({ where: { seriesId: sr.id, slug: String(req.body.from || ''), deletedAt: null } });
      if (!source) throw new structureService.StructureError('Choose the edition to copy.');
      const parts = [].concat(req.body.parts || []).filter((k) => structureService.ALL_PARTS.includes(k));
      // An event's details go with it: its wikis and settings need the event.
      const years = Math.max(0, Math.min(10, Number.parseInt(req.body.years, 10) || 0));
      edition = await structureService.copyEdition({ actorId: req.user.id, edition: source, slug: req.body.edition, title: req.body.title, years, parts });
      req.flash('success', req.t('Edition created from {from}. Check its dates and settings before publishing.', { from: source.identifier || source.slug }));
    } else {
      // Blank: a completely new edition, nothing copied.
      edition = await seriesService.createEdition({ actorId: req.user.id, series: sr, slug: req.body.edition, title: req.body.title, startDate: day(req.body.startDate), endDate: day(req.body.endDate, true) });
      req.flash('success', req.t('Edition created. Add its event next.'));
    }
    res.redirect(`/series/${sr.slug}/${edition.slug}`);
  } catch (err) {
    if (!(err instanceof seriesService.SeriesError) && !(err instanceof structureService.StructureError)) return next(err);
    req.flash('danger', req.t(err.message));
    res.redirect(`/series/${sr.slug}/new-edition${req.body.method === 'copy' ? `?method=copy&from=${encodeURIComponent(req.body.from || '')}` : ''}`);
  }
}
module.exports.newEditionForm = newEditionForm;
module.exports.newEdition = newEdition;

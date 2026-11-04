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
  try {
    const contest = await eventService.create({
      actorId: req.user.id,
      type,
      parsed,
      autoSlug: parsed.autoSlug,
      isDemo: req.user.isDemo,
    });
    const problems = await addStartingTeam(req, contest, { ...contestForm.defaultSettings(type), ...parsed.settings });
    req.flash('success', 'Event created as a draft. Review the settings, then publish it when ready.');
    if (problems.length) req.flash('warning', `Not added: ${problems.join(' ')}`);
    const full = await prisma.contest.findUnique({ where: { id: contest.id }, include: { series: true } });
    res.redirect(`${eventPath(full)}/config`);
  } catch (err) {
    if (err instanceof eventService.EventError) {
      return renderForm(res, { type, form: parsed.form, errors: { [err.field]: err.message }, status: 422 });
    }
    next(err);
  }
}

// /<series>: every edition of a recurring event. Unknown slugs fall through to 404.
// Organizers of any edition, and people who manage every event, can start the next edition.
async function canRunSeries(req, seriesId) {
  if (!req.user) return false;
  if (req.permissions.has('manageAnyEvent')) return true;
  return !!(await prisma.contestMembership.findFirst({ where: { userId: req.user.id, role: 'organizer', status: 'active', contest: { seriesId } } }));
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
    req.flash('success', 'The next edition is ready as a draft: check its dates and settings, then publish it.');
    res.redirect(`/${found.slug}/${created.edition}/config`);
  } catch (err) {
    const seriesService = require('../services/seriesService');
    if (!(err instanceof seriesService.SeriesError)) return next(err);
    req.flash('danger', err.message);
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
      await seriesService.remove({ actorId: req.user.id, series: found });
      req.flash('success', 'Series deleted.');
    } else {
      await seriesService.update({ actorId: req.user.id, series: found, title: req.body.title, description: req.body.description });
      req.flash('success', 'Saved.');
    }
  } catch (err) {
    if (!(err instanceof seriesService.SeriesError)) return next(err);
    req.flash('danger', err.message);
  }
  res.redirect('/series');
}

async function series(req, res, next) {
  try {
    const { RESERVED } = require('../middleware/permissions');
    if (RESERVED.has(req.params.series)) return next();
    const found = await prisma.eventSeries.findUnique({ where: { slug: req.params.series } });
    if (!found) return next();
    const editions = await prisma.contest.findMany({
      where: { seriesId: found.id, deletedAt: null, visibility: 'public', status: { not: 'draft' } },
      orderBy: { edition: 'desc' },
      select: { ...contestService.CARD_SELECT, edition: true },
    });
    res.render('pages/events/series', {
      title: `${found.title} — Zury`,
      series: found,
      editions,
      summary: await require('../services/seriesService').summary(found.id),
      canRun: await canRunSeries(req, found.id),
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { index, createForm, create, series, seriesForm, createSeries, nextEdition, manageSeries, seriesAction };

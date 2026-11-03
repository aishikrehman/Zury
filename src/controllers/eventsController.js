const contestService = require('../services/contestService');
const contestForm = require('../services/contestFormService');
const eventService = require('../services/eventService');
const { canUseWikiForEvents } = require('../services/permissionService');
const { EVENT_TYPES } = require('../events/eventTypes');
const { CONTEST_TYPES, STATUS_GROUPS } = require('../utils/contestLabels');

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
    };
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const result = await contestService.listPublic({ ...filters, page });
    res.render('pages/events/index', {
      title: `${GROUP_TITLES[group] || 'All events'} — Zury`,
      heading: GROUP_TITLES[group] || 'All events',
      filters,
      result,
      groups: Object.keys(GROUP_TITLES),
    });
  } catch (err) {
    next(err);
  }
}

function renderForm(res, { type, form, errors = {}, status = 200 }) {
  res.status(status).render('pages/events/create', {
    title: `New ${EVENT_TYPES[type].label.toLowerCase()} — Zury`,
    type,
    typeDef: EVENT_TYPES[type],
    form,
    errors,
  });
}

function createForm(req, res) {
  const { type } = req.query;
  if (!EVENT_TYPES[type]) {
    return res.render('pages/events/chooseType', { title: 'Create an event — Zury', types: EVENT_TYPES });
  }
  renderForm(res, { type, form: contestForm.newForm(type) });
}

async function create(req, res, next) {
  const { type } = req.body;
  if (!EVENT_TYPES[type]) return res.redirect('/events/create');
  const parsed = contestForm.parse(req.body, { type, wikiAllowed: (w) => canUseWikiForEvents(req.subject, w) });
  if (Object.keys(parsed.errors).length) {
    return renderForm(res, { type, form: parsed.form, errors: parsed.errors, status: 422 });
  }
  try {
    const contest = await eventService.create({
      actorId: req.user.id,
      type,
      parsed,
      autoSlug: !req.body.slug?.trim(),
      isDemo: req.user.isDemo,
    });
    req.flash('success', 'Event created as a draft. Review the settings, then publish it when ready.');
    res.redirect(`/contest/${contest.id}/config`);
  } catch (err) {
    if (err instanceof eventService.EventError) {
      return renderForm(res, { type, form: parsed.form, errors: { [err.field]: err.message }, status: 422 });
    }
    next(err);
  }
}

module.exports = { index, createForm, create };

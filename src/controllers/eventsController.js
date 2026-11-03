const contestService = require('../services/contestService');
const { CONTEST_TYPES, STATUS_GROUPS } = require('../utils/contestLabels');

const GROUP_TITLES = { active: 'Active events', upcoming: 'Upcoming events', completed: 'Completed events' };

async function index(req, res, next) {
  try {
    const group = STATUS_GROUPS[req.params.group] ? req.params.group : undefined;
    const filters = {
      group,
      type: CONTEST_TYPES[req.query.type] ? req.query.type : '',
      wiki: typeof req.query.wiki === 'string' ? req.query.wiki.slice(0, 64) : '',
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

module.exports = { index };

// Person pages: one person's work in an event (/EVENT/user/NAME), or across an edition or a
// series (/series/SERIES[/EDITION]/user/NAME).
const prisma = require('../config/prisma');
const personService = require('../services/personService');

const notFound = (res) => res.status(404).render('pages/404', { title: 'Not found' });

async function event(req, res, next) {
  try {
    const person = await personService.findPerson(req.params.username);
    if (!person) return notFound(res);
    const insider = req.permissions.has('viewAllSubmissions') || req.permissions.has('manageEvent');
    // Anonymous events: no names until the results are out (except for organizers and the person).
    if (req.settings.anonymousParticipants && !insider && !req.contest.resultsPublishedAt && req.user?.id !== person.id) return notFound(res);
    const showNotes = req.user?.id === person.id || insider;
    const data = await personService.inEvent({ contest: req.contest, settings: req.eventSettings, person, showNotes });
    if (!data.entries.length && !data.roles.length && !data.reviews.accept && !data.reviews.reject) return notFound(res);
    res.render('pages/person/event', { title: `${person.username} — ${req.contest.title}`, person, data, isSelf: req.user?.id === person.id });
  } catch (err) {
    next(err);
  }
}

// An edition or a whole series: the person's events there, side by side.
async function group(req, res, next) {
  try {
    const series = await prisma.eventSeries.findUnique({ where: { slug: req.params.series } });
    if (!series) return notFound(res);
    const edition = req.params.edition ? await prisma.edition.findFirst({ where: { seriesId: series.id, slug: req.params.edition } }) : null;
    if (req.params.edition && !edition) return notFound(res);
    const person = await personService.findPerson(req.params.username);
    if (!person) return notFound(res);
    // A series' events: those under it directly and those under one of its editions.
    const editionIds = edition ? [edition.id] : (await prisma.edition.findMany({ where: { seriesId: series.id }, select: { id: true } })).map((e) => e.id);
    const contests = await prisma.contest.findMany({
      where: { deletedAt: null, ...(edition ? { editionId: edition.id } : { OR: [{ seriesId: series.id }, { editionId: { in: editionIds } }] }), visibility: 'public', status: { not: 'draft' } },
      include: { settings: true, series: true },
      orderBy: { startDate: 'desc' },
    });
    const data = await personService.across({ contests, person, showNotes: req.user?.id === person.id });
    if (!data.events.length) return notFound(res);
    res.render('pages/person/group', { title: `${person.username} — ${edition ? edition.title : series.title}`, person, data, series, edition, isSelf: req.user?.id === person.id });
  } catch (err) {
    next(err);
  }
}

module.exports = { event, group };

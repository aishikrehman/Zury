// One month of events for the calendar (?month=2026-11), on the home page and the dashboard.
const prisma = require('../config/prisma');

function monthOf(query) {
  const m = /^(\d{4})-(\d{2})$/.exec(query || '');
  const today = new Date();
  return { year: m ? Number(m[1]) : today.getUTCFullYear(), month: m ? Number(m[2]) - 1 : today.getUTCMonth() };
}

// `where` narrows the events, e.g. to the ones a person takes part in.
async function month(query, where = {}) {
  const { year, month: mon } = monthOf(query);
  const monthStart = new Date(Date.UTC(year, mon, 1));
  const monthEnd = new Date(Date.UTC(year, mon + 1, 1));
  const events = await prisma.contest.findMany({
    where: { deletedAt: null, status: { notIn: ['draft', 'cancelled'] }, startDate: { lt: monthEnd }, endDate: { gte: monthStart }, ...where },
    select: { id: true, slug: true, title: true, type: true, startDate: true, endDate: true, path: true, language: true, primaryWiki: true, series: { select: { slug: true } }, wikis: { select: { wiki: true } } },
    orderBy: { startDate: 'asc' },
  });
  return { year, month: mon, start: monthStart, events };
}

module.exports = { month };

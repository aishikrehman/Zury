// An event's data out (CSV, Excel, wikitext, Markdown) and away (clearing what's no
// longer needed once the event is over). Organizers do both from Configuration.
const prisma = require('../config/prisma');
const audit = require('./auditService');
const reviewService = require('./reviewService');

const DATASETS = {
  entries: 'Entries',
  results: 'Results',
  people: 'People',
  reviews: 'Reviews',
};
const FORMATS = { csv: 'CSV', xls: 'Excel', wiki: 'Wikitext', md: 'Markdown' };

const day = (d) => (d ? new Date(d).toISOString().slice(0, 16).replace('T', ' ') : '');

// { columns: [..], rows: [[..]] } for one dataset.
async function table(contest, settings, dataset, { wiki } = {}) {
  const where = { contestId: contest.id, ...(wiki && { wiki }) };
  if (dataset === 'entries') {
    const items = await prisma.submission.findMany({ where, orderBy: { submittedAt: 'asc' }, include: { participant: { select: { username: true } } } });
    return {
      columns: ['Title', 'Wiki', 'Participant', 'Status', 'Words', 'Score', 'Submitted', 'URL'],
      rows: items.map((s) => [s.title, s.wiki, s.participant.username, s.status, s.wordCount ?? '', s.score ?? '', day(s.submittedAt), s.url]),
    };
  }
  if (dataset === 'results') {
    const rows = await reviewService.leaderboard({ contest, settings, wiki });
    return { columns: ['Rank', 'Participant', 'Submitted', 'Accepted', 'Points', 'Words'], rows: rows.map((r) => [r.rank, r.username, r.submitted ?? r.entries, r.entries, r.points, r.words]) };
  }
  if (dataset === 'people') {
    const items = await prisma.contestMembership.findMany({ where: { contestId: contest.id, status: 'active', ...(wiki && { wiki: { in: ['', wiki] } }) }, include: { user: { select: { username: true, homeWiki: true } } }, orderBy: [{ role: 'asc' }, { user: { username: 'asc' } }] });
    return { columns: ['Username', 'Role', 'Wiki', 'Home wiki', 'Since'], rows: items.map((m) => [m.user.username, m.role, m.wiki || 'all', m.user.homeWiki || '', day(m.assignedAt)]) };
  }
  if (dataset === 'reviews') {
    const items = await prisma.review.findMany({ where: { contestId: contest.id, ...(wiki && { submission: { wiki } }) }, include: { submission: { select: { title: true, wiki: true } }, juror: { select: { username: true } } }, orderBy: { createdAt: 'asc' } });
    return { columns: ['Entry', 'Wiki', 'Reviewer', 'Decision', 'Points', 'Comment', 'Date'], rows: items.map((r) => [r.submission.title, r.submission.wiki, r.juror.username, r.decision, r.points, r.comment, day(r.createdAt)]) };
  }
  throw new Error('Unknown dataset.');
}

const esc = {
  csv: (v) => (/[",\n\r]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v)),
  xml: (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
  wiki: (v) => String(v).replace(/\|/g, '&#124;').replace(/\n/g, ' '),
  md: (v) => String(v).replace(/\|/g, '\\|').replace(/\n/g, ' '),
};

// The file: { body, type, ext }.
function render({ columns, rows }, format, title) {
  if (format === 'csv') {
    // The byte-order mark makes Excel read Bangla and other scripts correctly.
    return { body: '﻿' + [columns, ...rows].map((r) => r.map(esc.csv).join(',')).join('\r\n'), type: 'text/csv; charset=utf-8', ext: 'csv' };
  }
  if (format === 'xls') {
    // Excel's own XML spreadsheet: opens directly in Excel and LibreOffice.
    const cell = (v) => `<Cell><Data ss:Type="${typeof v === 'number' ? 'Number' : 'String'}">${esc.xml(v)}</Data></Cell>`;
    const body = `<?xml version="1.0" encoding="UTF-8"?>\n<?mso-application progid="Excel.Sheet"?>\n<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="${esc.xml(title.slice(0, 30))}"><Table>`
      + [columns, ...rows].map((r) => `<Row>${r.map(cell).join('')}</Row>`).join('') + '</Table></Worksheet></Workbook>';
    return { body, type: 'application/vnd.ms-excel; charset=utf-8', ext: 'xls' };
  }
  if (format === 'wiki') {
    const body = `{| class="wikitable sortable"\n|+ ${esc.wiki(title)}\n! ${columns.map(esc.wiki).join(' !! ')}\n` + rows.map((r) => `|-\n| ${r.map(esc.wiki).join(' || ')}`).join('\n') + '\n|}\n';
    return { body, type: 'text/plain; charset=utf-8', ext: 'wiki.txt' };
  }
  if (format === 'md') {
    const body = `# ${title}\n\n| ${columns.map(esc.md).join(' | ')} |\n|${columns.map(() => ' --- ').join('|')}|\n` + rows.map((r) => `| ${r.map(esc.md).join(' | ')} |`).join('\n') + '\n';
    return { body, type: 'text/markdown; charset=utf-8', ext: 'md' };
  }
  throw new Error('Unknown format.');
}

// What can be cleared, and how many rows each would remove.
const CLEARABLE = {
  activity: { label: 'Activity log', count: (id) => prisma.auditLog.count({ where: { contestId: id } }), clear: (id) => prisma.auditLog.deleteMany({ where: { contestId: id } }) },
  contributions: { label: 'Tracked edits', count: (id) => prisma.contribution.count({ where: { contestId: id } }), clear: (id) => prisma.contribution.deleteMany({ where: { contestId: id } }) },
  messages: { label: 'Entry history', count: (id) => prisma.submissionHistory.count({ where: { submission: { contestId: id } } }), clear: (id) => prisma.submissionHistory.deleteMany({ where: { submission: { contestId: id } } }) },
  withdrawn: { label: 'Withdrawn and invalid entries', count: (id) => prisma.submission.count({ where: { contestId: id, status: { in: ['withdrawn', 'invalid'] } } }), clear: (id) => prisma.submission.deleteMany({ where: { contestId: id, status: { in: ['withdrawn', 'invalid'] } } }) },
  assignments: { label: 'Reviewers assignments', count: (id) => prisma.reviewAssignment.count({ where: { contestId: id } }), clear: (id) => prisma.reviewAssignment.deleteMany({ where: { contestId: id } }) },
};

async function counts(contestId) {
  const out = {};
  for (const [key, c] of Object.entries(CLEARABLE)) out[key] = { label: c.label, count: await c.count(contestId) };
  return out;
}

async function clear({ actor, contest, what }) {
  const c = CLEARABLE[what];
  if (!c) throw new Error('Unknown data.');
  const { count } = await c.clear(contest.id);
  // The one record kept: that it was cleared.
  await audit.record({ actorId: actor.id, contestId: what === 'activity' ? null : contest.id, action: `eventData.cleared.${what}`, entityType: 'Contest', entityId: contest.id, details: { title: contest.title, removed: count } });
  return count;
}

module.exports = { DATASETS, FORMATS, table, render, counts, clear, CLEARABLE };

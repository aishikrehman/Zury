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
  summary: 'Summary report',
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

// A cell that starts like a formula (= + - @) is written as text, so a spreadsheet never runs it.
const noFormula = (v) => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) && !/^-?\d+(\.\d+)?$/.test(v) ? `'${v}` : v);
const esc = {
  csv: (v0) => { const v = noFormula(v0); return /[",\n\r]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v); },
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

// The event's report once it's over: key figures, the winners and the longest accepted articles,
// ready to paste on a wiki page (wikitext), or as Markdown, CSV or Excel.
async function summary(contest, settings, format, { wiki, t = (x) => x } = {}) {
  const stats = require('./statsService');
  const where = { contestId: contest.id, ...(wiki && { wiki }) };
  const [roll, board, longest] = await Promise.all([
    stats.rollup([contest.id]),
    reviewService.leaderboard({ contest, settings, wiki }),
    prisma.submission.findMany({ where: { ...where, status: 'approved' }, orderBy: [{ wordCount: 'desc' }, { id: 'asc' }], take: 10, select: { title: true, wiki: true, url: true, wordCount: true, participant: { select: { username: true } } } }),
  ]);
  const sv = roll.survival || {};
  const dates = [contest.startDate, contest.endDate].filter(Boolean).map((d) => new Date(d).toISOString().slice(0, 10)).join(' – ');
  const figures = [
    [t('Dates'), dates || '—'],
    [t('Participants'), roll.participants],
    [t('Entries'), roll.entries],
    [t('Accepted'), roll.approved],
    ...(settings.wordCountEnabled ? [[t('Words accepted'), roll.approvedWords]] : []),
    [t('Wikis'), roll.wikis.map((w) => w.code || w.wiki).join(', ') || '—'],
    ...(sv.checked ? [[t('Articles still standing'), `${sv.stand} / ${sv.checked}`]] : []),
  ];
  const winners = board.slice(0, 10).map((r) => [r.rank, r.username, r.entries, ...(settings.wordCountEnabled ? [r.words] : [r.points])]);
  const winCols = [t('Rank'), t('Participant'), t('Accepted'), settings.wordCountEnabled ? t('Words') : t('Points')];
  const longCols = [t('Article'), t('Participant'), t('Words')];
  const title = `${contest.title} — ${t('Summary report')}`;
  if (format === 'wiki') {
    const host = (w) => require('../wiki/wikiUrls').dbnameToHost(w) || '';
    const link = (x) => (wiki || !x.wiki || x.wiki === contest.primaryWiki ? `[[${x.title}]]` : `[https://${host(x.wiki)}/wiki/${encodeURIComponent(x.title.replace(/ /g, '_'))} ${x.title}]`);
    const tbl = (cols, rows) => `{| class="wikitable sortable"\n! ${cols.map(esc.wiki).join(' !! ')}\n` + rows.map((r) => `|-\n| ${r.join(' || ')}`).join('\n') + '\n|}\n';
    const body = `== ${esc.wiki(title)} ==\n`
      + `{| class="wikitable"\n` + figures.map(([k, v]) => `|-\n! ${esc.wiki(k)}\n| ${esc.wiki(v)}`).join('\n') + '\n|}\n\n'
      + (winners.length ? `=== ${t('Winners')} ===\n` + tbl(winCols, winners.map(([rk, u, n, w]) => [rk, `[[User:${esc.wiki(u)}|${esc.wiki(u)}]]`, n, w])) + '\n' : '')
      + (longest.length ? `=== ${t('Longest accepted articles')} ===\n` + tbl(longCols, longest.map((x) => [link(x), `[[User:${esc.wiki(x.participant.username)}|${esc.wiki(x.participant.username)}]]`, x.wordCount ?? ''])) : '')
      + `\n<small>${t('Made with Zury')}</small>\n`;
    return { body, type: 'text/plain; charset=utf-8', ext: 'wiki.txt' };
  }
  if (format === 'md') {
    const tbl = (cols, rows) => `| ${cols.map(esc.md).join(' | ')} |\n|${cols.map(() => ' --- ').join('|')}|\n` + rows.map((r) => `| ${r.map(esc.md).join(' | ')} |`).join('\n') + '\n';
    const body = `# ${title}\n\n` + figures.map(([k, v]) => `- **${k}:** ${v}`).join('\n') + '\n\n'
      + (winners.length ? `## ${t('Winners')}\n\n` + tbl(winCols, winners) + '\n' : '')
      + (longest.length ? `## ${t('Longest accepted articles')}\n\n` + tbl(longCols, longest.map((x) => [x.title, x.participant.username, x.wordCount ?? ''])) : '');
    return { body, type: 'text/markdown; charset=utf-8', ext: 'md' };
  }
  // CSV and Excel: one sheet, the sections one under another.
  const rows = [...figures, [], [t('Winners')], winCols, ...winners, [], [t('Longest accepted articles')], longCols, ...longest.map((x) => [x.title, x.participant.username, x.wordCount ?? ''])];
  return render({ columns: [t('Summary report'), contest.title], rows }, format, title);
}

module.exports = { DATASETS, FORMATS, table, render, summary };

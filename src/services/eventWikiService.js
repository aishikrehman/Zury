// The wikis taking part in an event: adding, requesting, approving, pausing.
const prisma = require('../config/prisma');
const audit = require('./auditService');
const { RESERVED_CODES } = require('../events/codes');

class EventWikiError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

const SPECIAL_CODES = { commonswiki: 'commons', wikidatawiki: 'wikidata', metawiki: 'meta', specieswiki: 'species', mediawikiwiki: 'mediawiki' };

// Short URL code: "bn" for bnwiki, "bn-wikisource" for bnwikisource, "commons" for commonswiki.
async function defaultCode(dbname, client = prisma) {
  if (SPECIAL_CODES[dbname]) return SPECIAL_CODES[dbname];
  const site = await client.wikiSite.findUnique({ where: { dbname }, select: { family: true, lang: true } });
  if (site?.lang && site.family === 'wiki') return site.lang;
  if (site?.lang) return `${site.lang}-${site.family}`;
  const m = /^([a-z_]+?)wiki$/.exec(dbname);
  return m ? m[1].replace(/_/g, '-') : dbname;
}

async function uniqueCode(tx, contestId, dbname) {
  const base = (await defaultCode(dbname, tx)).toLowerCase();
  for (let i = 1; i < 50; i++) {
    const code = i === 1 ? base : `${base}-${i}`;
    if (RESERVED_CODES.has(code)) continue;
    if (!(await tx.contestWiki.findUnique({ where: { contestId_code: { contestId, code } } }))) return code;
  }
  throw new EventWikiError('Could not find a free code for this wiki.');
}

async function addWiki({ actorId, contest, wiki, status = 'active', requestedById = null, client = prisma }) {
  const run = async (tx) => {
    // An edition's event is one wiki's (/wam/2026/bn); another wiki is another event of the edition.
    if (contest.editionId && (await tx.contestWiki.count({ where: { contestId: contest.id } }))) {
      throw new EventWikiError('An event in an edition has one wiki. Add another wiki as a new event of the edition.');
    }
    if (await tx.contestWiki.findUnique({ where: { contestId_wiki: { contestId: contest.id, wiki } } })) {
      throw new EventWikiError(`${wiki} is already part of this event.`);
    }
    // An edition made without a wiki: the first one to join becomes its main wiki.
    if (contest.primaryWiki === 'metawiki' && !(await tx.contestWiki.count({ where: { contestId: contest.id } }))) {
      const lang = await require('../wiki/catalogService').languageOf(wiki);
      await tx.contest.update({ where: { id: contest.id }, data: { primaryWiki: wiki, ...(lang && lang !== 'special' && { language: lang }) } });
    }
    const row = await tx.contestWiki.create({
      data: { contestId: contest.id, wiki, code: await uniqueCode(tx, contest.id, wiki), status, requestedById },
    });
    await audit.record(
      { actorId, contestId: contest.id, action: status === 'pending' ? 'eventWiki.requested' : 'eventWiki.added', entityType: 'ContestWiki', entityId: row.id, details: { wiki, code: row.code } },
      tx,
    );
    return row;
  };
  return client === prisma ? prisma.$transaction(run) : run(client);
}

async function changeWiki({ actorId, contest, wikiId, action }) {
  return prisma.$transaction(async (tx) => {
    const row = await tx.contestWiki.findFirst({ where: { id: wikiId, contestId: contest.id } });
    if (!row) throw new EventWikiError('That wiki is not part of this event.');

    if (action === 'approve') {
      if (row.status !== 'pending') throw new EventWikiError('Only requested wikis can be approved.');
      await tx.contestWiki.update({ where: { id: row.id }, data: { status: 'active' } });
      // The person who asked becomes that wiki's organizer.
      if (row.requestedById) {
        await tx.contestMembership.upsert({
          where: { contestId_userId_role_wiki: { contestId: contest.id, userId: row.requestedById, role: 'organizer', wiki: row.wiki } },
          update: { status: 'active' },
          create: { contestId: contest.id, userId: row.requestedById, role: 'organizer', wiki: row.wiki, assignedById: actorId },
        });
      }
    } else if (action === 'pause' || action === 'resume') {
      if (row.status === 'pending') throw new EventWikiError('Approve the request first.');
      await tx.contestWiki.update({ where: { id: row.id }, data: { status: action === 'pause' ? 'paused' : 'active' } });
    } else if (action === 'remove') {
      const used = await tx.submission.count({ where: { contestId: contest.id, wiki: row.wiki } });
      if (used) throw new EventWikiError(`${row.wiki} already has ${used} submission(s); pause it instead.`);
      const others = await tx.contestWiki.count({ where: { contestId: contest.id, status: { not: 'pending' }, id: { not: row.id } } });
      if (row.status !== 'pending' && others === 0) throw new EventWikiError('An event needs at least one wiki.');
      await tx.contestWiki.delete({ where: { id: row.id } });
      await tx.contestMembership.updateMany({ where: { contestId: contest.id, wiki: row.wiki }, data: { status: 'removed' } });
      if (contest.primaryWiki === row.wiki) {
        const next = await tx.contestWiki.findFirst({ where: { contestId: contest.id, status: { not: 'pending' } }, orderBy: { id: 'asc' } });
        if (next) await tx.contest.update({ where: { id: contest.id }, data: { primaryWiki: next.wiki } });
      }
    }
    await audit.record(
      { actorId, contestId: contest.id, action: `eventWiki.${action === 'approve' ? 'approved' : action === 'remove' ? 'removed' : action === 'pause' ? 'paused' : 'resumed'}`, entityType: 'ContestWiki', entityId: row.id, details: { wiki: row.wiki, code: row.code } },
      tx,
    );
  });
}

async function saveOverrides({ actorId, contest, eventWiki, overrides }) {
  return prisma.$transaction(async (tx) => {
    await tx.contestWiki.update({ where: { id: eventWiki.id }, data: { overrides: JSON.stringify(overrides) } });
    const changed = [
      ...Object.keys(overrides.contest).map((k) => `contest.${k}`),
      ...Object.keys(overrides.settings).map((k) => `settings.${k}`),
      ...Object.keys(overrides.typeConfig).map((k) => `type.${k}`),
    ];
    await audit.record(
      { actorId, contestId: contest.id, action: 'eventWiki.overridesSaved', entityType: 'ContestWiki', entityId: eventWiki.id, details: { wiki: eventWiki.wiki, overridden: changed } },
      tx,
    );
  });
}

module.exports = { EventWikiError, defaultCode, uniqueCode, addWiki, changeWiki, saveOverrides };

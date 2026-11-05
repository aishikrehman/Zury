// Moving a single event into a multi-wiki event: the source becomes one wiki of
// the target (e.g. a separate Bangla WAM becomes /wam/2026/bn). Everything moves
// in one transaction; nothing is copied, so there is one history and no gap in
// which data could be lost. The source is closed and its address redirects.
const prisma = require('../config/prisma');
const audit = require('./auditService');
const { uniqueCode } = require('./eventWikiService');
const { OVERRIDABLE, DATE_KEYS } = require('../events/effective');
const { readTypeConfig } = require('../events/eventTypes');

class MergeError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

const same = (a, b) => (a instanceof Date || b instanceof Date ? a?.getTime?.() === b?.getTime?.() : JSON.stringify(a) === JSON.stringify(b));

// The source's own dates, rules and type settings, kept as that wiki's overrides.
function overridesFrom(source, sourceSettings, target, targetSettings) {
  const out = { contest: {}, settings: {}, typeConfig: {} };
  for (const k of OVERRIDABLE.contest) {
    if (!same(source[k], target[k])) out.contest[k] = DATE_KEYS.has(k) && source[k] ? source[k].toISOString() : source[k];
  }
  for (const k of OVERRIDABLE.settings) if (!same(sourceSettings[k], targetSettings[k])) out.settings[k] = sourceSettings[k];
  const a = readTypeConfig(source.type, sourceSettings.typeConfig);
  const b = readTypeConfig(target.type, targetSettings.typeConfig);
  for (const k of Object.keys(a)) if (!same(a[k], b[k])) out.typeConfig[k] = a[k];
  return out;
}

/**
 * Checks without changing anything. Returns { wikis, counts } for the confirmation page.
 */
async function preview({ source, target }) {
  if (source.id === target.id) throw new MergeError('Choose another event.');
  if (source.type !== target.type) throw new MergeError('Both events must be of the same type.');
  const sourceWikis = await prisma.contestWiki.findMany({ where: { contestId: source.id, status: { not: 'pending' } } });
  if (sourceWikis.length !== 1) throw new MergeError('Only an event on a single wiki can be moved into another event.');
  const wiki = sourceWikis[0].wiki;
  const existing = await prisma.contestWiki.findUnique({ where: { contestId_wiki: { contestId: target.id, wiki } } });
  const [submissions, members, sessions, contributions] = await Promise.all([
    prisma.submission.count({ where: { contestId: source.id } }),
    prisma.contestMembership.count({ where: { contestId: source.id, status: 'active' } }),
    prisma.eventSession.count({ where: { contestId: source.id } }),
    prisma.contribution.count({ where: { contestId: source.id } }),
  ]);
  return { wiki, existing, counts: { submissions, members, sessions, contributions } };
}

async function mergeInto({ actorId, source, target }) {
  const { wiki, existing } = await preview({ source, target });
  return prisma.$transaction(async (tx) => {
    const [sourceSettings, targetSettings] = await Promise.all([
      tx.contestSettings.findUnique({ where: { contestId: source.id } }),
      tx.contestSettings.findUnique({ where: { contestId: target.id } }),
    ]);

    // 1. The wiki joins the target, keeping the source's own settings as overrides.
    const overrides = JSON.stringify(overridesFrom(source, sourceSettings || {}, target, targetSettings || {}));
    const eventWiki = existing
      ? await tx.contestWiki.update({ where: { id: existing.id }, data: { status: 'active', overrides } })
      : await tx.contestWiki.create({ data: { contestId: target.id, wiki, code: await uniqueCode(tx, target.id, wiki), status: 'active', overrides } });

    // 2. People: participants keep taking part from this wiki; staff run this wiki only.
    const members = await tx.contestMembership.findMany({ where: { contestId: source.id, status: 'active' } });
    let people = 0;
    for (const m of members) {
      const blocked = await tx.eventBlock.count({ where: { contestId: target.id, userId: m.userId, liftedAt: null } });
      if (blocked) continue;
      const key = { contestId: target.id, userId: m.userId, role: m.role, wiki: m.wiki || wiki };
      if (m.role === 'participant') {
        const already = await tx.contestMembership.findFirst({ where: { contestId: target.id, userId: m.userId, role: 'participant', status: 'active' } });
        if (already) continue;
      }
      await tx.contestMembership.upsert({
        where: { contestId_userId_role_wiki: key },
        update: { status: 'active' },
        create: { ...key, assignedById: m.assignedById, assignedAt: m.assignedAt },
      });
      people += 1;
    }
    await tx.contestMembership.updateMany({ where: { contestId: source.id, status: 'active' }, data: { status: 'removed' } });

    // 3. Entries, sessions, blocks and tracked edits move as they are.
    const { count: submissions } = await tx.submission.updateMany({ where: { contestId: source.id }, data: { contestId: target.id } });
    const { count: sessions } = await tx.eventSession.updateMany({ where: { contestId: source.id }, data: { contestId: target.id, wiki } });
    await tx.eventBlock.updateMany({ where: { contestId: source.id, liftedAt: null }, data: { contestId: target.id } });
    const targetKeys = new Set((await tx.contribution.findMany({ where: { contestId: target.id }, select: { key: true } })).map((c) => c.key));
    const contributions = await tx.contribution.findMany({ where: { contestId: source.id }, select: { id: true, key: true } });
    const duplicate = contributions.filter((c) => targetKeys.has(c.key)).map((c) => c.id);
    if (duplicate.length) await tx.contribution.deleteMany({ where: { id: { in: duplicate } } });
    await tx.contribution.updateMany({ where: { contestId: source.id }, data: { contestId: target.id } });

    // 4. The source closes and points to where it went.
    await tx.contest.update({ where: { id: source.id }, data: { deletedAt: new Date(), deletedById: actorId, mergedIntoId: target.id, mergedWikiCode: eventWiki.code } });
    // It gives up its address (no redirect).
    await require('./editionService').sync(source.id, tx);
    const details = { from: source.title, into: target.title, wiki, code: eventWiki.code, submissions, people, sessions, contributions: contributions.length - duplicate.length };
    await audit.record({ actorId, contestId: target.id, action: 'contest.mergedIn', entityType: 'Contest', entityId: source.id, details }, tx);
    await audit.record({ actorId, contestId: source.id, action: 'contest.mergedInto', entityType: 'Contest', entityId: target.id, details }, tx);
    return { code: eventWiki.code, ...details };
  });
}

module.exports = { MergeError, preview, mergeInto, overridesFrom };

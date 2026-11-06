// New events, series and editions waiting for approval, and who may approve them.
const prisma = require('../config/prisma');
const audit = require('./auditService');
const notifications = require('./notificationService');

// Approvers everywhere: stewards, global sysops, Zury administrators, superusers. Local admins: their wiki's events.
async function canApproveWiki(req, wiki) {
  if (req.permissions.has('approveEvents')) return true;
  return !!(req.subject?.adminWikis && req.subject.adminWikis.has(wiki));
}

async function pendingFor(req) {
  const global = req.permissions.has('approveEvents');
  const wikis = [...(req.subject?.adminWikis || [])];
  if (!global && !wikis.length) return null;
  const [events, series, editions] = await Promise.all([
    prisma.contest.findMany({ where: { approval: 'pending', deletedAt: null, ...(global ? {} : { primaryWiki: { in: wikis } }) }, orderBy: { createdAt: 'asc' }, take: 50, select: { id: true, title: true, path: true, primaryWiki: true, type: true, createdAt: true, createdBy: { select: { username: true } } } }),
    global ? prisma.eventSeries.findMany({ where: { approval: 'pending', deletedAt: null }, orderBy: { createdAt: 'asc' }, take: 50, select: { id: true, title: true, slug: true, createdAt: true } }) : [],
    global ? prisma.edition.findMany({ where: { approval: 'pending', deletedAt: null }, orderBy: { createdAt: 'asc' }, take: 50, select: { id: true, title: true, slug: true, createdAt: true, series: { select: { slug: true, title: true } } } }) : [],
  ]);
  return { events, series, editions, total: events.length + series.length + editions.length };
}

async function decide(req, kind, id, action) {
  const value = action === 'approve' ? 'approved' : 'rejected';
  if (kind === 'event') {
    const c = await prisma.contest.findUnique({ where: { id }, select: { id: true, title: true, primaryWiki: true, createdById: true, path: true } });
    if (!c || !(await canApproveWiki(req, c.primaryWiki))) return false;
    await prisma.contest.update({ where: { id }, data: { approval: value } });
    if (c.createdById) await notifications.notify(c.createdById, { kind: 'event.approval', message: value === 'approved' ? 'Your event {event} was approved.' : 'Your event {event} was not approved.', params: { event: c.title }, link: c.path, contestId: c.id }).catch(() => null);
    await audit.record({ actorId: req.user.id, contestId: id, action: `event.${value}`, entityType: 'Contest', entityId: id, details: { title: c.title } });
    return true;
  }
  if (!req.permissions.has('approveEvents')) return false;
  if (kind === 'series') await prisma.eventSeries.update({ where: { id }, data: { approval: value } });
  else await prisma.edition.update({ where: { id }, data: { approval: value } });
  await audit.record({ actorId: req.user.id, action: `${kind}.${value}`, entityType: kind === 'series' ? 'EventSeries' : 'Edition', entityId: id });
  return true;
}

module.exports = { canApproveWiki, pendingFor, decide };

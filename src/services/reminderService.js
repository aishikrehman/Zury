// Reminders before a running event ends: its participants hear 3 days and 1 day before the end
// (a Zury notification, once each; the activity log remembers what was sent).
const prisma = require('../config/prisma');
const notifications = require('./notificationService');
const audit = require('./auditService');

const MARKS = [[3, 'reminder.3d', 'Three days left in {event}: submit your entries before it ends.'], [1, 'reminder.1d', 'One day left in {event}: submit your entries before it ends.']];

async function sweep(now = new Date()) {
  let sent = 0;
  for (const [days, action, message] of MARKS) {
    const until = new Date(now.getTime() + days * 86400000);
    const events = await prisma.contest.findMany({
      where: { deletedAt: null, status: 'active', endDate: { gt: now, lte: until }, settings: { participantNotificationsEnabled: true } },
      select: { id: true, title: true, path: true },
    });
    for (const ev of events) {
      if (await prisma.auditLog.count({ where: { contestId: ev.id, action } })) continue;
      const people = await prisma.contestMembership.findMany({ where: { contestId: ev.id, role: 'participant', status: 'active' }, select: { userId: true }, distinct: ['userId'] });
      await notifications.notify(people.map((p) => p.userId), { kind: 'event.reminder', message, params: { event: ev.title }, link: `${ev.path || `/contest/${ev.id}`}/submit`, contestId: ev.id });
      await audit.record({ actorId: null, contestId: ev.id, action, entityType: 'Contest', entityId: ev.id, details: { people: people.length } });
      sent += people.length;
    }
  }
  return sent;
}

module.exports = { sweep };

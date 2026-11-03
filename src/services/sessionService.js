// Sessions of an activity (workshop, training, photowalk): people register,
// organizers record who attended, and attendance can earn a certificate.
const prisma = require('../config/prisma');
const audit = require('./auditService');
const membershipService = require('./membershipService');
const { zonedLocalToUtc } = require('../utils/time');

const MODES = { offline: 'In person', online: 'Online', hybrid: 'Hybrid' };
const STATUSES = { planned: 'Planned', open: 'Registration open', held: 'Held', cancelled: 'Cancelled' };
const ATTENDANCE = { registered: 'Registered', waitlisted: 'Waitlisted', attended: 'Attended', absent: 'Absent', cancelled: 'Cancelled' };
const TAKING_PLACES = ['registered', 'attended', 'absent'];

class SessionError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

function parse(body, timezone) {
  const errors = {};
  const str = (v) => String(v ?? '').trim();
  const title = str(body.title);
  if (title.length < 3 || title.length > 200) errors.title = 'Enter a title of 3 to 200 characters.';
  const mode = MODES[body.mode] ? body.mode : 'offline';
  const startsAt = str(body.startsAt) ? zonedLocalToUtc(str(body.startsAt), timezone) : null;
  if (!startsAt) errors.startsAt = 'Enter when the session starts.';
  const endsAt = str(body.endsAt) ? zonedLocalToUtc(str(body.endsAt), timezone) : null;
  if (str(body.endsAt) && !endsAt) errors.endsAt = 'Enter a valid date and time.';
  else if (endsAt && startsAt && endsAt < startsAt) errors.endsAt = 'Must not be before the start.';
  const capacity = str(body.capacity) === '' ? null : Number(body.capacity);
  if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1 || capacity > 100000)) errors.capacity = 'Enter a whole number, or leave blank for no limit.';
  const meetingUrl = str(body.meetingUrl);
  if (meetingUrl && !/^https:\/\/\S+$/.test(meetingUrl)) errors.meetingUrl = 'Use an https:// link.';
  if (mode !== 'offline' && !meetingUrl) errors.meetingUrl = 'Online sessions need a meeting link.';
  const location = str(body.location).slice(0, 300);
  if (mode !== 'online' && !location) errors.location = 'Where does it take place?';
  return {
    errors,
    data: { title, mode, startsAt, endsAt, capacity, meetingUrl, location, agenda: str(body.agenda).slice(0, 5000), status: STATUSES[body.status] ? body.status : 'open' },
  };
}

async function list(contestId, { wiki, userId } = {}) {
  const sessions = await prisma.eventSession.findMany({
    where: { contestId, ...(wiki && { wiki: { in: ['', wiki] } }) },
    orderBy: { startsAt: 'asc' },
    include: { attendances: { select: { userId: true, status: true } } },
  });
  return sessions.map(({ attendances, ...s }) => ({
    ...s,
    taken: attendances.filter((a) => TAKING_PLACES.includes(a.status)).length,
    waitlisted: attendances.filter((a) => a.status === 'waitlisted').length,
    attended: attendances.filter((a) => a.status === 'attended').length,
    mine: userId ? attendances.find((a) => a.userId === userId)?.status || null : null,
  }));
}

function find(contestId, id) {
  return prisma.eventSession.findFirst({
    where: { id, contestId },
    include: { attendances: { include: { user: { select: { id: true, username: true } } }, orderBy: { createdAt: 'asc' } } },
  });
}

async function create({ actorId, contest, data, wiki = '' }) {
  const session = await prisma.eventSession.create({ data: { ...data, contestId: contest.id, wiki } });
  await audit.record({ actorId, contestId: contest.id, action: 'session.created', entityType: 'EventSession', entityId: session.id, details: { title: data.title, wiki: wiki || undefined } });
  return session;
}

async function update({ actorId, contest, session, data }) {
  await prisma.eventSession.update({ where: { id: session.id }, data });
  await audit.record({ actorId, contestId: contest.id, action: 'session.updated', entityType: 'EventSession', entityId: session.id, details: { title: data.title ?? session.title, status: data.status } });
}

// Moves the earliest waitlisted people up while there is room.
async function promote(tx, session) {
  if (session.capacity == null) {
    await tx.sessionAttendance.updateMany({ where: { sessionId: session.id, status: 'waitlisted' }, data: { status: 'registered' } });
    return;
  }
  const taken = await tx.sessionAttendance.count({ where: { sessionId: session.id, status: { in: TAKING_PLACES } } });
  const waiting = await tx.sessionAttendance.findMany({ where: { sessionId: session.id, status: 'waitlisted' }, orderBy: { createdAt: 'asc' }, take: Math.max(0, session.capacity - taken) });
  for (const w of waiting) await tx.sessionAttendance.update({ where: { id: w.id }, data: { status: 'registered' } });
}

/**
 * Registers someone for a session. People who aren't participants yet join the
 * event first (with all its eligibility rules). Returns 'registered' or 'waitlisted'.
 */
async function register({ user, contest, settings, session, wiki, now = new Date() }) {
  if (!['planned', 'open'].includes(session.status)) throw new SessionError('Registration for this session is closed.');
  if (session.startsAt < now) throw new SessionError('This session has already started.');
  const roles = await membershipService.activeRoles(contest.id, user.id);
  if (!roles.includes('participant')) await membershipService.join({ user, contest, settings, wiki: session.wiki || wiki || '' });
  else if (await membershipService.isBlocked(contest.id, user.id)) throw new SessionError("You've been blocked from this event.");

  return prisma.$transaction(async (tx) => {
    const existing = await tx.sessionAttendance.findUnique({ where: { sessionId_userId: { sessionId: session.id, userId: user.id } } });
    if (existing && existing.status !== 'cancelled') throw new SessionError("You're already registered.");
    const taken = await tx.sessionAttendance.count({ where: { sessionId: session.id, status: { in: TAKING_PLACES } } });
    const status = session.capacity != null && taken >= session.capacity ? 'waitlisted' : 'registered';
    await tx.sessionAttendance.upsert({
      where: { sessionId_userId: { sessionId: session.id, userId: user.id } },
      update: { status, createdAt: new Date(), checkedInAt: null },
      create: { sessionId: session.id, userId: user.id, status },
    });
    await audit.record({ actorId: user.id, contestId: contest.id, action: 'session.registered', entityType: 'EventSession', entityId: session.id, details: { title: session.title, status } }, tx);
    return status;
  });
}

async function cancel({ user, contest, session }) {
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.sessionAttendance.updateMany({
      where: { sessionId: session.id, userId: user.id, status: { in: ['registered', 'waitlisted'] } },
      data: { status: 'cancelled' },
    });
    if (!count) throw new SessionError("You're not registered for this session.");
    await promote(tx, session);
    await audit.record({ actorId: user.id, contestId: contest.id, action: 'session.cancelled', entityType: 'EventSession', entityId: session.id, details: { title: session.title } }, tx);
  });
}

// present: ids of people who attended; everyone else registered is marked absent.
async function recordAttendance({ actorId, contest, session, present }) {
  const ids = new Set(present.map(Number));
  return prisma.$transaction(async (tx) => {
    const rows = await tx.sessionAttendance.findMany({ where: { sessionId: session.id, status: { in: TAKING_PLACES } } });
    for (const r of rows) {
      const status = ids.has(r.userId) ? 'attended' : 'absent';
      if (status !== r.status) await tx.sessionAttendance.update({ where: { id: r.id }, data: { status, checkedInAt: status === 'attended' ? new Date() : null } });
    }
    if (session.status !== 'held') await tx.eventSession.update({ where: { id: session.id }, data: { status: 'held' } });
    const attended = rows.filter((r) => ids.has(r.userId)).length;
    await audit.record({ actorId, contestId: contest.id, action: 'session.attendance', entityType: 'EventSession', entityId: session.id, details: { title: session.title, attended, absent: rows.length - attended } }, tx);
    return attended;
  });
}

// How many sessions each person attended, and who has earned a certificate.
async function attendanceSummary(contestId, minForCertificate) {
  const rows = await prisma.sessionAttendance.groupBy({ by: ['userId'], where: { status: 'attended', session: { contestId } }, _count: { _all: true } });
  const users = await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.userId) } }, select: { id: true, username: true } });
  const name = Object.fromEntries(users.map((u) => [u.id, u.username]));
  return rows
    .map((r) => ({ userId: r.userId, username: name[r.userId], attended: r._count._all, certified: minForCertificate > 0 && r._count._all >= minForCertificate }))
    .sort((a, b) => b.attended - a.attended || a.username.localeCompare(b.username));
}

module.exports = { MODES, STATUSES, ATTENDANCE, SessionError, parse, list, find, create, update, register, cancel, recordAttendance, attendanceSummary };

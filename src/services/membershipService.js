const prisma = require('../config/prisma');
const audit = require('./auditService');
const { EVENT_ROLES, OVERRIDABLE_PERMISSIONS, ROLE_MANAGEMENT_PERMISSION } = require('../permissions/registry');

const DAY_MS = 24 * 60 * 60 * 1000;
const JOINABLE_STATUSES = ['published', 'upcoming', 'active'];

class MembershipError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

// Jurors and organizers may also be participants only if the event allows it.
function roleConflict(newRole, existingRoles, settings) {
  const has = (r) => existingRoles.includes(r);
  if (newRole === 'participant') {
    if (has('jury') && !settings.allowJuryParticipation) return 'Jury members may not participate in this event.';
    if (has('organizer') && !settings.allowOrganizerParticipation) return 'Organizers may not participate in this event.';
  }
  if (newRole === 'jury' && has('participant') && !settings.allowJuryParticipation) {
    return 'This person is a participant, and jury members may not participate in this event.';
  }
  if (newRole === 'organizer' && has('participant') && !settings.allowOrganizerParticipation) {
    return 'This person is a participant, and organizers may not participate in this event.';
  }
  return null;
}

async function activeRoles(contestId, userId, client = prisma) {
  const rows = await client.contestMembership.findMany({ where: { contestId, userId, status: 'active' }, select: { role: true } });
  return rows.map((r) => r.role);
}

function participantCount(contestId, client = prisma) {
  return client.contestMembership.count({ where: { contestId, role: 'participant', status: 'active' } });
}

/**
 * Self-registration check. Pure apart from the inputs it is given.
 * Returns { eligible, reasons } where reasons explain every failed rule.
 */
function checkEligibility({ user, contest, settings, roles, participants, now = new Date() }) {
  const reasons = [];
  if (!user) return { eligible: false, reasons: ['Log in to join this event.'] };
  if (roles.includes('participant')) return { eligible: false, reasons: ["You're already taking part."], alreadyJoined: true };
  if (!settings.registrationEnabled) reasons.push('Organizers add participants to this event themselves.');
  if (!JOINABLE_STATUSES.includes(contest.status)) reasons.push('This event is not open for registration.');
  if (contest.registrationOpensAt && now < contest.registrationOpensAt) reasons.push('Registration has not opened yet.');
  if (contest.registrationClosesAt && now > contest.registrationClosesAt) reasons.push('Registration has closed.');
  if (settings.participantLimit != null && participants >= settings.participantLimit) reasons.push('The event is full.');
  if (settings.minAccountAgeDays > 0) {
    if (!user.wikimediaRegisteredAt) reasons.push("Your Wikimedia account age couldn't be verified.");
    else if ((now - user.wikimediaRegisteredAt) / DAY_MS < settings.minAccountAgeDays) {
      reasons.push(`Your Wikimedia account must be at least ${settings.minAccountAgeDays} days old.`);
    }
  }
  if (settings.minEditCount > 0) {
    if (user.globalEditCount == null) reasons.push("Your edit count couldn't be verified.");
    else if (user.globalEditCount < settings.minEditCount) reasons.push(`You need at least ${settings.minEditCount} edits across Wikimedia projects.`);
  }
  const conflict = roleConflict('participant', roles, settings);
  if (conflict) reasons.push(conflict);
  return { eligible: reasons.length === 0, reasons };
}

async function upsertActive(tx, { contestId, userId, role, actorId }) {
  return tx.contestMembership.upsert({
    where: { contestId_userId_role: { contestId, userId, role } },
    update: { status: 'active', assignedAt: new Date(), assignedById: actorId },
    create: { contestId, userId, role, assignedById: actorId },
  });
}

async function addMember({ actorId, contest, settings, user, role }) {
  if (!EVENT_ROLES[role]) throw new MembershipError('Unknown role.');
  return prisma.$transaction(async (tx) => {
    const roles = await activeRoles(contest.id, user.id, tx);
    if (roles.includes(role)) throw new MembershipError(`${user.username} is already ${EVENT_ROLES[role].label.toLowerCase()} here.`);
    const conflict = roleConflict(role, roles, settings);
    if (conflict) throw new MembershipError(conflict);
    if (role === 'participant' && settings.participantLimit != null && (await participantCount(contest.id, tx)) >= settings.participantLimit) {
      throw new MembershipError('The event has reached its participant limit.');
    }
    const membership = await upsertActive(tx, { contestId: contest.id, userId: user.id, role, actorId });
    await audit.record(
      { actorId, contestId: contest.id, action: 'membership.added', entityType: 'User', entityId: user.id, details: { username: user.username, role } },
      tx,
    );
    return membership;
  });
}

// Removal keeps the row (status "removed") so history is preserved.
async function removeMember({ actorId, contest, membershipId, allowed }) {
  return prisma.$transaction(async (tx) => {
    const m = await tx.contestMembership.findFirst({
      where: { id: membershipId, contestId: contest.id, status: 'active' },
      include: { user: { select: { username: true } } },
    });
    if (!m) throw new MembershipError('That membership no longer exists.');
    if (!allowed(ROLE_MANAGEMENT_PERMISSION[m.role])) {
      const err = new Error("You don't have permission to do that.");
      err.status = 403;
      throw err;
    }
    if (m.role === 'organizer') {
      const organizers = await tx.contestMembership.count({ where: { contestId: contest.id, role: 'organizer', status: 'active' } });
      if (organizers <= 1) throw new MembershipError('An event needs at least one organizer.');
    }
    await tx.contestMembership.update({ where: { id: m.id }, data: { status: 'removed' } });
    await audit.record(
      { actorId, contestId: contest.id, action: 'membership.removed', entityType: 'User', entityId: m.userId, details: { username: m.user.username, role: m.role } },
      tx,
    );
  });
}

async function join({ user, contest, settings }) {
  return prisma.$transaction(async (tx) => {
    const roles = await activeRoles(contest.id, user.id, tx);
    const result = checkEligibility({ user, contest, settings, roles, participants: await participantCount(contest.id, tx) });
    if (!result.eligible) throw new MembershipError(result.reasons.join(' '));
    await upsertActive(tx, { contestId: contest.id, userId: user.id, role: 'participant', actorId: user.id });
    await audit.record(
      { actorId: user.id, contestId: contest.id, action: 'membership.joined', entityType: 'User', entityId: user.id, details: { username: user.username } },
      tx,
    );
  });
}

async function leave({ user, contest }) {
  if (['completed', 'archived'].includes(contest.status)) throw new MembershipError('You can no longer leave this event.');
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.contestMembership.updateMany({
      where: { contestId: contest.id, userId: user.id, role: 'participant', status: 'active' },
      data: { status: 'removed' },
    });
    if (!count) throw new MembershipError("You're not a participant in this event.");
    await audit.record(
      { actorId: user.id, contestId: contest.id, action: 'membership.left', entityType: 'User', entityId: user.id, details: { username: user.username } },
      tx,
    );
  });
}

async function setOverride({ actorId, contest, user, permission, allowed }) {
  if (!OVERRIDABLE_PERMISSIONS.includes(permission)) throw new MembershipError('This permission cannot be changed per event.');
  return prisma.$transaction(async (tx) => {
    await tx.contestPermission.upsert({
      where: { contestId_userId_permission: { contestId: contest.id, userId: user.id, permission } },
      update: { allowed },
      create: { contestId: contest.id, userId: user.id, permission, allowed },
    });
    await audit.record(
      { actorId, contestId: contest.id, action: 'contestPermission.set', entityType: 'User', entityId: user.id, details: { username: user.username, permission, allowed } },
      tx,
    );
  });
}

async function removeOverride({ actorId, contest, overrideId }) {
  return prisma.$transaction(async (tx) => {
    const o = await tx.contestPermission.findFirst({ where: { id: overrideId, contestId: contest.id }, include: { user: { select: { username: true } } } });
    if (!o) throw new MembershipError('That override no longer exists.');
    await tx.contestPermission.delete({ where: { id: o.id } });
    await audit.record(
      { actorId, contestId: contest.id, action: 'contestPermission.removed', entityType: 'User', entityId: o.userId, details: { username: o.user.username, permission: o.permission } },
      tx,
    );
  });
}

module.exports = {
  MembershipError,
  roleConflict,
  checkEligibility,
  activeRoles,
  participantCount,
  addMember,
  removeMember,
  join,
  leave,
  setOverride,
  removeOverride,
};

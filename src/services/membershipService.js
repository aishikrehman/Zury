const prisma = require('../config/prisma');
const audit = require('./auditService');
const { EVENT_ROLES, OVERRIDABLE_PERMISSIONS, ROLE_MANAGEMENT_PERMISSION } = require('../permissions/registry');
const { wikimediaBans } = require('../wiki/banCheck');

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
function checkEligibility({ user, contest, settings, roles, participants, blocked = false, bans = [], now = new Date() }) {
  const reasons = [];
  if (!user) return { eligible: false, reasons: ['Log in to join this event.'] };
  if (blocked) return { eligible: false, reasons: ["You've been blocked from this event."], blocked: true };
  reasons.push(...bans);
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

// Staff roles may be limited to one wiki ("" = whole event). A participant takes part in
// the whole event but belongs to one wiki, whose organizers look after them.
async function upsertActive(tx, { contestId, userId, role, actorId, wiki = '' }) {
  if (role === 'participant') {
    await tx.contestMembership.updateMany({ where: { contestId, userId, role, status: 'active', wiki: { not: wiki } }, data: { status: 'removed' } });
  }
  return tx.contestMembership.upsert({
    where: { contestId_userId_role_wiki: { contestId, userId, role, wiki } },
    update: { status: 'active', assignedAt: new Date(), assignedById: actorId },
    create: { contestId, userId, role, wiki, assignedById: actorId },
  });
}

async function addMember({ actorId, contest, settings, user, role, wiki = '' }) {
  if (!EVENT_ROLES[role]) throw new MembershipError('Unknown role.');
  return prisma.$transaction(async (tx) => {
    if (await isBlocked(contest.id, user.id, tx)) throw new MembershipError(`${user.username} is blocked from this event.`);
    const roles = await activeRoles(contest.id, user.id, tx);
    const same = await tx.contestMembership.count({
      where: { contestId: contest.id, userId: user.id, role, status: 'active', ...(role !== 'participant' && { wiki: { in: ['', wiki] } }) },
    });
    if (same) throw new MembershipError(`${user.username} is already ${EVENT_ROLES[role].label.toLowerCase()} here.`);
    const conflict = roleConflict(role, roles, settings);
    if (conflict) throw new MembershipError(conflict);
    if (role === 'participant' && settings.participantLimit != null && (await participantCount(contest.id, tx)) >= settings.participantLimit) {
      throw new MembershipError('The event has reached its participant limit.');
    }
    const membership = await upsertActive(tx, { contestId: contest.id, userId: user.id, role, actorId, wiki });
    await audit.record(
      { actorId, contestId: contest.id, action: 'membership.added', entityType: 'User', entityId: user.id, details: { username: user.username, role, wiki: wiki || undefined } },
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
    if (!allowed(ROLE_MANAGEMENT_PERMISSION[m.role], m.wiki)) {
      const err = new Error("You don't have permission to do that.");
      err.status = 403;
      throw err;
    }
    if (m.role === 'organizer' && !m.wiki) {
      const organizers = await tx.contestMembership.count({ where: { contestId: contest.id, role: 'organizer', wiki: '', status: 'active' } });
      if (organizers <= 1) throw new MembershipError('An event needs at least one organizer.');
    }
    await tx.contestMembership.update({ where: { id: m.id }, data: { status: 'removed' } });
    await audit.record(
      { actorId, contestId: contest.id, action: 'membership.removed', entityType: 'User', entityId: m.userId, details: { username: m.user.username, role: m.role } },
      tx,
    );
  });
}

// wiki: the wiki the participant takes part from ("" for single-wiki events without one).
async function join({ user, contest, settings, wiki = '' }) {
  const bans = await wikimediaBans(user, wiki || contest.primaryWiki);
  return prisma.$transaction(async (tx) => {
    const roles = await activeRoles(contest.id, user.id, tx);
    const result = checkEligibility({
      user, contest, settings, roles, bans,
      blocked: await isBlocked(contest.id, user.id, tx),
      participants: await participantCount(contest.id, tx),
    });
    if (!result.eligible) throw new MembershipError(result.reasons.join(' '));
    await upsertActive(tx, { contestId: contest.id, userId: user.id, role: 'participant', actorId: user.id, wiki });
    await audit.record(
      { actorId: user.id, contestId: contest.id, action: 'membership.joined', entityType: 'User', entityId: user.id, details: { username: user.username, wiki: wiki || undefined } },
      tx,
    );
  });
}

// Joins inside a caller's transaction (used when a first submission registers someone).
async function joinInTx(tx, { user, contest, wiki = '' }) {
  await upsertActive(tx, { contestId: contest.id, userId: user.id, role: 'participant', actorId: user.id, wiki });
  await audit.record(
    { actorId: user.id, contestId: contest.id, action: 'membership.joined', entityType: 'User', entityId: user.id, details: { username: user.username, via: 'first submission' } },
    tx,
  );
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

// --- Event blocks --------------------------------------------------------------

async function isBlocked(contestId, userId, client = prisma) {
  return (await client.eventBlock.count({ where: { contestId, userId, liftedAt: null } })) > 0;
}

function activeBlocks(contestId) {
  return prisma.eventBlock.findMany({
    where: { contestId, liftedAt: null },
    include: { user: { select: { id: true, username: true, homeWiki: true, avatarUrl: true } }, blockedBy: { select: { username: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

// Blocking ends every role the person holds in the event; their entries stay for the record.
async function block({ actorId, contest, user, reason = '' }) {
  if (user.id === actorId) throw new MembershipError("You can't block yourself.");
  return prisma.$transaction(async (tx) => {
    if (await isBlocked(contest.id, user.id, tx)) throw new MembershipError(`${user.username} is already blocked.`);
    const organizers = await tx.contestMembership.count({ where: { contestId: contest.id, role: 'organizer', wiki: '', status: 'active', userId: { not: user.id } } });
    if (!organizers) throw new MembershipError("You can't block the event's only organizer.");
    await tx.eventBlock.create({ data: { contestId: contest.id, userId: user.id, reason: reason.slice(0, 500), blockedById: actorId } });
    await tx.contestMembership.updateMany({ where: { contestId: contest.id, userId: user.id, status: 'active' }, data: { status: 'removed' } });
    await audit.record(
      { actorId, contestId: contest.id, action: 'eventBlock.added', entityType: 'User', entityId: user.id, details: { username: user.username, reason } },
      tx,
    );
  });
}

async function unblock({ actorId, contest, blockId }) {
  return prisma.$transaction(async (tx) => {
    const b = await tx.eventBlock.findFirst({ where: { id: blockId, contestId: contest.id, liftedAt: null }, include: { user: { select: { username: true } } } });
    if (!b) throw new MembershipError('That block no longer exists.');
    await tx.eventBlock.update({ where: { id: b.id }, data: { liftedAt: new Date() } });
    await audit.record(
      { actorId, contestId: contest.id, action: 'eventBlock.lifted', entityType: 'User', entityId: b.userId, details: { username: b.user.username } },
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
  joinInTx,
  leave,
  setOverride,
  removeOverride,
  isBlocked,
  activeBlocks,
  block,
  unblock,
};

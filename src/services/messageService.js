// Messages from organizers to people in their event, sent through Wikimedia as
// the organizer (with their own login): a new talk-page section, or
// Special:EmailUser, where Wikimedia sends the email and no address is shown.
const prisma = require('../config/prisma');
const audit = require('./auditService');
const oauthService = require('./wikimediaOAuthService');

const METHODS = { talk: 'Talk page message', email: 'Email (through Wikimedia)' };
const AUDIENCES = { participant: 'Participants', jury: 'Reviewers', organizer: 'Organizers' };
const MAX_RECIPIENTS = 200;

class MessageError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

/**
 * People to message. wiki limits to that wiki's participants and staff (event-wide
 * staff included); usernames, when given, narrows the list further.
 */
async function recipients({ contestId, audience, wiki, usernames = [] }) {
  if (!AUDIENCES[audience]) throw new MessageError('Choose who to message.');
  const rows = await prisma.contestMembership.findMany({
    where: {
      contestId,
      role: audience,
      status: 'active',
      ...(wiki && { wiki: audience === 'participant' ? wiki : { in: ['', wiki] } }),
      user: { status: 'active', eventBlocks: { none: { contestId, liftedAt: null } } },
    },
    include: { user: { select: { id: true, username: true, homeWiki: true } } },
    orderBy: { user: { username: 'asc' } },
  });
  const wanted = new Set(usernames.map((u) => u.trim().toLowerCase()).filter(Boolean));
  const seen = new Map();
  for (const m of rows) {
    if (wanted.size && !wanted.has(m.user.username.toLowerCase())) continue;
    if (!seen.has(m.user.id)) seen.set(m.user.id, { ...m.user, wiki: m.wiki });
  }
  return [...seen.values()];
}

async function csrfToken(wiki, token) {
  const data = await oauthService.userApi(wiki, token, { action: 'query', meta: 'tokens', type: 'csrf' });
  const value = data?.query?.tokens?.csrftoken;
  if (!value || value === '+\\') throw new MessageError(`Wikimedia did not accept your login on ${wiki}. Log out and in again.`);
  return value;
}

/**
 * Sends one message to each recipient. Returns { sent, failed: [{ username, error }] }.
 * fallbackWiki is used for people whose role isn't tied to a wiki.
 */
async function send({ actor, accessToken, contest, method, subject, body, people, fallbackWiki }) {
  if (!METHODS[method]) throw new MessageError('Choose how to send the message.');
  subject = String(subject || '').trim();
  body = String(body || '').trim();
  if (subject.length < 3 || subject.length > 200) throw new MessageError('Enter a subject of 3 to 200 characters.');
  if (body.length < 3 || body.length > 10000) throw new MessageError('Enter a message of 3 to 10000 characters.');
  if (!people.length) throw new MessageError('Nobody matches these recipients.');
  if (people.length > MAX_RECIPIENTS) throw new MessageError(`At most ${MAX_RECIPIENTS} people at a time.`);
  if (!accessToken) throw new MessageError('Log in with your Wikimedia account to send messages.');

  const tokens = new Map();
  const failed = [];
  let sent = 0;
  for (const person of people) {
    const wiki = person.wiki || fallbackWiki;
    try {
      if (!tokens.has(wiki)) tokens.set(wiki, await csrfToken(wiki, accessToken));
      const params =
        method === 'talk'
          ? { action: 'edit', title: `User talk:${person.username}`, section: 'new', sectiontitle: subject, text: `${body} ~~~~`, summary: `${contest.title}: ${subject}` }
          : { action: 'emailuser', target: person.username, subject, text: body };
      const result = await oauthService.userApi(wiki, accessToken, { ...params, token: tokens.get(wiki) }, { post: true });
      if (result.error) throw new Error(result.error.info || result.error.code);
      if (method === 'email' && result.emailuser?.result !== 'Success') throw new Error('This user does not accept email.');
      sent += 1;
    } catch (err) {
      if (err instanceof MessageError) throw err;
      failed.push({ username: person.username, error: err.message });
    }
  }
  await audit.record({
    actorId: actor.id,
    contestId: contest.id,
    action: 'message.sent',
    entityType: 'Contest',
    entityId: contest.id,
    details: { method, subject, sent, failed: failed.map((f) => f.username) },
  });
  return { sent, failed };
}

module.exports = { METHODS, AUDIENCES, MAX_RECIPIENTS, MessageError, recipients, send };

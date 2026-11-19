// Mass messages from organizers to people chosen by a list (participants, those with no entries,
// reviewers with work waiting, last edition's people who did not come back, …), sent as:
// a Zury notification; a talk-page section or Special:EmailUser with the organizer's own login;
// or a MassMessage list page written on the wiki, for someone with the right to send it.
// People who asked for no mass messages are left out of wiki messages.
const prisma = require('../config/prisma');
const audit = require('./auditService');
const oauthService = require('./wikimediaOAuthService');

const METHODS = { bell: 'Zury notification', talk: 'Talk page message', email: 'Email (through Wikimedia)', massmessage: 'MassMessage list on the wiki' };
const AUDIENCES = { participant: 'Participants', nosubmit: 'Participants with no entries', waiting: 'Reviewers with entries waiting', lapsed: 'Took part last time, not this time', jury: 'Reviewers', organizer: 'Organizers' };
const MAX_RECIPIENTS = 200; // one by one with the organizer's login
const MAX_LIST = 5000; // notifications and MassMessage lists
const optedOut = (u) => { try { return !!JSON.parse(u.uiPrefs || '{}').noMass; } catch { return false; } };

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
  if (audience === 'lapsed') {
    const contest = await prisma.contest.findUnique({ where: { id: contestId } });
    const cmp = contest && await require('./seriesService').compareWithPrevious(contest);
    const names = cmp ? cmp.goneNames : [];
    const users = await prisma.user.findMany({ where: { username: { in: names }, status: 'active' }, select: { id: true, username: true, homeWiki: true, uiPrefs: true } });
    const wanted = new Set(usernames.map((u) => u.trim().toLowerCase()).filter(Boolean));
    return users.filter((u) => !wanted.size || wanted.has(u.username.toLowerCase())).map((u) => ({ ...u, wiki: contest.primaryWiki }));
  }
  const role = ['nosubmit'].includes(audience) ? 'participant' : audience === 'waiting' ? 'jury' : audience;
  const rows = await prisma.contestMembership.findMany({
    where: {
      contestId,
      role,
      ...(audience === 'nosubmit' && { user: { status: 'active', eventBlocks: { none: { contestId, liftedAt: null } }, submissions: { none: { contestId } } } }),
      ...(audience === 'waiting' && { user: { status: 'active', assignments: { some: { contestId, submission: { status: { in: ['pending', 'validated', 'under_review'] } } } } } }),
      status: 'active',
      ...(wiki && { wiki: role === 'participant' ? wiki : { in: ['', wiki] } }),
      ...(!['nosubmit', 'waiting'].includes(audience) && { user: { status: 'active', eventBlocks: { none: { contestId, liftedAt: null } } } }),
    },
    include: { user: { select: { id: true, username: true, homeWiki: true, uiPrefs: true } } },
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
  if (method !== 'bell') people = people.filter((p) => !optedOut(p));
  if (!people.length) throw new MessageError('Nobody matches these recipients.');
  if (method === 'bell') {
    if (people.length > MAX_LIST) throw new MessageError('At most 5000 people at a time.');
    const link = contest.path || (contest.id ? `/contest/${contest.id}` : '/notifications');
    await require('./notificationService').notify(people.map((p) => p.id), { kind: 'message', message: '{event}: {text}', params: { event: contest.title, text: `${subject} — ${body}`.slice(0, 400) }, link, contestId: contest.id });
    await audit.record({ actorId: actor.id, contestId: contest.id, action: 'message.sent', entityType: 'Contest', entityId: contest.id, details: { method, subject, sent: people.length } });
    return { sent: people.length, failed: [] };
  }
  if (!accessToken) throw new MessageError('Log in with your Wikimedia account to send messages.');
  if (method === 'massmessage' && !require('./featureService').now().massMessages) throw new MessageError('Choose how to send the message.');
  if (method === 'massmessage') return massList({ actor, accessToken, contest, subject, body, people, wiki: fallbackWiki });
  if (people.length > MAX_RECIPIENTS) throw new MessageError(`At most ${MAX_RECIPIENTS} people at a time.`);

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

// Writes the recipients as a MassMessage delivery list under the organizer's user page, and gives
// the link to Special:MassMessage with the list, subject and message filled in.
async function massList({ actor, accessToken, contest, subject, body, people, wiki }) {
  if (people.length > MAX_LIST) throw new MessageError('At most 5000 people at a time.');
  const { dbnameToHost } = require('../wiki/wikiUrls');
  const host = dbnameToHost(wiki);
  const title = `User:${actor.username}/Zury mass message/${contest.id ? (contest.path || String(contest.id)).replace(/^\//, '').replace(/\//g, '-') : new Date().toISOString().slice(0, 10)}`;
  const text = people.map((p) => `{{target |page=User talk:${p.username} |site=${dbnameToHost(p.wiki || wiki) || host}}}`).join('\n');
  const token = await csrfToken(wiki, accessToken);
  const r = await oauthService.userApi(wiki, accessToken, { action: 'edit', title, text, contentmodel: 'MassMessageListContent', summary: `${contest.title}: ${subject}`, token }, { post: true })
    .catch((err) => ({ error: { info: err.message } }));
  // Wikis without the MassMessage list type: a plain wikitext list works the same.
  const plain = r.error ? await oauthService.userApi(wiki, accessToken, { action: 'edit', title, text, summary: `${contest.title}: ${subject}`, token }, { post: true }) : r;
  if (plain.error) throw new MessageError(plain.error.info || 'The list page could not be saved.');
  const q = new URLSearchParams({ spamlist: title, subject, message: body });
  await audit.record({ actorId: actor.id, contestId: contest.id, action: 'message.list', entityType: 'Contest', entityId: contest.id, details: { subject, people: people.length, title } });
  return { sent: 0, failed: [], list: { title, people: people.length, pageUrl: `https://${host}/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`, sendUrl: `https://${host}/wiki/Special:MassMessage?${q}` } };
}

module.exports = { METHODS, AUDIENCES, MAX_RECIPIENTS, MessageError, recipients, send };

// Mass messages from organizers to people chosen by a list (participants, those with no entries,
// reviewers with work waiting, last edition's people who did not come back, …), sent as:
// a Zury notification; a talk-page section or Special:EmailUser with the organizer's own login;
// or a MassMessage list page written on the wiki, for someone with the right to send it.
// People who asked for no mass messages are left out of wiki messages.
const prisma = require('../config/prisma');
const audit = require('./auditService');
const oauthService = require('./wikimediaOAuthService');

const METHODS = { massmessage: 'MassMessage bot', bell: 'Zury notification', talk: 'Talk page', email: 'Email' };
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
  if (method === 'massmessage' && !(await canMassMessage(actor.username, fallbackWiki))) throw new MessageError('Only admins of this wiki can use the MassMessage bot.');
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

// MassMessage only sends to a list page, so the recipients are written to one fixed sandbox page
// (plain wikitext "# {{#target:User talk:Name}}" lines) and sent at once with the MassMessage API. If the API refuses
// (no massmessage-sender right, or the login lacks the grant), the Special:MassMessage link is given.
// The person's rights on that wiki, read from the wiki (kept 10 minutes).
const rightsKept = new Map();
async function canMassMessage(username, wiki) {
  if (!username || !wiki) return false;
  const key = `${wiki}|${username}`;
  const hit = rightsKept.get(key);
  if (hit && Date.now() - hit.at < 600000) return hit.ok;
  const d = await require('../wiki/wikiApi').get(wiki, { action: 'query', list: 'users', ususers: username, usprop: 'rights' }).catch(() => null);
  const ok = !!(d && (d.query?.users?.[0]?.rights || []).includes('massmessage'));
  rightsKept.set(key, { at: Date.now(), ok });
  return ok;
}

const MASS_LIST_PAGE = 'Project:খেলাঘর/ZuryMassMessage';
async function massList({ actor, accessToken, contest, subject, body, people, wiki }) {
  if (people.length > MAX_LIST) throw new MessageError('At most 5000 people at a time.');
  const { dbnameToHost } = require('../wiki/wikiUrls');
  const host = dbnameToHost(wiki);
  const title = MASS_LIST_PAGE;
  // MassMessage's own list syntax; the site is named only for someone on another wiki.
  const text = people.map((p) => {
    const site = dbnameToHost(p.wiki || wiki) || host;
    return `# {{#target:User talk:${p.username}${site !== host ? `|${site}` : ''}}}`;
  }).join('\n');
  const token = await csrfToken(wiki, accessToken);
  const saved = await oauthService.userApi(wiki, accessToken, { action: 'edit', title, text, summary: `${contest.title}: ${subject}`, token }, { post: true })
    .catch((err) => ({ error: { info: err.message } }));
  if (saved.error) throw new MessageError(saved.error.info || 'The list page could not be saved.');
  const pageUrl = `https://${host}/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
  // Sent right after saving, so nobody's sandbox edit gets in between.
  const sent = await oauthService.userApi(wiki, accessToken, { action: 'massmessage', spamlist: title, subject, message: body, token }, { post: true })
    .catch((err) => ({ error: { info: err.message } }));
  await audit.record({ actorId: actor.id, contestId: contest.id, action: sent.error ? 'message.list' : 'message.massmessage', entityType: 'Contest', entityId: contest.id, details: { subject, people: people.length, title, error: sent.error ? sent.error.info : undefined } });
  if (!sent.error) return { sent: Number(sent.massmessage?.count) || people.length, failed: [], bot: true, list: null };
  const q = new URLSearchParams({ spamlist: title, subject, message: body });
  return { sent: 0, failed: [], list: { title, people: people.length, pageUrl, sendUrl: `https://${host}/wiki/Special:MassMessage?${q}`, why: sent.error.info || '' } };
}

module.exports = { canMassMessage, METHODS, AUDIENCES, MAX_RECIPIENTS, MessageError, recipients, send };

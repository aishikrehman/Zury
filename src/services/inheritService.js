// Stage 4: settings given on a series or an edition for the events below. Separate from roles.
//
// A rule is locked (every event below uses it; they cannot change it), default (events use it
// until they set their own value) or optional (only suggested). Where a series and its edition
// both set a key: a series lock wins, then an edition lock, then the edition's default, then
// the series' default.
//
// Values are written into each event's ContestSettings (so everything that reads settings sees
// them), and ContestSettings.followed records which keys follow a parent. Nothing is overwritten
// silently: a default never replaces a value the event set itself, and every change an
// inherited rule makes to an event is in the event's activity log.
const prisma = require('../config/prisma');
const audit = require('./auditService');

const MODES = ['locked', 'default', 'optional'];
const builtIn = (type) => require('./contestFormService').defaultSettings(type);

// The settings a series or edition may give, with how to read a submitted value.
const KEYS = {
  registrationRequired: { label: 'Registration required', type: 'bool' },
  participationMode: { label: 'Who takes part', type: 'enum', options: ['individual', 'team', 'both'] },
  minAccountAgeDays: { label: 'Minimum account age (days)', type: 'int', min: 0, max: 36500 },
  minEditCount: { label: 'Minimum edit count', type: 'int', min: 0, max: 10000000 },
  participantLimit: { label: 'Participant limit', type: 'int', min: 1, max: 1000000, optional: true },
  allowJuryParticipation: { label: 'Reviewers may take part', type: 'bool' },
  allowOrganizerParticipation: { label: 'Organizers may take part', type: 'bool' },
  anonymousParticipants: { label: 'Anonymous participants', type: 'bool' },
  requiredReviews: { label: 'Reviews per entry', type: 'int', min: 1, max: 20 },
  decisionRule: { label: 'How reviews decide', type: 'enum', options: ['majority', 'unanimous', 'any', 'veto', 'first', 'score'] },
  passScore: { label: 'Pass mark', type: 'float', min: 0, max: 1000 },
  tieBreak: { label: 'A tie', type: 'enum', options: ['reject', 'accept', 'wait'] },
  secretBallot: { label: 'Secret ballot', type: 'bool' },
  reviewAssignment: { label: 'Who reviews which entry', type: 'enum', options: ['open', 'assigned', 'equal', 'fixed'] },
  rankBy: { label: 'What the results count', type: 'enum', options: ['articles', 'words', 'points'] },
  reviewMethod: { label: 'How reviewers judge', type: 'enum', options: ['yesno', 'stars', 'number', 'marks'] },
  selfReview: { label: 'Reviewers may review their own entries', type: 'bool' },
  bulkReviewEnabled: { label: 'Bulk review', type: 'bool' },
  juryStatsEnabled: { label: 'Reviewer statistics for everyone', type: 'bool' },
  wordCountMethod: { label: 'How words are counted', type: 'enum', options: ['auto', 'ztools', 'plain'] },
  // The event's on/off features, with the labels the event form uses.
  ...Object.fromEntries(require('./contestFormService').FEATURE_FIELDS.map(([key, label]) => [key, { label, type: 'bool' }])),
};

class InheritError extends Error {}

function readValue(key, raw) {
  const def = KEYS[key];
  if (!def) throw new InheritError('Choose a setting.');
  const v = String(raw ?? '').trim();
  if (def.type === 'bool') return v === 'true' || v === 'on' || v === '1';
  if (def.type === 'enum') {
    if (!def.options.includes(v)) throw new InheritError('Choose one of the values offered.');
    return v;
  }
  if (v === '' && def.optional) return null;
  const n = def.type === 'int' ? Number.parseInt(v, 10) : Number(v);
  if (!Number.isFinite(n) || n < def.min || n > def.max) throw new InheritError(`Enter a number from ${def.min} to ${def.max}.`);
  return n;
}

const parse = (s) => {
  try {
    const o = JSON.parse(s || '{}');
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch {
    return {};
  }
};

// The event's parents: { series, edition } (either may be null).
async function parentsOf(contest, client = prisma) {
  let edition = null;
  let seriesId = contest.seriesId || null;
  if (contest.editionId) {
    edition = await client.edition.findUnique({ where: { id: contest.editionId } });
    seriesId = edition?.seriesId || null;
  }
  const series = seriesId ? await client.eventSeries.findUnique({ where: { id: seriesId } }) : null;
  return { series, edition };
}

// For each key with a rule above the event: { value, mode, level, name, suggestions }.
async function rulesFor(contest, client = prisma) {
  const { series, edition } = await parentsOf(contest, client);
  const levels = [];
  if (series) levels.push({ seriesId: series.id });
  if (edition) levels.push({ editionId: edition.id });
  if (!levels.length) return {};
  const rows = await client.levelSetting.findMany({ where: { OR: levels } });
  const at = (level) => (key, mode) => rows.find((r) => r.key === key && r.mode === mode && (level === 'series' ? r.seriesId : r.editionId));
  const S = at('series');
  const E = at('edition');
  const out = {};
  for (const key of Object.keys(KEYS)) {
    const pick = [[S(key, 'locked'), 'series'], [E(key, 'locked'), 'edition'], [E(key, 'default'), 'edition'], [S(key, 'default'), 'series']].find(([r]) => r);
    const opt = [[E(key, 'optional'), 'edition'], [S(key, 'optional'), 'series']].find(([r]) => r);
    const chosen = pick || opt;
    if (!chosen) continue;
    const [row, level] = chosen;
    out[key] = { value: JSON.parse(row.value), mode: row.mode, level, name: level === 'series' ? series.title : edition.title };
  }
  return out;
}

// Brings one event in line with the rules above it. Locks always apply. Defaults reach keys the
// event follows; with fresh (a new event) every key; with adopt (a new rule, or an event moved under
// another parent) keys still at Zury's built-in value, so a value the event chose is never replaced.
async function applyToEvent(contestId, { actorId = null, fresh = false, adopt = false } = {}, client = prisma) {
  const contest = await client.contest.findUnique({ where: { id: contestId }, include: { settings: true } });
  if (!contest || !contest.settings) return [];
  const rules = await rulesFor(contest, client);
  const followed = parse(contest.settings.followed);
  const data = {};
  const changes = [];
  for (const [key, rule] of Object.entries(rules)) {
    if (rule.mode === 'optional') continue;
    const untouched = adopt && JSON.stringify(contest.settings[key]) === JSON.stringify(builtIn(contest.type)[key]);
    if (rule.mode === 'default' && !fresh && !untouched && !(key in followed)) continue;
    followed[key] = rule.level;
    if (JSON.stringify(contest.settings[key]) !== JSON.stringify(rule.value)) {
      data[key] = rule.value;
      changes.push({ key, from: contest.settings[key], to: rule.value, mode: rule.mode, source: rule.name });
    }
  }
  // Keys whose rule is gone keep their value, now as the event's own.
  for (const key of Object.keys(followed)) if (!rules[key] || rules[key].mode === 'optional') delete followed[key];
  data.followed = JSON.stringify(followed);
  if (data.followed !== contest.settings.followed || changes.length) await client.contestSettings.update({ where: { contestId }, data });
  // A locked setting is the same on every wiki of the event: drop wiki overrides of it.
  const lockedKeys = Object.keys(rules).filter((k) => rules[k].mode === 'locked');
  if (lockedKeys.length) {
    for (const w of await client.contestWiki.findMany({ where: { contestId } })) {
      const o = parse(w.overrides);
      if (!o.settings || !lockedKeys.some((k) => k in o.settings)) continue;
      for (const k of lockedKeys) delete o.settings[k];
      await client.contestWiki.update({ where: { id: w.id }, data: { overrides: JSON.stringify(o) } });
    }
  }
  if (changes.length) {
    await audit.record({ actorId, contestId, action: 'settings.inherited', entityType: 'Contest', entityId: contestId, details: { changes } }, client);
  }
  return changes;
}

const eventsBelow = (level) =>
  prisma.contest.findMany({
    where: { deletedAt: null, ...(level.editionId ? { editionId: level.editionId } : { OR: [{ seriesId: level.seriesId }, { editionOf: { seriesId: level.seriesId } }] }) },
    select: { id: true },
  });

async function applyBelow(level, actorId) {
  let changed = 0;
  for (const { id } of await eventsBelow(level)) if ((await applyToEvent(id, { actorId })).length) changed += 1;
  return changed;
}

// level: { seriesId } or { editionId }.
async function setRule({ actorId, level, key, value, mode }) {
  if (!KEYS[key]) throw new InheritError('Choose a setting.');
  if (!MODES.includes(mode)) throw new InheritError('Choose how it applies.');
  if (!!level.seriesId === !!level.editionId) throw new InheritError('Choose the series or one of its editions.');
  const v = readValue(key, value);
  const where = { key, seriesId: level.seriesId || null, editionId: level.editionId || null };
  const old = await prisma.levelSetting.findFirst({ where });
  const data = { value: JSON.stringify(v), mode, updatedById: actorId };
  if (old) await prisma.levelSetting.update({ where: { id: old.id }, data });
  else await prisma.levelSetting.create({ data: { ...where, ...data } });
  // A new or newly locked rule reaches events that had no say yet; for a changed default only
  // events still following it move. Events with their own value keep it.
  const events = await eventsBelow(level);
  let changed = 0;
  for (const { id } of events) if ((await applyToEvent(id, { actorId, adopt: !old || old.mode === 'optional' })).length) changed += 1;
  await audit.record({
    actorId, action: 'levelSetting.set', entityType: level.seriesId ? 'EventSeries' : 'Edition', entityId: level.seriesId || level.editionId,
    details: { key, from: old ? { value: JSON.parse(old.value), mode: old.mode } : null, to: { value: v, mode }, eventsChanged: changed },
  });
  return { changed, events: events.length };
}

async function removeRule({ actorId, id, seriesId, editionIds }) {
  const row = await prisma.levelSetting.findFirst({ where: { id, OR: [{ seriesId }, { editionId: { in: editionIds } }] } });
  if (!row) throw new InheritError('That setting is not on this series.');
  await prisma.levelSetting.delete({ where: { id: row.id } });
  const level = row.seriesId ? { seriesId: row.seriesId } : { editionId: row.editionId };
  await applyBelow(level, actorId);
  await audit.record({ actorId, action: 'levelSetting.removed', entityType: row.seriesId ? 'EventSeries' : 'Edition', entityId: row.seriesId || row.editionId, details: { key: row.key, from: { value: JSON.parse(row.value), mode: row.mode } } });
}

// Before an event saves its own settings: locked keys keep the locked value (reported back),
// and a followed key the organizer changed becomes the event's own.
async function guardUpdate(contest, current, submitted) {
  const rules = await rulesFor(contest);
  const followed = parse(current.followed);
  const refused = [];
  for (const [key, rule] of Object.entries(rules)) {
    if (rule.mode !== 'locked' || !(key in submitted)) continue;
    if (JSON.stringify(submitted[key]) !== JSON.stringify(rule.value)) refused.push(key);
    submitted[key] = rule.value;
  }
  for (const key of Object.keys(followed)) {
    if (rules[key]?.mode === 'locked') continue;
    if (key in submitted && JSON.stringify(submitted[key]) !== JSON.stringify(current[key])) delete followed[key];
  }
  submitted.followed = JSON.stringify(followed);
  return refused;
}

// Take the parent's value again for one key.
async function follow({ actorId, contest, key }) {
  const rules = await rulesFor(contest);
  if (!rules[key] || rules[key].mode === 'optional') {
    // An optional rule: take its value once, as the event's own.
    if (!rules[key]) throw new InheritError('Nothing above this event sets that.');
    await prisma.contestSettings.update({ where: { contestId: contest.id }, data: { [key]: rules[key].value } });
    await audit.record({ actorId, contestId: contest.id, action: 'settings.inherited', entityType: 'Contest', entityId: contest.id, details: { changes: [{ key, to: rules[key].value, mode: 'optional', source: rules[key].name }] } });
    return;
  }
  const s = await prisma.contestSettings.findUnique({ where: { contestId: contest.id } });
  const followed = parse(s.followed);
  followed[key] = rules[key].level;
  await prisma.contestSettings.update({ where: { contestId: contest.id }, data: { followed: JSON.stringify(followed) } });
  await applyToEvent(contest.id, { actorId });
}

// What the settings page shows: each key with a rule, and whether the event follows it.
async function viewFor(contest, settings) {
  const rules = await rulesFor(contest);
  const followed = parse(settings.followed);
  return Object.entries(rules).map(([key, r]) => ({
    key, label: KEYS[key].label, ...r,
    following: r.mode === 'locked' || key in followed,
    own: settings[key],
  }));
}

function list({ seriesId, editionIds = [] }) {
  return prisma.levelSetting.findMany({
    where: { OR: [{ seriesId }, ...(editionIds.length ? [{ editionId: { in: editionIds } }] : [])] },
    include: { edition: { select: { slug: true } } },
    orderBy: [{ editionId: 'asc' }, { key: 'asc' }],
  });
}

function history({ seriesId, editionIds = [] }) {
  return prisma.auditLog.findMany({
    where: {
      action: { startsWith: 'levelSetting.' },
      OR: [{ entityType: 'EventSeries', entityId: String(seriesId) }, ...(editionIds.length ? [{ entityType: 'Edition', entityId: { in: editionIds.map(String) } }] : [])],
    },
    include: { actor: { select: { username: true } } },
    orderBy: { id: 'desc' },
    take: 20,
  });
}

module.exports = { KEYS, MODES, InheritError, readValue, rulesFor, applyToEvent, setRule, removeRule, guardUpdate, follow, viewFor, list, history };

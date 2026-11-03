const { EVENT_TYPES, parseTypeConfig, readTypeConfig } = require('../events/eventTypes');
const { zonedLocalToUtc, utcToZonedLocal, isValidTimezone } = require('../utils/time');

const WIKI_DBNAME = /^[a-z][a-z0-9_]*(wiki|wiktionary|wikibooks|wikinews|wikiquote|wikisource|wikiversity|wikivoyage)$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LANGUAGE_CODE = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i;
// Images must come from Wikimedia's upload servers, never arbitrary hosts.
const IMAGE_HOSTS = new Set(['upload.wikimedia.org']);

const DATE_FIELDS = [
  ['registrationOpensAt', 'Registration opens'],
  ['registrationClosesAt', 'Registration closes'],
  ['startDate', 'Event starts'],
  ['endDate', 'Event ends'],
  ['submissionOpensAt', 'Submissions open'],
  ['submissionDeadline', 'Submission deadline'],
  ['reviewOpensAt', 'Review opens'],
  ['reviewDeadline', 'Review deadline'],
  ['appealDeadline', 'Appeal deadline'],
  ['resultsAnnouncedAt', 'Results announced'],
];

// [earlier, later]: when both are set, earlier must not be after later.
const DATE_ORDER = [
  ['registrationOpensAt', 'registrationClosesAt'],
  ['startDate', 'endDate'],
  ['submissionOpensAt', 'submissionDeadline'],
  ['reviewOpensAt', 'reviewDeadline'],
  ['submissionDeadline', 'reviewDeadline'],
  ['submissionDeadline', 'appealDeadline'],
  ['reviewDeadline', 'resultsAnnouncedAt'],
  ['startDate', 'submissionDeadline'],
];

const FEATURE_FIELDS = [
  ['juryReviewEnabled', 'Jury review', 'Jurors score or approve entries.'],
  ['appealsEnabled', 'Appeals', 'Participants can appeal decisions.'],
  ['registrationEnabled', 'Self-registration', 'Logged-in users can join the event themselves.'],
  ['massSubmissionEnabled', 'Mass submission', 'Participants can submit many entries at once.'],
  ['autoValidationEnabled', 'Automatic validation', 'Entries are checked against the rules when submitted.'],
  ['contributionDiscoveryEnabled', 'Contribution discovery', "Participants' edits during the event are found automatically."],
  ['badgesEnabled', 'Badges', 'Award badges to participants and winners.'],
  ['publicStatisticsEnabled', 'Public statistics', 'Anyone can see the statistics page.'],
  ['participantNotificationsEnabled', 'Participant notifications', 'Participants are notified about their entries.'],
];

const PARTICIPATION_MODES = { individual: 'Individuals only', team: 'Teams only', both: 'Individuals and teams' };

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const bool = (v) => v === 'on' || v === 'true' || v === true;
const listOf = (v) => [...new Set(str(Array.isArray(v) ? v.join('\n') : v).split(/[\s,]+/).filter(Boolean))];

function slugify(title) {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
}

function imageUrl(value, errors, key) {
  if (!value) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    errors[key] = 'Enter a full URL.';
    return null;
  }
  if (url.protocol !== 'https:' || !IMAGE_HOSTS.has(url.hostname)) {
    errors[key] = 'Use an https://upload.wikimedia.org/ file URL (the "Original file" link on Commons).';
    return null;
  }
  return url.toString();
}

function intField(value, { min, max, optional = false }, errors, key) {
  const s = str(value);
  if (s === '') return optional ? null : min;
  const n = Number(s);
  if (!Number.isInteger(n) || n < min || n > max) {
    errors[key] = `Enter a whole number from ${min} to ${max}${optional ? ', or leave blank' : ''}.`;
    return null;
  }
  return n;
}

/**
 * @param body       submitted form
 * @param type       event type (fixed after creation)
 * @param wikiAllowed (wiki) => boolean: whether this editor may use a primary wiki
 */
// catalog: validators from the stored wiki/language catalog (see catalogService.validators).
// When the catalog hasn't been fetched yet, only the name format is checked.
const PERMISSIVE = { empty: true, known: () => true, open: () => true, language: () => true };

function parse(body, { type, wikiAllowed, catalog = PERMISSIVE }) {
  const errors = {};
  const typeDef = EVENT_TYPES[type];

  const title = str(body.title);
  if (title.length < 3 || title.length > 200) errors.title = 'Enter a title of 3 to 200 characters.';

  const slug = str(body.slug).toLowerCase() || slugify(title);
  if (!SLUG.test(slug) || slug.length > 80) errors.slug = 'Use lowercase letters, numbers and single hyphens (max 80).';

  const description = str(body.description);
  if (description.length > 5000) errors.description = 'At most 5000 characters.';
  const organizingCommunity = str(body.organizingCommunity);
  if (organizingCommunity.length > 200) errors.organizingCommunity = 'At most 200 characters.';
  const contactInfo = str(body.contactInfo);
  if (contactInfo.length > 500) errors.contactInfo = 'At most 500 characters.';

  const primaryWiki = str(body.primaryWiki).toLowerCase();
  if (!WIKI_DBNAME.test(primaryWiki) && catalog.empty) errors.primaryWiki = 'Choose a wiki.';
  else if (!catalog.known(primaryWiki)) errors.primaryWiki = 'This wiki does not exist.';
  else if (!catalog.open(primaryWiki)) errors.primaryWiki = 'This wiki is closed.';
  else if (!wikiAllowed(primaryWiki)) errors.primaryWiki = "You can't use this wiki as the primary wiki.";

  const additionalWikis = listOf(body.additionalWikis).map((w) => w.toLowerCase()).filter((w) => w !== primaryWiki);
  const unknownWiki = additionalWikis.find((w) => (catalog.empty ? !WIKI_DBNAME.test(w) : !catalog.known(w)));
  if (unknownWiki) errors.additionalWikis = `Unknown wiki: ${unknownWiki}`;
  else if (additionalWikis.length > 20) errors.additionalWikis = 'At most 20 additional wikis.';

  const language = str(body.language) || 'en';
  if (!LANGUAGE_CODE.test(language) || !catalog.language(language)) errors.language = 'Unknown language.';
  const timezone = str(body.timezone) || 'UTC';
  if (!isValidTimezone(timezone)) errors.timezone = 'Unknown timezone.';
  const visibility = body.visibility === 'private' ? 'private' : 'public';

  const logoUrl = imageUrl(str(body.logoUrl), errors, 'logoUrl');
  const bannerUrl = imageUrl(str(body.bannerUrl), errors, 'bannerUrl');

  const dates = {};
  for (const [key, label] of DATE_FIELDS) {
    const raw = str(body[key]);
    dates[key] = null;
    if (!raw) continue;
    const parsed = isValidTimezone(timezone) ? zonedLocalToUtc(raw, timezone) : null;
    if (!parsed) errors[key] = `${label}: enter a valid date and time.`;
    else dates[key] = parsed;
  }
  const labelOf = Object.fromEntries(DATE_FIELDS);
  for (const [a, b] of DATE_ORDER) {
    if (dates[a] && dates[b] && dates[a] > dates[b] && !errors[b]) errors[b] = `Must not be before "${labelOf[a]}".`;
  }

  const participationMode = PARTICIPATION_MODES[body.participationMode] ? body.participationMode : 'individual';
  const settings = {
    registrationRequired: bool(body.registrationRequired),
    participationMode,
    minAccountAgeDays: intField(body.minAccountAgeDays, { min: 0, max: 36500 }, errors, 'minAccountAgeDays'),
    minEditCount: intField(body.minEditCount, { min: 0, max: 10000000 }, errors, 'minEditCount'),
    participantLimit: intField(body.participantLimit, { min: 1, max: 1000000, optional: true }, errors, 'participantLimit'),
    allowJuryParticipation: bool(body.allowJuryParticipation),
    allowOrganizerParticipation: bool(body.allowOrganizerParticipation),
    anonymousParticipants: bool(body.anonymousParticipants),
  };
  const namespaces = listOf(body.eligibleNamespaces).map(Number);
  if (namespaces.some((n) => !Number.isInteger(n) || n < 0 || n > 9999)) errors.eligibleNamespaces = 'Use namespace numbers such as 0 or 6.';
  settings.eligibleNamespaces = JSON.stringify(namespaces.filter(Number.isInteger));
  for (const [key] of FEATURE_FIELDS) settings[key] = bool(body[key]);

  const typeInput = Object.fromEntries(
    typeDef.fields.map((f) => [f.key, body[`type_${f.key}`]]),
  );
  const typeResult = parseTypeConfig(type, typeInput);
  for (const [k, v] of Object.entries(typeResult.errors)) errors[`type_${k}`] = v;
  settings.typeConfig = JSON.stringify(typeResult.values);

  return {
    errors,
    contest: {
      title,
      slug,
      description,
      organizingCommunity,
      primaryWiki,
      additionalWikis: JSON.stringify(additionalWikis),
      language,
      timezone,
      visibility,
      contactInfo,
      logoUrl,
      bannerUrl,
      ...dates,
    },
    settings,
    form: { ...body, slug, type },
  };
}

// Form values for an existing event (dates in the event's own timezone).
function toForm(contest, settings) {
  const form = {
    type: contest.type,
    title: contest.title,
    slug: contest.slug,
    description: contest.description,
    organizingCommunity: contest.organizingCommunity,
    primaryWiki: contest.primaryWiki,
    additionalWikis: JSON.parse(contest.additionalWikis || '[]').join('\n'),
    language: contest.language,
    timezone: contest.timezone,
    visibility: contest.visibility,
    contactInfo: contest.contactInfo,
    logoUrl: contest.logoUrl || '',
    bannerUrl: contest.bannerUrl || '',
  };
  for (const [key] of DATE_FIELDS) form[key] = utcToZonedLocal(contest[key], contest.timezone);
  const s = settings || defaultSettings(contest.type);
  Object.assign(form, {
    registrationRequired: s.registrationRequired,
    participationMode: s.participationMode,
    minAccountAgeDays: String(s.minAccountAgeDays),
    minEditCount: String(s.minEditCount),
    participantLimit: s.participantLimit == null ? '' : String(s.participantLimit),
    allowJuryParticipation: s.allowJuryParticipation,
    allowOrganizerParticipation: s.allowOrganizerParticipation,
    anonymousParticipants: s.anonymousParticipants,
    eligibleNamespaces: JSON.parse(s.eligibleNamespaces || '[]').join(', '),
  });
  for (const [key] of FEATURE_FIELDS) form[key] = s[key];
  const typeConfig = readTypeConfig(contest.type, s.typeConfig);
  for (const [key, value] of Object.entries(typeConfig)) form[`type_${key}`] = Array.isArray(value) ? value : value;
  return form;
}

// Settings for a brand-new event of this type (schema defaults + type defaults).
function defaultSettings(type) {
  const base = {
    juryReviewEnabled: true,
    appealsEnabled: false,
    registrationEnabled: true,
    massSubmissionEnabled: false,
    autoValidationEnabled: true,
    contributionDiscoveryEnabled: false,
    badgesEnabled: false,
    publicStatisticsEnabled: true,
    participantNotificationsEnabled: true,
    registrationRequired: false,
    participationMode: 'individual',
    minAccountAgeDays: 0,
    minEditCount: 0,
    participantLimit: null,
    allowJuryParticipation: false,
    allowOrganizerParticipation: false,
    anonymousParticipants: false,
    eligibleNamespaces: '[]',
    typeConfig: JSON.stringify(readTypeConfig(type, '{}')),
  };
  return { ...base, ...EVENT_TYPES[type].defaults };
}

function newForm(type) {
  const t = EVENT_TYPES[type];
  return toForm(
    {
      type,
      title: '',
      slug: '',
      description: '',
      organizingCommunity: '',
      primaryWiki: t.defaultWiki || '',
      additionalWikis: '[]',
      language: 'en',
      timezone: 'UTC',
      visibility: 'public',
      contactInfo: '',
    },
    defaultSettings(type),
  );
}

module.exports = {
  DATE_FIELDS,
  FEATURE_FIELDS,
  PARTICIPATION_MODES,
  WIKI_DBNAME,
  parse,
  toForm,
  newForm,
  defaultSettings,
  slugify,
};

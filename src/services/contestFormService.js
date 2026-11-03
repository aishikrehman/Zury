const { EVENT_TYPES, parseTypeConfig, readTypeConfig } = require('../events/eventTypes');
const { zonedLocalToUtc, utcToZonedLocal, isValidTimezone } = require('../utils/time');
const { PROJECT_CATEGORIES } = require('../utils/contestLabels');

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
  ['contributionDiscoveryEnabled', "Track participants' edits", "Participants' edits during the event are found automatically."],
  ['badgesEnabled', 'Badges', 'Award badges to participants and winners.'],
  ['publicStatisticsEnabled', 'Public statistics', 'Anyone can see the statistics page.'],
  ['participantNotificationsEnabled', 'Participant notifications', 'Participants are notified about their entries.'],
];

const PARTICIPATION_MODES = { individual: 'Individuals only', team: 'Teams only', both: 'Individuals and teams' };

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const bool = (v) => v === 'on' || v === 'true' || v === true;
// One item per line (for values that contain spaces, such as category names).
const lines = (v) => str(Array.isArray(v) ? v.join('\n') : v).split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
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

  const { RESERVED } = require('../middleware/permissions');

  // Optional recurring-event address: /<series>/<edition>, e.g. /wam/2026.
  // "Part of" takes an existing series' address or a new name ("Wiki Loves Food").
  const seriesRaw = str(body.seriesSlug);
  const seriesIsSlug = SLUG.test(seriesRaw.toLowerCase());
  const seriesSlug = seriesIsSlug ? seriesRaw.toLowerCase() : slugify(seriesRaw).slice(0, 40).replace(/-+$/, '');
  const seriesTitle = seriesRaw && !seriesIsSlug ? seriesRaw.slice(0, 200) : '';
  const edition = str(body.edition).toLowerCase();
  const inSeries = !!(seriesRaw || edition);
  if (inSeries) {
    if (!seriesSlug || seriesSlug.length > 40 || RESERVED.has(seriesSlug)) errors.seriesSlug = 'Use a name in Latin letters or numbers, e.g. Wiki Loves Monuments.';
    if (!edition) errors.edition = 'Add the edition, e.g. 2026.';
    else if (!/^[a-z0-9][a-z0-9-]{0,19}$/.test(edition)) errors.edition = 'Use a short edition such as 2026.';
  }

  // The address. Made from the title when left empty; titles without Latin letters
  // (e.g. Bangla) fall back to the series and edition, or "event". In a series the
  // address isn't shown, so an unusable one is replaced instead of reported.
  const typedSlug = str(body.slug).toLowerCase();
  const fallbackSlug = slugify(title) || (seriesSlug && edition ? `${seriesSlug}-${edition}` : 'event');
  let slug = typedSlug || fallbackSlug;
  const autoSlug = !typedSlug || (inSeries && (!SLUG.test(typedSlug) || RESERVED.has(typedSlug)));
  if (autoSlug) slug = fallbackSlug.slice(0, 80).replace(/-+$/, '');
  if (!SLUG.test(slug) || slug.length > 80) errors.slug = 'Use lowercase Latin letters, numbers and single hyphens, e.g. dhaka-photowalk-2026.';
  else if (RESERVED.has(slug)) errors.slug = 'This address is used by Zury itself; choose another.';

  const category = PROJECT_CATEGORIES[body.category] ? body.category : '';
  const previousEditionUrl = str(body.previousEditionUrl);
  if (previousEditionUrl && (!/^https?:\/\/\S+$/.test(previousEditionUrl) || previousEditionUrl.length > 500)) errors.previousEditionUrl = 'Enter a full link, e.g. https://…';
  const mainCategory = str(body.mainCategory).replace(/^Category:/i, '').trim();
  if (mainCategory.length > 200 || /[#<>[\]{}|]/.test(mainCategory)) errors.mainCategory = 'Enter a category name without the "Category:" prefix.';

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

  const language = str(body.language) || (catalog.wikiLanguage && catalog.wikiLanguage(primaryWiki)) || 'en';
  if (!LANGUAGE_CODE.test(language) || !catalog.language(language)) errors.language = 'Unknown language.';
  const timezone = str(body.timezone);
  if (!timezone) errors.timezone = 'Choose a time zone.';
  else if (!isValidTimezone(timezone)) errors.timezone = 'Unknown time zone.';
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

  // Tracking: hashtags in edit summaries and categories pages are added to.
  const hashtags = listOf(body.trackHashtags).map((h) => h.replace(/^#/, ''));
  if (hashtags.some((h) => !/^[\p{L}\p{N}_-]{2,50}$/u.test(h))) errors.trackHashtags = 'Use hashtags of letters, numbers, - and _ such as wam2026.';
  else if (hashtags.length > 10) errors.trackHashtags = 'At most 10 hashtags.';
  const categories = lines(body.trackCategories).map((c) => c.replace(/^Category:/i, '').trim());
  if (categories.some((c) => c.length > 200 || /[#<>[\]{}|]/.test(c))) errors.trackCategories = 'Enter category names without the "Category:" prefix.';
  else if (categories.length > 10) errors.trackCategories = 'At most 10 categories.';
  // Marks the jury give (Fountain-style), e.g. "Accepted: Yes = 1, No = 0".
  let marks = [];
  try {
    marks = JSON.parse(str(body.marks) || '[]');
  } catch {
    errors.marks = 'The marks could not be read.';
  }
  if (!Array.isArray(marks)) marks = [];
  marks = marks
    .map((m) => ({
      name: String(m?.name || '').trim().slice(0, 60),
      values: (Array.isArray(m?.values) ? m.values : [])
        .map((v) => ({ label: String(v?.label || '').trim().slice(0, 40), points: Number(v?.points) }))
        .filter((v) => v.label),
    }))
    .filter((m) => m.name);
  if (marks.length > 10) errors.marks = 'At most 10 marks.';
  else if (marks.some((m) => !m.values.length || m.values.length > 10)) errors.marks = 'Each mark needs 1 to 10 values.';
  else if (marks.some((m) => m.values.some((v) => !Number.isInteger(v.points) || v.points < -100 || v.points > 100))) errors.marks = 'Points must be whole numbers from -100 to 100.';
  settings.marks = JSON.stringify(marks);
  settings.trackHashtags = JSON.stringify([...new Set(hashtags)]);
  settings.trackCategories = JSON.stringify([...new Set(categories)]);
  for (const [key] of FEATURE_FIELDS) settings[key] = bool(body[key]);

  const typeInput = Object.fromEntries(
    typeDef.fields.map((f) => [f.key, body[`type_${f.key}`]]),
  );
  const typeResult = parseTypeConfig(type, typeInput);
  for (const [k, v] of Object.entries(typeResult.errors)) errors[`type_${k}`] = v;
  settings.typeConfig = JSON.stringify(typeResult.values);

  return {
    errors,
    series: seriesSlug && edition ? { slug: seriesSlug, edition, title: seriesTitle } : null,
    autoSlug,
    contest: {
      title,
      slug,
      description,
      organizingCommunity,
      category,
      previousEditionUrl,
      mainCategory,
      primaryWiki,
      language,
      timezone,
      visibility,
      contactInfo,
      logoUrl,
      bannerUrl,
      ...dates,
    },
    settings,
    form: { ...body, slug: typedSlug && !autoSlug ? typedSlug : slug, type },
  };
}

// Form values for an existing event (dates in the event's own timezone).
function toForm(contest, settings) {
  const form = {
    type: contest.type,
    title: contest.title,
    slug: contest.slug,
    seriesSlug: contest.series ? contest.series.slug : '',
    edition: contest.edition || '',
    description: contest.description,
    organizingCommunity: contest.organizingCommunity,
    category: contest.category || '',
    previousEditionUrl: contest.previousEditionUrl || '',
    mainCategory: contest.mainCategory || '',
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
    marks: s.marks || '[]',
    trackHashtags: JSON.parse(s.trackHashtags || '[]').join(', '),
    trackCategories: JSON.parse(s.trackCategories || '[]').join('\n'),
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
    trackHashtags: '[]',
    trackCategories: '[]',
    marks: '[]',
    typeConfig: JSON.stringify(readTypeConfig(type, '{}')),
  };
  return { ...base, ...EVENT_TYPES[type].defaults };
}

function newForm(type) {
  return toForm(
    {
      type,
      title: '',
      slug: '',
      description: '',
      organizingCommunity: '',
      primaryWiki: '',
      additionalWikis: '[]',
      language: '',
      timezone: '',
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

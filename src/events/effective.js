// Per-wiki settings: a wiki in an event inherits every setting from the event
// unless it overrides it. Overrides store only the fields that differ.
const { EVENT_TYPES, readTypeConfig } = require('./eventTypes');
const { computeAutoStatus, STICKY_STATUSES } = require('../services/lifecycleService');

const OVERRIDABLE = {
  contest: [
    'description',
    'contactInfo',
    'timezone',
    'registrationOpensAt',
    'registrationClosesAt',
    'startDate',
    'endDate',
    'submissionOpensAt',
    'submissionDeadline',
    'reviewOpensAt',
    'reviewDeadline',
    'appealDeadline',
    'resultsAnnouncedAt',
  ],
  settings: [
    'juryReviewEnabled',
    'appealsEnabled',
    'registrationEnabled',
    'massSubmissionEnabled',
    'autoValidationEnabled',
    'contributionDiscoveryEnabled',
    'badgesEnabled',
    'publicStatisticsEnabled',
    'participantNotificationsEnabled',
    'registrationRequired',
    'participationMode',
    'minAccountAgeDays',
    'minEditCount',
    'participantLimit',
    'allowJuryParticipation',
    'allowOrganizerParticipation',
    'anonymousParticipants',
    'eligibleNamespaces',
    'trackHashtags',
    'trackCategories',
    'requiredReviews',
  ],
};
const DATE_KEYS = new Set(OVERRIDABLE.contest.filter((k) => k.endsWith('At') || k.endsWith('Date') || k.endsWith('Deadline')));

function readOverrides(json) {
  let raw = {};
  try {
    raw = JSON.parse(json || '{}');
  } catch {
    raw = {};
  }
  const contest = {};
  for (const [k, v] of Object.entries(raw.contest || {})) {
    if (!OVERRIDABLE.contest.includes(k)) continue;
    contest[k] = DATE_KEYS.has(k) && v ? new Date(v) : v;
  }
  const settings = Object.fromEntries(Object.entries(raw.settings || {}).filter(([k]) => OVERRIDABLE.settings.includes(k)));
  return { contest, settings, typeConfig: raw.typeConfig && typeof raw.typeConfig === 'object' ? raw.typeConfig : {} };
}

/**
 * Effective event and settings for one wiki of an event.
 * Returns { contest, settings, typeConfig, overridden: Set of "section.key" }.
 */
function effectiveFor(contest, settings, eventWiki, now = new Date()) {
  const o = eventWiki ? readOverrides(eventWiki.overrides) : { contest: {}, settings: {}, typeConfig: {} };
  const fields = EVENT_TYPES[contest.type].fields.map((f) => f.key);
  const typeOverride = Object.fromEntries(Object.entries(o.typeConfig).filter(([k]) => fields.includes(k)));
  const typeConfig = { ...readTypeConfig(contest.type, settings.typeConfig), ...typeOverride };
  const effSettings = { ...settings, ...o.settings, typeConfig: JSON.stringify(typeConfig) };
  const effContest = { ...contest, ...o.contest, ...(eventWiki && { primaryWiki: eventWiki.wiki }) };

  // A wiki with its own dates gets its own status unless the event's status was set by hand.
  if (!STICKY_STATUSES.includes(contest.status) && contest.statusMode !== 'manual') {
    effContest.status = computeAutoStatus(effContest, effSettings, now);
  }
  if (eventWiki && eventWiki.status === 'paused' && !STICKY_STATUSES.includes(effContest.status)) effContest.status = 'paused';

  const overridden = new Set([
    ...Object.keys(o.contest).map((k) => `contest.${k}`),
    ...Object.keys(o.settings).map((k) => `settings.${k}`),
    ...Object.keys(typeOverride).map((k) => `type.${k}`),
  ]);
  return { contest: effContest, settings: effSettings, typeConfig, overridden };
}

// Builds an overrides object from fully-parsed values, keeping only the chosen keys.
function buildOverrides(parsed, typeValues, chosen) {
  const out = { contest: {}, settings: {}, typeConfig: {} };
  for (const key of chosen) {
    const [section, field] = key.split('.');
    if (section === 'contest' && OVERRIDABLE.contest.includes(field)) {
      const v = parsed.contest[field];
      out.contest[field] = v instanceof Date ? v.toISOString() : v;
    } else if (section === 'settings' && OVERRIDABLE.settings.includes(field)) {
      out.settings[field] = parsed.settings[field];
    } else if (section === 'type' && field in typeValues) {
      out.typeConfig[field] = typeValues[field];
    }
  }
  return out;
}

module.exports = { OVERRIDABLE, DATE_KEYS, readOverrides, effectiveFor, buildOverrides };

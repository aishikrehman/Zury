// Event types: their defaults and the type-specific options organizers can set.
// Field types: int, bool, string, list (one item per line or comma), choices (multi-select).

const EVENT_TYPES = {
  photo: {
    label: 'Photo contest',
    description: 'Photographers submit their Wikimedia Commons uploads, e.g. Wiki Loves Monuments.',
    defaultWiki: 'commonswiki',
    defaultNamespaces: [6],
    defaults: { juryReviewEnabled: true, massSubmissionEnabled: true },
    fields: [
      { key: 'maxEntriesPerParticipant', label: 'Maximum entries per participant', type: 'int', min: 0, max: 10000, default: 0, help: '0 means no limit.' },
      { key: 'minResolutionMegapixels', label: 'Minimum resolution (megapixels)', type: 'int', min: 0, max: 200, default: 2 },
      { key: 'requiredCategory', label: 'Required Commons category', type: 'string', maxLength: 255, default: '', help: 'Without the "Category:" prefix. Leave blank for none.' },
      { key: 'uploadedDuringEventOnly', label: 'Only files uploaded during the event', type: 'bool', default: true },
      { key: 'awardCategories', label: 'Award categories', type: 'list', maxItems: 20, maxLength: 80, default: [], help: 'One per line, e.g. "Best monument", "Best interior".' },
    ],
  },
  writing: {
    label: 'Writing contest',
    description: 'Participants create or improve articles on Wikipedia or another text project.',
    defaultWiki: null,
    defaultNamespaces: [0],
    defaults: { juryReviewEnabled: true },
    fields: [
      { key: 'minWordCount', label: 'Minimum word count', type: 'int', min: 0, max: 100000, default: 300 },
      { key: 'minBytes', label: 'Minimum article size (bytes)', type: 'int', min: 0, max: 10000000, default: 3000 },
      { key: 'createdDuringEventOnly', label: 'Only articles created during the event', type: 'bool', default: true },
      { key: 'allowExpansions', label: 'Also accept substantial expansions of existing articles', type: 'bool', default: false },
    ],
  },
  data: {
    label: 'Data contest',
    description: 'Structured-data contributions on Wikidata, Wiktionary or similar projects.',
    defaultWiki: 'wikidatawiki',
    defaultNamespaces: [0],
    defaults: { juryReviewEnabled: false, autoValidationEnabled: true },
    fields: [
      { key: 'entityTypes', label: 'Accepted entity types', type: 'choices', choices: { item: 'Items', property: 'Properties', lexeme: 'Lexemes' }, default: ['item'] },
      { key: 'requiredProperties', label: 'Required properties', type: 'list', pattern: /^P[1-9]\d*$/, patternHelp: 'Use property IDs like P17.', maxItems: 50, maxLength: 12, default: [], help: 'One property ID per line, e.g. P17, P625.' },
      { key: 'minStatements', label: 'Minimum statements per entity', type: 'int', min: 0, max: 10000, default: 0 },
    ],
  },
  editathon: {
    label: 'Edit-a-thon',
    description: 'Registered participants edit a set of pages; contributions are counted over the event dates.',
    defaultWiki: null,
    defaultNamespaces: [0],
    defaults: { juryReviewEnabled: false, contributionDiscoveryEnabled: true, registrationRequired: true },
    fields: [
      { key: 'trackNewArticles', label: 'Count new articles', type: 'bool', default: true },
      { key: 'trackEdits', label: 'Count edits to existing pages', type: 'bool', default: true },
      { key: 'minBytesChanged', label: 'Minimum bytes changed per edit', type: 'int', min: 0, max: 1000000, default: 0 },
    ],
  },
};

// Activities: people register for sessions and organizers record attendance.
const CERTIFICATE = { key: 'minSessionsForCertificate', label: 'Sessions to attend for a certificate', type: 'int', min: 0, max: 100, default: 1, help: '0 means no certificate.' };

Object.assign(EVENT_TYPES, {
  workshop: {
    label: 'Workshop',
    description: 'Hands-on sessions, online or in person, with registration and attendance.',
    defaultWiki: null,
    defaultNamespaces: [0],
    activity: true,
    entries: false,
    defaults: { juryReviewEnabled: false, registrationRequired: true, contributionDiscoveryEnabled: true },
    fields: [
      { key: 'topics', label: 'Topics', type: 'list', maxItems: 20, maxLength: 80, default: [], help: 'One per line, e.g. "Citing sources".' },
      CERTIFICATE,
    ],
  },
  training: {
    label: 'Training',
    description: 'A course of online or offline sessions for new or experienced editors.',
    defaultWiki: null,
    defaultNamespaces: [0],
    activity: true,
    entries: false,
    defaults: { juryReviewEnabled: false, registrationRequired: true, contributionDiscoveryEnabled: true },
    fields: [
      { key: 'levels', label: 'Level', type: 'choices', choices: { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' }, default: ['beginner'] },
      { key: 'topics', label: 'Topics', type: 'list', maxItems: 20, maxLength: 80, default: [], help: 'One per line.' },
      CERTIFICATE,
    ],
  },
  photowalk: {
    label: 'Photowalk',
    description: 'Walk and photograph together, then upload to Wikimedia Commons.',
    defaultWiki: 'commonswiki',
    defaultNamespaces: [6],
    activity: true,
    entries: true,
    defaults: { juryReviewEnabled: false, registrationRequired: true, massSubmissionEnabled: true },
    fields: [
      { key: 'meetingPoint', label: 'Meeting point', type: 'string', maxLength: 200, default: '' },
      { key: 'requiredCategory', label: 'Upload category', type: 'string', maxLength: 255, default: '', help: 'Without the "Category:" prefix. Leave blank for none.' },
      { key: 'minResolutionMegapixels', label: 'Minimum resolution (megapixels)', type: 'int', min: 0, max: 200, default: 0 },
      { key: 'uploadedDuringEventOnly', label: 'Only files uploaded during the event', type: 'bool', default: true },
      { key: 'maxEntriesPerParticipant', label: 'Maximum entries per participant', type: 'int', min: 0, max: 10000, default: 0, help: '0 means no limit.' },
    ],
  },
});

// Whether people submit entries to this type of event.
const takesEntries = (type) => EVENT_TYPES[type].entries !== false;

function typeDefaults(type) {
  return Object.fromEntries(EVENT_TYPES[type].fields.map((f) => [f.key, f.default]));
}

const splitList = (v) =>
  (Array.isArray(v) ? v : String(v ?? '').split(/[\n,]/))
    .map((s) => String(s).trim())
    .filter(Boolean);

// Returns { values, errors }. Unknown keys are dropped.
function parseTypeConfig(type, input = {}) {
  const values = {};
  const errors = {};
  for (const f of EVENT_TYPES[type].fields) {
    const raw = input[f.key];
    if (f.type === 'bool') {
      values[f.key] = raw === true || raw === 'on' || raw === 'true';
    } else if (f.type === 'int') {
      const s = String(raw ?? '').trim();
      const n = s === '' ? f.default : Number(s);
      if (!Number.isInteger(n) || n < f.min || n > f.max) errors[f.key] = `Enter a whole number from ${f.min} to ${f.max}.`;
      values[f.key] = Number.isInteger(n) ? n : s;
    } else if (f.type === 'string') {
      const s = String(raw ?? '').trim();
      if (s.length > f.maxLength) errors[f.key] = `At most ${f.maxLength} characters.`;
      values[f.key] = s;
    } else if (f.type === 'list') {
      const items = [...new Set(splitList(raw))];
      if (items.length > f.maxItems) errors[f.key] = `At most ${f.maxItems} entries.`;
      else if (items.some((i) => i.length > f.maxLength)) errors[f.key] = `Each entry must be at most ${f.maxLength} characters.`;
      else if (f.pattern && items.some((i) => !f.pattern.test(i))) errors[f.key] = f.patternHelp;
      values[f.key] = items;
    } else if (f.type === 'choices') {
      const items = [...new Set(splitList(raw))];
      if (items.some((i) => !f.choices[i])) errors[f.key] = 'Unknown option.';
      else if (!items.length) errors[f.key] = 'Choose at least one.';
      values[f.key] = items;
    }
  }
  return { values, errors };
}

// Stored configs are re-read through the current field list so new fields get defaults.
function readTypeConfig(type, json) {
  let stored = {};
  try {
    stored = JSON.parse(json || '{}');
  } catch {
    stored = {};
  }
  return { ...typeDefaults(type), ...Object.fromEntries(EVENT_TYPES[type].fields.filter((f) => f.key in stored).map((f) => [f.key, stored[f.key]])) };
}

module.exports = {
  takesEntries, EVENT_TYPES, typeDefaults, parseTypeConfig, readTypeConfig };

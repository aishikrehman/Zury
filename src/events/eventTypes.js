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
      { key: 'entryTemplate', label: 'Template for entries', type: 'string', maxLength: 255, default: '', help: 'E.g. {{উইকিপিডিয়া এশীয় মাস ২০২৬}}. Participants get a link to add it to each entry.' },
      { key: 'entryTemplateOnTalk', label: 'Put the template on the talk page (else on the article)', type: 'bool', default: true },
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
      { key: 'entryTemplate', label: 'Template for entries', type: 'string', maxLength: 255, default: '', help: 'E.g. {{উইকিপিডিয়া এশীয় মাস ২০২৬}}. Participants get a link to add it to each entry.' },
      { key: 'entryTemplateOnTalk', label: 'Put the template on the talk page (else on the article)', type: 'bool', default: true },
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

Object.assign(EVENT_TYPES, {
  proofread: {
    label: 'Proofread-a-thon',
    description: 'Proofread and validate pages of scanned books on Wikisource.',
    defaultWiki: null,
    // The Page: namespace on most Wikisources.
    defaultNamespaces: [104],
    entries: true,
    defaults: { juryReviewEnabled: false, massSubmissionEnabled: true, contributionDiscoveryEnabled: true },
    fields: [
      { key: 'indexPages', label: 'Books (Index pages)', type: 'list', maxItems: 100, maxLength: 255, default: [], help: 'One per line, e.g. "Index:Gitanjali.djvu". Leave empty to accept any book.' },
      { key: 'minQualityLevel', label: 'Lowest accepted level', type: 'int', min: 1, max: 4, default: 3, help: '3 = proofread, 4 = validated.' },
      { key: 'editedDuringEventOnly', label: 'Only pages last changed during the event', type: 'bool', default: true },
      { key: 'pointsProofread', label: 'Points per proofread page', type: 'int', min: 0, max: 100, default: 1 },
      { key: 'pointsValidated', label: 'Points per validated page', type: 'int', min: 0, max: 100, default: 1 },
    ],
  },
  glam: {
    label: 'GLAM partnership',
    description: 'Upload and describe a collection from a gallery, library, archive or museum.',
    defaultWiki: 'commonswiki',
    defaultNamespaces: [6],
    entries: true,
    defaults: { juryReviewEnabled: false, massSubmissionEnabled: true },
    fields: [
      { key: 'partnerInstitution', label: 'Partner institution', type: 'string', maxLength: 200, default: '' },
      { key: 'collectionName', label: 'Collection', type: 'string', maxLength: 200, default: '' },
      { key: 'requiredCategory', label: 'Batch category', type: 'string', maxLength: 255, default: '', help: 'Without the "Category:" prefix. Every file must be in it.' },
      { key: 'allowedLicenses', label: 'Accepted licences', type: 'choices', choices: { pd: 'Public domain', cc0: 'CC0', ccby: 'CC BY', ccbysa: 'CC BY-SA' }, default: ['pd', 'cc0', 'ccby', 'ccbysa'] },
      { key: 'uploadedDuringEventOnly', label: 'Only files uploaded during the event', type: 'bool', default: false },
    ],
  },
  digitization: {
    label: 'Scanning and digitization',
    description: 'Scan books and documents at a library or archive and upload them to Commons.',
    defaultWiki: 'commonswiki',
    defaultNamespaces: [6],
    activity: true,
    entries: true,
    defaults: { juryReviewEnabled: false, massSubmissionEnabled: true, registrationRequired: true },
    fields: [
      { key: 'holdingInstitution', label: 'Library or archive', type: 'string', maxLength: 200, default: '' },
      { key: 'targetPages', label: 'Target number of pages', type: 'int', min: 0, max: 10000000, default: 0, help: '0 means no target.' },
      { key: 'fileFormats', label: 'Accepted formats', type: 'choices', choices: { pdf: 'PDF', djvu: 'DjVu', tiff: 'TIFF', jpeg: 'JPEG' }, default: ['pdf', 'djvu'] },
      { key: 'requiredCategory', label: 'Upload category', type: 'string', maxLength: 255, default: '', help: 'Without the "Category:" prefix.' },
      { key: 'uploadedDuringEventOnly', label: 'Only files uploaded during the event', type: 'bool', default: true },
      CERTIFICATE,
    ],
  },
});

// A line for each wizard step, saying what that step means for this type of event.
const GUIDES = {
  photo: { rules: 'Set what a photo needs: resolution, the contest category and when it was uploaded.', judging: 'Reviewers rate photos, often in rounds; results list the winners per award.' },
  writing: { rules: 'Set what an article needs: size, words, and whether it must be new or may be expanded.', judging: 'Reviewers mark each article; points from marks make the leaderboard.' },
  data: { rules: 'Set which entities count and which properties or statements they need.', judging: 'Reviewers can approve or reject items; counts make the results.' },
  editathon: { rules: "Participants register; their edits during the event are counted automatically.", judging: 'Usually no reviewers: results come from tracked edits and bytes.' },
  proofread: { rules: 'Choose the books and the lowest proofreading level that counts. Pages are checked on Wikisource.', judging: 'No reviewers needed: proofread and validated pages earn points.' },
  glam: { rules: 'Name the partner and collection, the batch category and the licences you accept.', judging: 'Optionally curate uploads; reports show where the files are used.' },
  digitization: { rules: 'Set the formats and category for scans; plan scanning days in Sessions.', judging: 'Organizers check scan quality; progress counts pages against the target.' },
  workshop: { rules: 'Participants register for sessions; their edits can be tracked.', judging: 'Attendance earns a certificate.' },
  training: { rules: 'Participants register for the course sessions; their edits can be tracked.', judging: 'Attendance earns a certificate.' },
  photowalk: { rules: 'Set the meeting point and the category for uploads from the walk.', judging: 'Uploads are checked like a photo contest; no reviewers needed.' },
};
for (const [type, guide] of Object.entries(GUIDES)) EVENT_TYPES[type].guide = guide;

// Rules each type can be told to only warn about instead of blocking.
const WARN_ONLY = {
  photo: { resolution: 'Resolution', category: 'Category', uploadDate: 'Upload date' },
  photowalk: { resolution: 'Resolution', category: 'Category', uploadDate: 'Upload date' },
  writing: { size: 'Size', words: 'Word count', created: 'Created during the event', namespace: 'Namespace', eligible: 'Eligible list' },
  data: { properties: 'Required properties', statements: 'Number of statements' },
  proofread: { level: 'Proofreading level', book: 'Book', edited: 'Changed during the event' },
  glam: { category: 'Batch category', license: 'Licence', uploadDate: 'Upload date' },
  digitization: { format: 'File format', category: 'Category', uploadDate: 'Upload date' },
};
for (const [type, choices] of Object.entries(WARN_ONLY)) {
  EVENT_TYPES[type].fields.push({
    key: 'warnOnly',
    optional: true,
    label: 'Only warn about',
    type: 'choices',
    choices,
    default: [],
    help: 'Entries that break these rules are still accepted, with a warning for reviewers.',
  });
}

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
      else if (!items.length && !f.optional) errors[f.key] = 'Choose at least one.';
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

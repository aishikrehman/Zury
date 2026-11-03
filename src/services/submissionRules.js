const { EVENT_TYPES } = require('../events/eventTypes');

const ENTITY_NS = { item: 0, property: 120, lexeme: 146 };

function pageKeyFor(meta) {
  if (meta.wiki === 'wikidatawiki' && meta.entity) return `wikidata:${meta.entity.id}`;
  return `${meta.wiki}:${meta.pageId}`;
}

function eligibleNamespaces(contest, settings, typeConfig) {
  const custom = JSON.parse(settings.eligibleNamespaces || '[]');
  if (custom.length) return custom;
  if (contest.type === 'data') return (typeConfig.entityTypes || ['item']).map((t) => ENTITY_NS[t]);
  return EVENT_TYPES[contest.type].defaultNamespaces;
}

const within = (iso, start, end) => {
  if (!iso || !start || !end) return true;
  const t = new Date(iso);
  return t >= start && t <= end;
};

/**
 * Checks one entry's metadata against an event's rules. Pure.
 * hard: problems that always block saving.
 * rules: event-rule problems; block when automatic validation is on.
 * warnings: worth a reviewer's attention but never block.
 */
function checkEntry({ meta, contest, settings, typeConfig, existingKeys = new Set(), entriesByParticipant = 0, allowedWikis }) {
  const hard = [];
  const rules = [];
  const warnings = [];
  // Rules organizers chose to only warn about (Fountain-style) go to warnings instead.
  const warnOnly = new Set(typeConfig.warnOnly || []);
  const rule = (key, message) => (warnOnly.has(key) ? warnings : rules).push(message);

  if (!meta.exists) {
    hard.push('This page does not exist.');
    return { hard, rules, warnings };
  }
  if (existingKeys.has(pageKeyFor(meta))) hard.push('Already submitted to this event.');
  const limit = typeConfig.maxEntriesPerParticipant;
  if (limit > 0 && entriesByParticipant >= limit) hard.push(`Limit of ${limit} entries per participant reached.`);

  const wikis = allowedWikis || [contest.primaryWiki, ...JSON.parse(contest.additionalWikis || '[]')];
  if (!wikis.includes(meta.wiki)) rules.push(`Entries must come from ${wikis.join(' or ')}.`);
  const namespaces = eligibleNamespaces(contest, settings, typeConfig);
  if (!namespaces.includes(meta.ns)) rules.push(`Pages in namespace ${meta.ns} are not eligible (allowed: ${namespaces.join(', ')}).`);

  if (contest.type === 'photo' || contest.type === 'photowalk') {
    if (meta.entryType !== 'file') rules.push('Only files are accepted.');
    if (meta.file) {
      if (typeConfig.minResolutionMegapixels > 0 && (meta.file.megapixels ?? 0) < typeConfig.minResolutionMegapixels) {
        rule('resolution', `Resolution ${meta.file.megapixels ?? '?'} MP is below the ${typeConfig.minResolutionMegapixels} MP minimum.`);
      }
      if (meta.file.mime && !meta.file.mime.startsWith('image/')) rules.push('Only image files are accepted.');
    }
    const required = (typeConfig.requiredCategory || '').replace(/_/g, ' ').trim();
    if (required && !meta.categories.some((c) => c.replace(/_/g, ' ') === required)) rule('category', `Missing the required category “${required}”.`);
    if (typeConfig.uploadedDuringEventOnly && !within(meta.createdAt, contest.startDate, contest.endDate)) {
      rule('uploadDate', 'The file was not uploaded during the event.');
    }
  }

  if (contest.type === 'writing') {
    if (typeConfig.minBytes > 0 && (meta.sizeBytes ?? 0) < typeConfig.minBytes) rule('size', `Article is ${meta.sizeBytes} bytes; at least ${typeConfig.minBytes} needed.`);
    if (typeConfig.minWordCount > 0) {
      if (meta.wordCount == null) warnings.push("Word count couldn't be measured on this wiki; check it manually.");
      else if (meta.wordCount < typeConfig.minWordCount) rule('words', `Article has ${meta.wordCount} words; at least ${typeConfig.minWordCount} needed.`);
    }
    if (typeConfig.createdDuringEventOnly && !within(meta.createdAt, contest.startDate, contest.endDate)) {
      if (typeConfig.allowExpansions) warnings.push('Article was created before the event; check that it was substantially expanded.');
      else rule('created', 'The article was not created during the event.');
    }
  }

  if (contest.type === 'proofread') {
    const pr = meta.proofread;
    if (!pr) rules.push('Not a Wikisource page with a proofreading level.');
    else {
      const LEVELS = { 0: 'without text', 1: 'not proofread', 2: 'problematic', 3: 'proofread', 4: 'validated' };
      if (pr.level < typeConfig.minQualityLevel) rule('level', `The page is ${LEVELS[pr.level] || 'at level ' + pr.level}; at least ${LEVELS[typeConfig.minQualityLevel]} is needed.`);
      const books = (typeConfig.indexPages || []).map((b) => b.replace(/_/g, ' ').replace(/^(Index:)?/i, 'Index:'));
      if (books.length && !books.includes((pr.index || '').replace(/_/g, ' '))) rule('book', 'This page is not from one of the event\'s books.');
      if (typeConfig.editedDuringEventOnly && !within(pr.lastEditedAt, contest.startDate, contest.endDate)) rule('edited', 'The page was not changed during the event.');
    }
  }

  if (contest.type === 'glam') {
    if (meta.entryType !== 'file') rules.push('Only files are accepted.');
    const required = (typeConfig.requiredCategory || '').replace(/_/g, ' ').trim();
    if (required && !meta.categories.some((c) => c.replace(/_/g, ' ') === required)) rule('category', `Missing the batch category “${required}”.`);
    const license = meta.file?.license || '';
    const LICENSES = { pd: /public domain|^pd/i, cc0: /cc0/i, ccbysa: /cc[- ]by[- ]sa/i, ccby: /cc[- ]by(?![- ]sa)/i };
    const allowed = typeConfig.allowedLicenses || [];
    if (!license) warnings.push("The licence couldn't be read; check it manually.");
    else if (allowed.length && !allowed.some((k) => LICENSES[k]?.test(license))) rule('license', `The licence ${license} is not accepted.`);
    if (typeConfig.uploadedDuringEventOnly && !within(meta.createdAt, contest.startDate, contest.endDate)) rule('uploadDate', 'The file was not uploaded during the event.');
  }

  if (contest.type === 'digitization') {
    if (meta.entryType !== 'file') rules.push('Only files are accepted.');
    const MIME = { pdf: 'application/pdf', djvu: 'image/vnd.djvu', tiff: 'image/tiff', jpeg: 'image/jpeg' };
    const formats = typeConfig.fileFormats || [];
    if (meta.file?.mime && formats.length && !formats.some((f) => MIME[f] === meta.file.mime)) {
      rule('format', `${meta.file.mime} files are not accepted (accepted: ${formats.map((f) => f.toUpperCase()).join(', ')}).`);
    }
    const required = (typeConfig.requiredCategory || '').replace(/_/g, ' ').trim();
    if (required && !meta.categories.some((c) => c.replace(/_/g, ' ') === required)) rule('category', `Missing the category “${required}”.`);
    if (typeConfig.uploadedDuringEventOnly && !within(meta.createdAt, contest.startDate, contest.endDate)) rule('uploadDate', 'The file was not uploaded during the event.');
  }

  if (contest.type === 'data') {
    if (!meta.entity) rules.push('Not a Wikidata entity.');
    else {
      if (!(typeConfig.entityTypes || []).includes(meta.entity.type)) rules.push(`${meta.entity.type} entities are not accepted.`);
      const missing = (typeConfig.requiredProperties || []).filter((p) => !meta.entity.properties.includes(p));
      if (missing.length) rule('properties', `Missing required properties: ${missing.join(', ')}.`);
      if (typeConfig.minStatements > 0 && meta.entity.statementCount < typeConfig.minStatements) {
        rule('statements', `Has ${meta.entity.statementCount} statements; at least ${typeConfig.minStatements} needed.`);
      }
    }
  }

  return { hard, rules, warnings };
}

// Whether submissions are accepted right now (organizers may submit late).
function submissionWindow(contest, now = new Date()) {
  const opens = contest.submissionOpensAt || contest.startDate;
  const closes = contest.submissionDeadline || contest.endDate;
  if (contest.status !== 'active') return { open: false, reason: 'This event is not accepting submissions.' };
  if (opens && now < opens) return { open: false, reason: 'Submissions have not opened yet.' };
  if (closes && now > closes) return { open: false, reason: 'The submission deadline has passed.' };
  return { open: true };
}

module.exports = { checkEntry, pageKeyFor, eligibleNamespaces, submissionWindow };

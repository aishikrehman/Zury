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

  if (contest.type === 'photo') {
    if (meta.entryType !== 'file') rules.push('Photo contests accept files only.');
    if (meta.file) {
      if (typeConfig.minResolutionMegapixels > 0 && (meta.file.megapixels ?? 0) < typeConfig.minResolutionMegapixels) {
        rules.push(`Resolution ${meta.file.megapixels ?? '?'} MP is below the ${typeConfig.minResolutionMegapixels} MP minimum.`);
      }
      if (meta.file.mime && !meta.file.mime.startsWith('image/')) rules.push('Only image files are accepted.');
    }
    const required = (typeConfig.requiredCategory || '').replace(/_/g, ' ').trim();
    if (required && !meta.categories.some((c) => c.replace(/_/g, ' ') === required)) rules.push(`Missing the required category “${required}”.`);
    if (typeConfig.uploadedDuringEventOnly && !within(meta.createdAt, contest.startDate, contest.endDate)) {
      rules.push('The file was not uploaded during the event.');
    }
  }

  if (contest.type === 'writing') {
    if (typeConfig.minBytes > 0 && (meta.sizeBytes ?? 0) < typeConfig.minBytes) rules.push(`Article is ${meta.sizeBytes} bytes; at least ${typeConfig.minBytes} needed.`);
    if (typeConfig.minWordCount > 0) {
      if (meta.wordCount == null) warnings.push("Word count couldn't be measured on this wiki; check it manually.");
      else if (meta.wordCount < typeConfig.minWordCount) rules.push(`Article has ${meta.wordCount} words; at least ${typeConfig.minWordCount} needed.`);
    }
    if (typeConfig.createdDuringEventOnly && !within(meta.createdAt, contest.startDate, contest.endDate)) {
      if (typeConfig.allowExpansions) warnings.push('Article was created before the event; check that it was substantially expanded.');
      else rules.push('The article was not created during the event.');
    }
  }

  if (contest.type === 'data') {
    if (!meta.entity) rules.push('Not a Wikidata entity.');
    else {
      if (!(typeConfig.entityTypes || []).includes(meta.entity.type)) rules.push(`${meta.entity.type} entities are not accepted.`);
      const missing = (typeConfig.requiredProperties || []).filter((p) => !meta.entity.properties.includes(p));
      if (missing.length) rules.push(`Missing required properties: ${missing.join(', ')}.`);
      if (typeConfig.minStatements > 0 && meta.entity.statementCount < typeConfig.minStatements) {
        rules.push(`Has ${meta.entity.statementCount} statements; at least ${typeConfig.minStatements} needed.`);
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

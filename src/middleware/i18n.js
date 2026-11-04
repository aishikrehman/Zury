// Sets the interface language for each request and gives views translated
// text, labels, dates and numbers.
const { LANGUAGES, translator, languageFor } = require('../i18n');
const contestLabels = require('../utils/contestLabels');
const { EVENT_TYPES } = require('../events/eventTypes');
const { PLATFORM_ROLES, EVENT_ROLES, PERMISSIONS } = require('../permissions/registry');
const { FEATURE_FIELDS, DATE_FIELDS, PARTICIPATION_MODES } = require('../services/contestFormService');
const { clientDictionary } = require('../i18n/client');

const clientCache = {};

const mapValues = (obj, fn) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, fn(v, k)]));

// The fixed label tables, translated once per language.
const tables = {};
function labelTables(code) {
  if (tables[code]) return tables[code];
  const t = translator(code);
  const withLabel = (o) => ({ ...o, ...(o.label && { label: t(o.label) }), ...(o.plural && { plural: t(o.plural) }), ...(o.description && { description: t(o.description) }) });
  tables[code] = {
    CONTEST_TYPES: mapValues(contestLabels.CONTEST_TYPES, t),
    CONTEST_STATUSES: mapValues(contestLabels.CONTEST_STATUSES, withLabel),
    SUBMISSION_STATUSES: mapValues(contestLabels.SUBMISSION_STATUSES, withLabel),
    PROJECT_CATEGORIES: mapValues(contestLabels.PROJECT_CATEGORIES, t),
    PARTICIPATION_MODES: mapValues(PARTICIPATION_MODES, t),
    FEATURE_FIELDS: FEATURE_FIELDS.map(([k, label, help]) => [k, t(label), t(help)]),
    DATE_FIELDS: DATE_FIELDS.map(([k, label]) => [k, t(label)]),
    EVENT_ROLES: mapValues(EVENT_ROLES, withLabel),
    PLATFORM_ROLES: mapValues(PLATFORM_ROLES, withLabel),
    PERMISSION_LABELS: mapValues(PERMISSIONS, t),
    EVENT_TYPES: mapValues(EVENT_TYPES, (type) => ({
      ...type,
      label: t(type.label),
      description: t(type.description),
      guide: type.guide && mapValues(type.guide, t),
      fields: type.fields.map((f) => ({
        ...f,
        label: t(f.label),
        ...(f.help && { help: t(f.help) }),
        ...(f.choices && { choices: mapValues(f.choices, t) }),
      })),
    })),
  };
  return tables[code];
}

const escapeHtml = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * th('Type {code} to confirm', { code: '<code>x</code>' }) for sentences that hold
 * markup: the sentence is translated and escaped, then the pieces go in where
 * the language puts them. Pieces are HTML; escape any text in them first (h()).
 */
const htmlTranslator = (t) => (text, pieces = {}) =>
  escapeHtml(t(text)).replace(/\{(\w+)\}/g, (m, key) => (key in pieces ? String(pieces[key]) : m));

// Controllers sometimes pass a label table (or one event type) to a view directly;
// those are swapped for the translated version so every page gets one language.
function translatedFor(code) {
  const local = labelTables(code);
  const map = new Map([
    [EVENT_TYPES, local.EVENT_TYPES],
    [FEATURE_FIELDS, local.FEATURE_FIELDS],
    [DATE_FIELDS, local.DATE_FIELDS],
    [PARTICIPATION_MODES, local.PARTICIPATION_MODES],
    [PERMISSIONS, local.PERMISSION_LABELS],
    [EVENT_ROLES, local.EVENT_ROLES],
    [PLATFORM_ROLES, local.PLATFORM_ROLES],
  ]);
  for (const key of Object.keys(EVENT_TYPES)) map.set(EVENT_TYPES[key], local.EVENT_TYPES[key]);
  return map;
}
const swaps = {};

function i18n(req, res, next) {
  const code = languageFor(req);
  const lang = LANGUAGES[code];
  const t = translator(code);
  const dateFormat = (options) => (date, timeZone = 'UTC') => {
    if (!date) return '';
    try {
      return new Intl.DateTimeFormat(lang.locale, { ...options, timeZone }).format(new Date(date));
    } catch {
      return new Date(date).toISOString().slice(0, 16).replace('T', ' ');
    }
  };
  const numbers = new Intl.NumberFormat(lang.locale);
  req.lang = code;
  const swap = (swaps[code] ||= translatedFor(code));
  const render = res.render.bind(res);
  res.render = (view, options, callback) => {
    if (options && typeof options === 'object') {
      for (const [k, v] of Object.entries(options)) if (swap.has(v)) options[k] = swap.get(v);
    }
    return render(view, options, callback);
  };
  req.t = t;
  Object.assign(res.locals, labelTables(code), {
    t,
    th: htmlTranslator(t),
    // tn('{n} event', '{n} events', 3): English needs both; Bangla uses one form for both.
    tn: (one, other, n, values = {}) => t(n === 1 ? one : other, { n, ...values }),
    h: escapeHtml,
    lang,
    LANGUAGES,
    formatDate: dateFormat({ dateStyle: 'medium' }),
    formatDateTime: dateFormat({ dateStyle: 'medium', timeStyle: 'short' }),
    formatNumber: (n) => numbers.format(Number(n) || 0),
    clientStrings: (clientCache[code] ||= clientDictionary(t)),
  });
  next();
}

module.exports = { i18n, labelTables };

// Interface languages. Text is written in English in the code and views; each
// other language has a dictionary from that English text to its own
// (src/i18n/<code>.json). Anything missing shows in English.
const fs = require('fs');
const path = require('path');

const LANGUAGES = {
  en: { code: 'en', name: 'English', native: 'English', locale: 'en-GB', dir: 'ltr' },
  bn: { code: 'bn', name: 'Bangla', native: 'বাংলা', locale: 'bn-BD', dir: 'ltr' },
};
const DEFAULT_LANGUAGE = 'en';

const dictionaries = {};
function dictionary(code) {
  if (!dictionaries[code]) {
    const file = path.join(__dirname, `${code}.json`);
    dictionaries[code] = code !== 'en' && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  }
  return dictionaries[code];
}

/**
 * t('Step {n} of {total}', { n: 2, total: 5 }) → "ধাপ ২ / ৫" in Bangla.
 * Numbers in the values are written in the language's digits.
 */
// English messages with figures, and the dictionary key that translates each.
const PATTERN_KEYS = [
  "Article has {a} words; at least {b} needed.",
  "Article is {a} bytes; at least {b} needed.",
  "Entries must come from {a}.",
  "Has {a} statements; at least {b} needed.",
  "Limit of {a} entries per participant reached.",
  "Missing required properties: {a}.",
  "Missing the category “{a}”.",
  "Pages in namespace {a} are not eligible (allowed: {b}).",
  "Resolution {a} MP is below the {b} MP minimum.",
  "The licence {a} is not accepted.",
  "The page is {a}; at least {b} is needed.",
  "{a} entities are not accepted.",
  "{a} files are not accepted (accepted: {b}).",
  "{a} is not part of this event.",
  "Could not check this entry: {a}",
  "{a} is blocked from this event.",
  "No Wikimedia user named “{a}” was found.",
  "{a} is not a participant in this event. Add them first.",
  "Missing the required category “{a}”.",
  "Missing the batch category “{a}”."
];
const escapeRe = (s) => s.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
const PATTERNS = PATTERN_KEYS.map((key) => [new RegExp('^' + key.split(/\{[a-d]\}/).map(escapeRe).join('(.+?)') + '$'), key]);

function translator(code) {
  const lang = LANGUAGES[code] || LANGUAGES[DEFAULT_LANGUAGE];
  const dict = dictionary(lang.code);
  const number = new Intl.NumberFormat(lang.locale);
  return (text, values) => {
    if (text == null) return '';
    const source = String(text);
    let out = Object.prototype.hasOwnProperty.call(dict, source) ? dict[source] : null;
    // Messages built with figures in them ("Article has 223 words; …"): matched to a pattern with {a}, {b}.
    if (out == null) {
      out = source;
      for (const [re, key] of PATTERNS) {
        const m = source.match(re);
        if (m && Object.prototype.hasOwnProperty.call(dict, key)) {
          const vals = m.slice(1);
          out = dict[key].replace(/\{([a-d])\}/g, (x, k) => { const v = vals['abcd'.indexOf(k)] ?? ''; return /^\d+$/.test(v) ? number.format(Number(v)) : v; });
          break;
        }
      }
    }
    if (values) {
      out = out.replace(/\{(\w+)\}/g, (m, key) => {
        if (!(key in values)) return m;
        const v = values[key];
        return typeof v === 'number' ? number.format(v) : String(v);
      });
    }
    return out;
  };
}

// The first supported language in an Accept-Language header.
function fromAcceptLanguage(header) {
  for (const part of String(header || '').split(',')) {
    const code = part.trim().split(';')[0].toLowerCase().split('-')[0];
    if (LANGUAGES[code]) return code;
  }
  return null;
}

// The person's choice when logged in or saved in the session, else the browser's.
function languageFor(req) {
  const chosen = req.user?.preferredLanguage || req.session?.lang;
  if (LANGUAGES[chosen]) return chosen;
  return fromAcceptLanguage(req.headers['accept-language']) || DEFAULT_LANGUAGE;
}

module.exports = { LANGUAGES, DEFAULT_LANGUAGE, translator, languageFor, fromAcceptLanguage, dictionary };

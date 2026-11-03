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
function translator(code) {
  const lang = LANGUAGES[code] || LANGUAGES[DEFAULT_LANGUAGE];
  const dict = dictionary(lang.code);
  const number = new Intl.NumberFormat(lang.locale);
  return (text, values) => {
    if (text == null) return '';
    const source = String(text);
    let out = Object.prototype.hasOwnProperty.call(dict, source) ? dict[source] : source;
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

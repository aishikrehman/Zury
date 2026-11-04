// Text shown by the browser scripts (public/js). The layout sends these,
// translated, to the page; scripts read them with zt().
const CLIENT_STRINGS = [
  'Step {n} of {total}',
  'Edit',
  'Nothing set.',
  'Yes',
  'No',
  'No matches',
  'Use “{text}”',
  'latest: {edition}',
  'Language',
  'Wiki',
  'Choose a language or Commons, Wikidata…',
  'Multilingual wikis',
  'Languages',
  'Then choose the wiki…',
  'Default: {list}',
  'Part of a series: the address is the series and the edition.',
  'Made from the title; you can change it.',
  'Mark, e.g. Accepted',
  'Values with points, e.g. Yes = 1, No = 0',
  'Remove mark',
  'Accepted',
  'Quality',
  'Search Wikimedia users…',
  '{n} selected',
];

// { English: translation } for one language, safe to put inside a <script> element.
function clientDictionary(t) {
  const out = Object.fromEntries(CLIENT_STRINGS.map((s) => [s, t(s)]));
  return JSON.stringify(out).replace(/</g, '\\u003c');
}

module.exports = { CLIENT_STRINGS, clientDictionary };

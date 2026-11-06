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
  'Made from the title; you can change it.',
  'An event of this edition: name it, e.g. by its type.',
  'An event directly under the series.',
  'Mark, e.g. Accepted',
  'Values with points, e.g. Yes = 1, No = 0',
  'Remove mark',
  'Accepted',
  'Quality',
  'Search Wikimedia users…',
  '{n} selected',
  'Loading…',
  'No notifications yet',
  'Free: {path}',
  'Taken.',
  'This edition already has an event for this wiki.',
  'In an edition the address ends with the wiki’s code.',
  'That series name is taken.',
  'Use lowercase letters, numbers and hyphens.',
  'Use {name}',
  'Full screen',
  'Leave full screen',
  'The edition’s event: its address is the edition’s.',
  'has its event',
  'Locked by the series or edition',
];

// { English: translation } for one language, safe to put inside a <script> element.
function clientDictionary(t) {
  const out = Object.fromEntries(CLIENT_STRINGS.map((s) => [s, t(s)]));
  return JSON.stringify(out).replace(/</g, '\\u003c');
}

module.exports = { CLIENT_STRINGS, clientDictionary };

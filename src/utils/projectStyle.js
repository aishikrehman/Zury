// A colour and icon per Wikimedia project, so events are easy to tell apart at a glance:
// event cards, the event header and the calendar use them.
const PROJECTS = {
  wikipedia: { label: 'Wikipedia', icon: 'brand-wikipedia', color: '#3366cc' },
  commons: { label: 'Commons', icon: 'photo', color: '#2e9c5f' },
  wikidata: { label: 'Wikidata', icon: 'database', color: '#990000' },
  wikisource: { label: 'Wikisource', icon: 'books', color: '#6b4ba1' },
  wiktionary: { label: 'Wiktionary', icon: 'vocabulary', color: '#b36b00' },
  wikibooks: { label: 'Wikibooks', icon: 'book', color: '#8a5a2b' },
  wikiquote: { label: 'Wikiquote', icon: 'quote', color: '#0a7f8f' },
  wikivoyage: { label: 'Wikivoyage', icon: 'map', color: '#0f8a6e' },
  wikinews: { label: 'Wikinews', icon: 'news', color: '#c2185b' },
  wikiversity: { label: 'Wikiversity', icon: 'school', color: '#1a6fa3' },
  wikimedia: { label: 'Wikimedia', icon: 'world', color: '#5b6b7f' },
};

// The project's own logo (from Commons), drawn faintly behind its events.
const LOGOS = {"wikipedia":"Wikipedia-logo-v2.svg","commons":"Commons-logo.svg","wikidata":"Wikidata-logo.svg","wikisource":"Wikisource-logo.svg","wiktionary":"Wiktionary-logo-v2.svg","wikibooks":"Wikibooks-logo.svg","wikiquote":"Wikiquote-logo.svg","wikivoyage":"Wikivoyage-Logo-v3-icon.svg","wikinews":"Wikinews-logo.svg","wikiversity":"Wikiversity logo 2017.svg","wikimedia":"Wikimedia-logo.svg"};

function projectKey(dbname = '') {
  if (dbname === 'commonswiki') return 'commons';
  if (dbname === 'wikidatawiki') return 'wikidata';
  for (const key of ['wikisource', 'wiktionary', 'wikibooks', 'wikiquote', 'wikivoyage', 'wikinews', 'wikiversity']) if (dbname.endsWith(key)) return key;
  if (/^(meta|species|mediawiki|incubator|outreach|foundation|wikifunctions|sources)wiki$/.test(dbname)) return 'wikimedia';
  return dbname.endsWith('wiki') ? 'wikipedia' : 'wikimedia';
}

// An event's project: the one all its wikis share, or Wikimedia when they differ.
function eventProject(c) {
  const dbs = c.wikis && c.wikis.length ? c.wikis.map((w) => w.wiki) : [c.primaryWiki];
  const keys = [...new Set(dbs.filter(Boolean).map(projectKey))];
  const key = keys.length === 1 ? keys[0] : 'wikimedia';
  return { key, ...PROJECTS[key], logo: `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(LOGOS[key])}?width=400` };
}

module.exports = { PROJECTS, projectKey, eventProject };

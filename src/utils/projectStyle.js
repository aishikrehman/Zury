// A colour and icon per Wikimedia project, so events are easy to tell apart at a glance:
// event cards, the event header and the calendar use them.
const PROJECTS = {
  wikipedia: { label: 'Wikipedia', icon: 'brand-wikipedia', color: '#3366cc' },
  commons: { label: 'Commons', icon: 'photo', color: '#339966' },
  wikidata: { label: 'Wikidata', icon: 'database', color: '#990000' },
  wikisource: { label: 'Wikisource', icon: 'books', color: '#2a4b8d' },
  wiktionary: { label: 'Wiktionary', icon: 'vocabulary', color: '#ac6600' },
  wikibooks: { label: 'Wikibooks', icon: 'book', color: '#ac6600' },
  wikiquote: { label: 'Wikiquote', icon: 'quote', color: '#006699' },
  wikivoyage: { label: 'Wikivoyage', icon: 'map', color: '#339966' },
  wikinews: { label: 'Wikinews', icon: 'news', color: '#990000' },
  wikiversity: { label: 'Wikiversity', icon: 'school', color: '#006699' },
  wikimedia: { label: 'Wikimedia', icon: 'world', color: '#54595d' },
};

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
  return { key, ...PROJECTS[key] };
}

module.exports = { PROJECTS, projectKey, eventProject };

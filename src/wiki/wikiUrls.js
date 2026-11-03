// Maps between Wikimedia URLs, hostnames and wiki database names, and turns
// user input (a URL, a title, or a Wikidata ID) into { wiki, title }.

const FAMILIES = {
  wikipedia: 'wiki',
  wiktionary: 'wiktionary',
  wikibooks: 'wikibooks',
  wikinews: 'wikinews',
  wikiquote: 'wikiquote',
  wikisource: 'wikisource',
  wikiversity: 'wikiversity',
  wikivoyage: 'wikivoyage',
};
const SPECIAL_HOSTS = {
  'commons.wikimedia.org': 'commonswiki',
  'meta.wikimedia.org': 'metawiki',
  'species.wikimedia.org': 'specieswiki',
  'www.wikidata.org': 'wikidatawiki',
  'wikidata.org': 'wikidatawiki',
  'www.mediawiki.org': 'mediawikiwiki',
};
const SPECIAL_DBNAMES = Object.fromEntries(
  Object.entries(SPECIAL_HOSTS).filter(([h]) => h !== 'wikidata.org').map(([h, db]) => [db, h]),
);

function hostToDbname(host) {
  const h = host.toLowerCase().replace(/\.m\./, '.');
  if (SPECIAL_HOSTS[h]) return SPECIAL_HOSTS[h];
  const m = /^([a-z0-9-]+)\.(wikipedia|wiktionary|wikibooks|wikinews|wikiquote|wikisource|wikiversity|wikivoyage)\.org$/.exec(h);
  if (!m || m[1] === 'www') return null;
  return m[1].replace(/-/g, '_') + FAMILIES[m[2]];
}

function dbnameToHost(dbname) {
  if (SPECIAL_DBNAMES[dbname]) return SPECIAL_DBNAMES[dbname];
  for (const [family, suffix] of Object.entries(FAMILIES).sort((a, b) => b[1].length - a[1].length)) {
    if (dbname.endsWith(suffix) && dbname.length > suffix.length) {
      return `${dbname.slice(0, -suffix.length).replace(/_/g, '-')}.${family}.org`;
    }
  }
  return null;
}

const normalizeTitle = (t) => {
  const s = t.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
};

function pageUrl(wiki, title) {
  const host = dbnameToHost(wiki);
  return host ? `https://${host}/wiki/${encodeURIComponent(title.replace(/ /g, '_')).replace(/%3A/g, ':').replace(/%2F/g, '/')}` : null;
}

const ENTITY_ID = /^(?:(?:Property|Lexeme):)?([QPL][1-9]\d*)$/i;

// Wikidata entity IDs live at Q42, Property:P31 and Lexeme:L1.
function entityTitle(id) {
  const up = id.toUpperCase();
  if (up.startsWith('P')) return `Property:${up}`;
  if (up.startsWith('L')) return `Lexeme:${up}`;
  return up;
}

/**
 * Returns { wiki, title } or { error }. Plain titles belong to defaultWiki.
 * Only Wikimedia hosts are accepted; anything else is rejected.
 */
function parseEntry(input, defaultWiki) {
  const raw = String(input || '').trim();
  if (!raw) return { error: 'Empty line.' };
  if (raw.length > 1000) return { error: 'Too long.' };

  if (/^https?:\/\//i.test(raw)) {
    let url;
    try {
      url = new URL(raw);
    } catch {
      return { error: 'Not a valid URL.' };
    }
    const wiki = hostToDbname(url.hostname);
    if (!wiki) return { error: 'Not a Wikimedia wiki URL.' };
    let title = url.searchParams.get('title');
    if (!title && url.pathname.startsWith('/wiki/')) {
      try {
        title = decodeURIComponent(url.pathname.slice(6));
      } catch {
        return { error: 'The URL is not encoded correctly.' };
      }
    }
    const curid = url.searchParams.get('curid');
    if (!title && curid && /^\d+$/.test(curid)) return { wiki, pageId: Number(curid) };
    if (!title) return { error: 'Could not find a page title in this URL.' };
    const entity = wiki === 'wikidatawiki' && ENTITY_ID.exec(title);
    return { wiki, title: entity ? entityTitle(entity[1]) : normalizeTitle(title) };
  }

  const entity = ENTITY_ID.exec(raw);
  if (entity && (defaultWiki === 'wikidatawiki' || /^[QL]/i.test(entity[1]))) {
    return { wiki: 'wikidatawiki', title: entityTitle(entity[1]) };
  }
  if (!defaultWiki) return { error: 'Use a full URL.' };
  if (/[#<>[\]|{}]/.test(raw)) return { error: 'Titles cannot contain # < > [ ] | { }.' };
  return { wiki: defaultWiki, title: normalizeTitle(raw) };
}

module.exports = { hostToDbname, dbnameToHost, parseEntry, pageUrl, normalizeTitle };

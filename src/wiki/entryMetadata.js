const wikiApi = require('./wikiApi');
const { pageUrl } = require('./wikiUrls');

const WIKIDATA_NS = { 0: 'item', 120: 'property', 146: 'lexeme' };
const isWikipedia = (wiki) => /^[a-z_]+wiki$/.test(wiki) && !['commonswiki', 'wikidatawiki', 'metawiki', 'specieswiki', 'mediawikiwiki'].includes(wiki);

function entryTypeFor(wiki, ns) {
  if (wiki === 'wikidatawiki') return WIKIDATA_NS[ns] || 'page';
  if (ns === 6) return 'file';
  if (ns === 0) return 'article';
  return 'page';
}

const safeThumb = (u) => {
  try {
    return new URL(u).hostname === 'upload.wikimedia.org' ? u : null;
  } catch {
    return null;
  }
};

function countWords(text) {
  return (text || '').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

async function fetchEntity(id, language) {
  const data = await wikiApi.get('wikidatawiki', {
    action: 'wbgetentities',
    ids: id,
    props: 'info|labels|descriptions|claims',
    languages: [...new Set([language, 'en'].filter(Boolean))].join('|'),
    languagefallback: '1',
  });
  const e = data.entities?.[id];
  if (!e || 'missing' in e) return null;
  const pick = (map) => (map && (map[language] || map.en || Object.values(map)[0]))?.value || null;
  const claims = e.claims || {};
  return {
    id: e.id,
    type: e.type,
    label: pick(e.labels) || pick(e.lemmas),
    description: pick(e.descriptions),
    properties: Object.keys(claims),
    statementCount: Object.values(claims).reduce((n, list) => n + list.length, 0),
  };
}

/**
 * Looks up one entry. `ref` is { wiki, title } or { wiki, pageId }.
 * Returns normalized metadata with exists=false for missing pages.
 */
async function fetchEntryMetadata(ref, { language = 'en' } = {}) {
  const { wiki } = ref;
  const props = ['info', 'revisions', 'categories', 'imageinfo'];
  if (isWikipedia(wiki)) props.push('extracts');
  const wikisource = wiki.endsWith('wikisource');
  if (wikisource) props.push('proofread');
  const data = await wikiApi.get(wiki, {
    action: 'query',
    prop: props.join('|'),
    redirects: '1',
    ...(ref.pageId ? { pageids: String(ref.pageId) } : { titles: ref.title }),
    rvdir: 'newer',
    rvlimit: '1',
    rvprop: 'timestamp|user',
    cllimit: 'max',
    iiprop: 'size|mime|url|timestamp|user|extmetadata',
    // Commons only serves standard thumbnail widths.
    iiurlwidth: '500',
    iiextmetadatafilter: 'LicenseShortName',
    ...(isWikipedia(wiki) && { explaintext: '1', exlimit: '1' }),
  });
  const page = data.query?.pages?.[0];
  if (!page || page.missing || page.invalid) {
    return { exists: false, wiki, title: page?.title || ref.title || null };
  }

  const firstRev = page.revisions?.[0];
  const info = page.imageinfo?.[0];
  const meta = {
    exists: true,
    wiki,
    pageId: page.pageid,
    ns: page.ns,
    title: page.title,
    url: pageUrl(wiki, page.title),
    entryType: entryTypeFor(wiki, page.ns),
    createdAt: firstRev?.timestamp || null,
    creator: firstRev?.user || null,
    sizeBytes: page.length ?? null,
    wordCount: page.extract != null ? countWords(page.extract) : null,
    categories: (page.categories || []).map((c) => c.title.replace(/^[^:]+:/, '')),
  };
  if (info) {
    meta.file = {
      width: info.width,
      height: info.height,
      megapixels: info.width && info.height ? Math.round((info.width * info.height) / 1e5) / 10 : null,
      mime: info.mime,
      thumbUrl: safeThumb(info.thumburl),
      license: info.extmetadata?.LicenseShortName?.value || null,
    };
  }
  if (wikisource && page.proofread) {
    // Who last changed the page, and when: that change set its current level.
    const latest = await wikiApi.get(wiki, { action: 'query', prop: 'revisions', pageids: String(page.pageid), rvlimit: '1', rvprop: 'timestamp|user' });
    const rev = latest.query?.pages?.[0]?.revisions?.[0];
    meta.proofread = {
      level: Number(page.proofread.quality),
      label: page.proofread.quality_text || null,
      index: page.title.includes('/') ? `Index:${page.title.replace(/^[^:]+:/, '').replace(/\/[^/]*$/, '')}` : null,
      lastEditor: rev?.user || null,
      lastEditedAt: rev?.timestamp || null,
    };
  }
  if (wiki === 'wikidatawiki' && WIKIDATA_NS[page.ns]) {
    meta.entity = await fetchEntity(page.title.replace(/^(Property|Lexeme):/, ''), language);
  }
  return meta;
}

module.exports = { fetchEntryMetadata, countWords, entryTypeFor };

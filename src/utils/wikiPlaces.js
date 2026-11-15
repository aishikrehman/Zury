// Where a wiki's language is mostly spoken, roughly (latitude, longitude), to put it on the home
// page's map. Wikis for every language (Commons, Wikidata, Meta) have no place.
const PLACES = {
  bn: [23.7, 90.4], en: [51.5, -0.1], hi: [28.6, 77.2], ur: [30.4, 69.3], sd: [25.4, 68.4], pa: [31.1, 75.3], pnb: [31.5, 74.3],
  as: [26.2, 92.9], or: [20.9, 85.1], ta: [11.1, 78.7], te: [17.4, 78.5], ml: [10.5, 76.2], kn: [12.9, 77.6], mr: [19.1, 73], gu: [22.3, 71.2],
  ne: [27.7, 85.3], si: [7.3, 80.7], sat: [23.6, 86.9], mni: [24.8, 93.9], ar: [24.7, 46.7], fa: [35.7, 51.4], ps: [34.5, 69.2], tr: [39.9, 32.9],
  ru: [55.8, 37.6], uk: [50.4, 30.5], de: [52.5, 13.4], fr: [48.9, 2.4], es: [40.4, -3.7], pt: [-15.8, -47.9], it: [41.9, 12.5], nl: [52.4, 4.9],
  pl: [52.2, 21], sv: [59.3, 18.1], no: [59.9, 10.8], fi: [60.2, 24.9], da: [55.7, 12.6], cs: [50.1, 14.4], hu: [47.5, 19], ro: [44.4, 26.1],
  el: [38, 23.7], he: [31.8, 35.2], zh: [39.9, 116.4], ja: [35.7, 139.7], ko: [37.6, 127], id: [-6.2, 106.8], ms: [3.1, 101.7], th: [13.8, 100.5],
  vi: [21, 105.8], tl: [14.6, 121], my: [16.8, 96.2], km: [11.6, 104.9], sw: [-6.8, 39.3], am: [9, 38.7], yo: [7.4, 3.9], ha: [12, 8.5], ig: [6.5, 7.5],
  zu: [-29, 30], af: [-33.9, 18.4], ca: [41.4, 2.2], eu: [43.3, -2], gl: [42.9, -8.5], sr: [44.8, 20.5], hr: [45.8, 16], bg: [42.7, 23.3],
  az: [40.4, 49.9], ka: [41.7, 44.8], hy: [40.2, 44.5], kk: [51.2, 71.4], uz: [41.3, 69.3], simple: [51.5, -0.1],
};
const SUFFIX = /(wiki|wiktionary|wikisource|wikibooks|wikiquote|wikivoyage|wikinews|wikiversity)$/;
const GLOBAL = new Set(['commonswiki', 'wikidatawiki', 'metawiki', 'specieswiki', 'mediawikiwiki', 'incubatorwiki', 'outreachwiki', 'wikifunctionswiki']);

// { x, y } as percentages of an equirectangular map, or null.
function placeOf(dbname) {
  if (!dbname || GLOBAL.has(dbname)) return null;
  const code = dbname.replace(SUFFIX, '').replace(/_/g, '-');
  const p = PLACES[code] || PLACES[code.split('-')[0]];
  if (!p) return null;
  return { x: ((p[1] + 180) / 360) * 100, y: ((90 - p[0]) / 180) * 100 };
}

module.exports = { placeOf };

// Word counts: the rule ztools (ztools.toolforge.org, by RIFAT712) uses, written again here step
// by step so both tools give the same numbers: clean the wikitext, then count the tokens with a
// letter of the wiki's own script (Bengali on Bengali wikis, Devanagari on Hindi ones…) and, for
// non-Latin scripts, no Latin letter. On Bengali wikis this is exactly ztools' count.
const BENGALI = /[ঀ-৿]/;
const LATIN = /[a-zA-Z]/;

// The wiki's language → its script (a Unicode script name). Not listed: Latin.
const SCRIPTS = {
  Bengali: 'bn as bpy mni', Devanagari: 'hi mr ne sa mai bh new dty anp awa gom', Arabic: 'ar fa ur ps sd ckb arz azb mzn glk ks ug', Tamil: 'ta', Telugu: 'te', Kannada: 'kn tcy', Malayalam: 'ml',
  Gujarati: 'gu', Gurmukhi: 'pa', Oriya: 'or', Sinhala: 'si', Thai: 'th', Lao: 'lo', Khmer: 'km', Myanmar: 'my shn mnw', Tibetan: 'bo dz', Georgian: 'ka xmf', Armenian: 'hy hyw',
  Greek: 'el', Hebrew: 'he yi', Ethiopic: 'am ti', Cyrillic: 'ru uk be be-tarask bg sr mk kk ky tg tt ba cv ce mn os sah udm kv mhr mrj myv mdf koi krc lez av ab rue', Thaana: 'dv',
};
const SCRIPT_OF = {};
for (const [script, langs] of Object.entries(SCRIPTS)) for (const l of langs.split(' ')) SCRIPT_OF[l] = script;
const SITES = /(wiki|wiktionary|wikibooks|wikisource|wikiquote|wikivoyage|wikinews|wikiversity)$/;
function scriptFor(wiki) {
  const lang = String(wiki || 'bnwiki').replace(SITES, '').replace(/_/g, '-');
  return SCRIPT_OF[lang] || 'Latin';
}

function countZtools(wikitext, wiki = 'bnwiki') {
  let s = String(wikitext || '');
  s = s.replace(/<!--[\s\S]*?-->/g, '');                                        // comments
  s = s.replace(/<math>[\s\S]*?<\/math>/gi, ' ');                               // formulas
  s = s.replace(/<ref[\s\S]*?>[\s\S]*?<\/ref>/gi, ' ');                         // references
  s = s.replace(/<ref.*?>/gi, ' ');                                             // (within one line, like Python's .)
  // Files, images and categories (the Bengali য় written as য + nukta, as MediaWiki stores it).
  s = s.replace(/\[\[(File|Image|Category|চিত্র|ছবি|বিষয়শ্রেণী):[\s\S]*?\]\]/gi, '');
  s = s.replace(/\{\{[^|}]+\|/g, ' ');                                          // template names
  s = s.split('}}').join(' ').split('{{').join(' ');
  // Parameters like 1= (Python's \d is any Unicode digit, Bengali ones too).
  s = s.replace(/\|\s*\p{Nd}+\s*=/gu, ' ');
  s = s.replace(/^\s*\p{Nd}+\s*=/gmu, ' ');
  s = s.replace(/<[^>]+>/g, ' ');                                               // HTML tags
  s = s.split("'''").join('').split("''").join('');                             // bold, italics
  s = s.replace(/^==+.*==+$/gm, '');                                            // headings
  s = s.replace(/^[;:*#]+/gm, '');                                              // list markers
  s = s.replace(/[।.,?!()[\]{}:;=\-_|]/g, ' ');                                 // punctuation
  const script = scriptFor(wiki);
  const own = script === 'Bengali' ? BENGALI : new RegExp(`\\p{Script=${script}}`, 'u');
  return s.split(/\s+/).filter((t) => t && own.test(t) && (script === 'Latin' || !LATIN.test(t))).length;
}

function countPlain(text) {
  return String(text || '').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

const METHODS = ['auto', 'ztools', 'plain'];

// Every wiki, every event: the ztools rule.
function methodFor() {
  return 'ztools';
}

module.exports = { scriptFor, countZtools, countPlain, methodFor, METHODS };

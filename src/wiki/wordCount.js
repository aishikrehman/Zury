// Word counts. Two ways, chosen per event (settings.wordCountMethod):
//   'ztools' – the rule ztools (ztools.toolforge.org, by RIFAT712) uses for Bengali writing
//              contests, written again here step by step so both tools give the same numbers:
//              clean the wikitext, then count the tokens with a Bengali letter and no Latin one.
//   'plain'  – words in the article's plain text, in any script.
//   'auto'   – 'ztools' on Bengali wikis, 'plain' elsewhere.
const BENGALI = /[ঀ-৿]/;
const LATIN = /[a-zA-Z]/;

function countZtools(wikitext) {
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
  return s.split(/\s+/).filter((t) => t && BENGALI.test(t) && !LATIN.test(t)).length;
}

function countPlain(text) {
  return String(text || '').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

const METHODS = ['auto', 'ztools', 'plain'];

// The method actually used for a wiki ('ztools' or 'plain').
function methodFor(wiki, setting = 'auto') {
  if (setting === 'ztools' || setting === 'plain') return setting;
  return /^bn(wiki|wiktionary|wikibooks|wikisource|wikiquote|wikivoyage)$/.test(wiki) ? 'ztools' : 'plain';
}

module.exports = { countZtools, countPlain, methodFor, METHODS };

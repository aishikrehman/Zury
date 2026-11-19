// An event's own page on the wiki, and that page's talk page.
const { dbnameToHost } = require('../wiki/wikiUrls');

function pageUrl(wiki, title) {
  const host = dbnameToHost(wiki);
  return host ? `https://${host}/wiki/${encodeURIComponent(title.replace(/ /g, '_')).replace(/%3A/g, ':').replace(/%2F/g, '/')}` : null;
}

// { title, page, talk } or null. Special:TalkPage opens the right talk namespace on any wiki.
function eventWikiPage(contest, settings) {
  let ci = {}; try { ci = JSON.parse(contest.contactInfo || '{}') || {}; } catch { ci = {}; }
  let raw = (ci && typeof ci === 'object' && ci.eventPage) || '';
  if (!raw && settings) { try { raw = require('../services/participationService').read(settings).page || ''; } catch { raw = ''; } }
  if (!raw) return null;
  const title = /^https?:/.test(raw) ? decodeURIComponent((raw.match(/\/wiki\/([^?#]+)/) || [])[1] || '').replace(/_/g, ' ') : String(raw).trim();
  if (!title) return null;
  return { title, page: /^https?:/.test(raw) ? raw : pageUrl(contest.primaryWiki, title), talk: pageUrl(contest.primaryWiki, 'Special:TalkPage/' + title) };
}

module.exports = { eventWikiPage };

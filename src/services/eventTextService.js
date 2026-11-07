'use strict';

// On submit: the event's texts go on the wiki with the participant's own login.
// Talk page: at the very top. Article: above the first category (or at the end).
const oauthService = require('./wikimediaOAuthService');

const jsonList = (v) => { try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : []; } catch { return String(v || '').split(/[\n,]/).map((s) => s.trim()).filter(Boolean); } };

async function csrf(wiki, token) {
  const d = await oauthService.userApi(wiki, token, { action: 'query', meta: 'tokens', type: 'csrf' });
  const t = d?.query?.tokens?.csrftoken;
  if (!t || t === '+\\') throw new Error('No edit token');
  return t;
}

async function categoryNames(wiki, token) {
  const d = await oauthService.userApi(wiki, token, { action: 'query', meta: 'siteinfo', siprop: 'namespaces|namespacealiases' });
  const names = new Set(['Category']);
  const ns = d?.query?.namespaces?.['14'];
  if (ns) { names.add(ns.name); if (ns.canonical) names.add(ns.canonical); }
  for (const a of d?.query?.namespacealiases || []) if (a.id === 14) names.add(a.alias);
  return [...names];
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function addTexts({ token, submission, talkText, articleText, summary }) {
  if (!token || submission.entryType !== 'article') return;
  const { wiki, title } = submission;
  const edit = await csrf(wiki, token);
  if (talkText) {
    const talk = `Talk:${title}`;
    const cur = await oauthService.userApi(wiki, token, { action: 'query', prop: 'revisions', titles: talk, rvprop: 'content', rvslots: 'main' });
    const text = cur?.query?.pages?.[0]?.revisions?.[0]?.slots?.main?.content || '';
    if (!text.includes(talkText.trim())) {
      await oauthService.userApi(wiki, token, { action: 'edit', title: talk, prependtext: `${talkText.trim()}\n`, summary, token: edit }, { post: true });
    }
  }
  if (articleText) {
    const cur = await oauthService.userApi(wiki, token, { action: 'query', prop: 'revisions', titles: title, rvprop: 'content|timestamp', rvslots: 'main' });
    const rev = cur?.query?.pages?.[0]?.revisions?.[0];
    const text = rev?.slots?.main?.content;
    if (text != null && !text.includes(articleText.trim())) {
      const cats = await categoryNames(wiki, token);
      const m = new RegExp(`\\[\\[\\s*(${cats.map(esc).join('|')})\\s*:`, 'i').exec(text);
      const add = articleText.trim();
      const next = m ? `${text.slice(0, m.index).replace(/\s*$/, '\n')}${add}\n${text.slice(m.index)}` : `${text.replace(/\s*$/, '')}\n${add}\n`;
      await oauthService.userApi(wiki, token, { action: 'edit', title, text: next, summary, basetimestamp: rev.timestamp, nocreate: '1', token: edit }, { post: true });
    }
  }
}

// The summary: what organizers wrote in "Edit summary", else the event's name and link.
function summaryFor({ settings, contest, url }) {
  const own = String(settings.editSummary || '').trim() || jsonList(settings.trackHashtags).map((h) => `#${h}`).join(' ').trim();
  return own || `${contest.title} — ${url}`;
}

module.exports = { addTexts, summaryFor };

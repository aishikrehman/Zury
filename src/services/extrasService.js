// An event's About page extras, kept as JSON in settings.extras:
//   prizes        [{ place, prize }]     "1st | A book" per line
//   topicsPage    an on-wiki page with suggested topics
//   topics        [title]                one per line
//   faq           [{ q, a }]             a question line, then its answer; blank line between
//   announcements [{ at, text, by }]     newest last; posted from the About page
function read(settings) {
  let x = {};
  try { x = JSON.parse((settings && settings.extras) || '{}') || {}; } catch { x = {}; }
  return { prizes: x.prizes || [], topicsPage: x.topicsPage || '', topics: x.topics || [], faq: x.faq || [], announcements: x.announcements || [] };
}

const lines = (v) => String(v || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

function parse(body, previous) {
  const prizes = lines(body.extras_prizes).slice(0, 30).map((l) => { const [place, ...rest] = l.split('|'); return rest.length ? { place: place.trim().slice(0, 60), prize: rest.join('|').trim().slice(0, 300) } : { place: '', prize: place.trim().slice(0, 300) }; });
  const topics = lines(body.extras_topics).slice(0, 200).map((s) => s.slice(0, 200));
  const faq = String(body.extras_faq || '').split(/\r?\n\s*\r?\n/).map((b) => b.trim()).filter(Boolean).slice(0, 40).map((b) => { const [q, ...a] = b.split(/\r?\n/); return { q: q.trim().slice(0, 300), a: a.join('\n').trim().slice(0, 2000) }; });
  return JSON.stringify({ prizes, topicsPage: String(body.extras_topicsPage || '').trim().slice(0, 300), topics, faq, announcements: read({ extras: previous }).announcements });
}

function toForm(settings) {
  const x = read(settings);
  return {
    extras_prizes: x.prizes.map((p) => (p.place ? `${p.place} | ${p.prize}` : p.prize)).join('\n'),
    extras_topicsPage: x.topicsPage,
    extras_topics: x.topics.join('\n'),
    extras_faq: x.faq.map((f) => `${f.q}\n${f.a}`).join('\n\n'),
  };
}

module.exports = { read, parse, toForm };

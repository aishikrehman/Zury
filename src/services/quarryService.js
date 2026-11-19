// Names from a Quarry query (quarry.wmcloud.org): its last run's result, one column of it.
// Zury does not run the query; whoever wrote it runs it on Quarry when it should be fresh.
const env = require('../config/env');

class QuarryError extends Error {}

// "https://quarry.wmcloud.org/query/12345", "quarry.wmcloud.org/query/12345#..." or "12345".
function queryId(input) {
  const s = String(input || '').trim();
  const m = s.match(/^(?:https?:\/\/)?quarry\.wmcloud\.org\/query\/(\d+)/i) || s.match(/^(\d+)$/);
  return m ? Number(m[1]) : null;
}

// Kept 30 minutes, so moving between the steps of /mass does not ask again.
const namesKept = new Map();
async function names(...args) {
  const key = JSON.stringify(args);
  const hit = namesKept.get(key);
  if (hit && Date.now() - hit.at < 1800000) return hit.value;
  const value = await namesFresh(...args);
  if (namesKept.size > 50) namesKept.delete(namesKept.keys().next().value);
  namesKept.set(key, { at: Date.now(), value });
  return value;
}

async function namesFresh(input, column = '') {
  const id = queryId(input);
  if (!id) throw new QuarryError('Give a Quarry query link, like https://quarry.wmcloud.org/query/12345.');
  let res;
  try {
    res = await fetch(`https://quarry.wmcloud.org/query/${id}/result/latest/0/json`, { headers: { 'User-Agent': env.userAgent, Accept: 'application/json' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
  } catch { throw new QuarryError('Quarry could not be reached.'); }
  if (!res.ok) throw new QuarryError('This Quarry query has no result yet. Run it on Quarry first.');
  let data;
  try { data = await res.json(); } catch { throw new QuarryError('This Quarry query has no result yet. Run it on Quarry first.'); }
  const headers = data.headers || [];
  if (!headers.length) throw new QuarryError('The Quarry result is empty.');
  // The column: the one named, else the first that looks like user names, else the first.
  let i = column ? headers.findIndex((h) => h.toLowerCase() === String(column).trim().toLowerCase()) : -1;
  if (column && i < 0) throw new QuarryError(`The result has no column "${column}". Columns: ${headers.join(', ')}.`);
  if (i < 0) i = headers.findIndex((h) => /^(user_?name|actor_name|rev_user_text|username|user|name)$/i.test(h));
  if (i < 0) i = headers.findIndex((h) => /user|actor/i.test(h));
  if (i < 0) i = 0;
  const out = new Set();
  for (const row of (data.rows || []).slice(0, 5000)) {
    const v = row[i];
    if (v == null || v === '') continue;
    out.add(String(v).replace(/^(User|User talk|ব্যবহারকারী|ব্যবহারকারী আলাপ):/i, '').replace(/_/g, ' ').trim());
  }
  return { names: [...out].filter(Boolean), column: headers[i], headers, id };
}

module.exports = { names, queryId, QuarryError };

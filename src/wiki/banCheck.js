// Is this account barred on Wikimedia? Checks a global lock, a global block, and
// a sitewide block on the given wiki. Partial blocks (single pages or namespaces)
// don't count. If a wiki can't be reached the person is not held up; the check
// runs again on every join and submission.
const wikiApi = require('./wikiApi');

async function safe(fn, label) {
  try {
    return await fn();
  } catch (err) {
    console.error(`Ban check skipped (${label}): ${err.message}`);
    return null;
  }
}

async function wikimediaBans(user, wiki) {
  if (!user || user.isDemo) return [];
  const reasons = [];
  const [global, globalBlocks, local] = await Promise.all([
    safe(() => wikiApi.get('metawiki', { action: 'query', meta: 'globaluserinfo', guiuser: user.username }), 'global lock'),
    safe(() => wikiApi.get('metawiki', { action: 'query', list: 'globalblocks', bgtargets: user.username, bgprop: 'expiry' }), 'global block'),
    wiki ? safe(() => wikiApi.get(wiki, { action: 'query', list: 'blocks', bkusers: user.username, bkprop: 'flags|expiry' }), `block on ${wiki}`) : null,
  ]);
  if (global?.query?.globaluserinfo?.locked !== undefined && global.query.globaluserinfo.locked !== false) {
    reasons.push('Your Wikimedia account is globally locked.');
  }
  if (globalBlocks?.query?.globalblocks?.length) reasons.push('Your Wikimedia account is globally blocked.');
  if ((local?.query?.blocks || []).some((b) => !b.partial)) reasons.push(`You are blocked on ${wiki}.`);
  return reasons;
}

module.exports = { wikimediaBans };

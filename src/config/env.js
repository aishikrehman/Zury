require('dotenv').config();

// On Toolforge the tool may already keep its secrets under other names (SECRET_KEY,
// WIKI_CONSUMER_KEY, WIKI_CONSUMER_SECRET): use those when Zury's own names are unset.
for (const [ours, theirs] of [['SESSION_SECRET', 'SECRET_KEY'], ['WIKIMEDIA_CONSUMER_KEY', 'WIKI_CONSUMER_KEY'], ['WIKIMEDIA_CONSUMER_SECRET', 'WIKI_CONSUMER_SECRET']]) {
  if (!process.env[ours] && process.env[theirs]) process.env[ours] = process.env[theirs];
}

const nodeEnv = process.env.NODE_ENV || 'development';

// Demo login lets anyone become any demo user, so it can never run in production.
function isDemoModeEnabled(vars = process.env) {
  return vars.DEMO_MODE === 'true' && (vars.NODE_ENV || 'development') !== 'production';
}

const env = {
  port: parseInt(process.env.PORT, 10) || 5000,
  nodeEnv,
  sessionSecret: process.env.SESSION_SECRET,
  demoMode: isDemoModeEnabled(),
  wikimedia: {
    consumerKey: process.env.WIKIMEDIA_CONSUMER_KEY,
    consumerSecret: process.env.WIKIMEDIA_CONSUMER_SECRET,
    callbackUrl: process.env.WIKIMEDIA_CALLBACK_URL,
    oauthBaseUrl: process.env.WIKIMEDIA_OAUTH_BASE_URL || 'https://meta.wikimedia.org/w/index.php',
    // Testing only: e.g. "http://127.0.0.1:8080/{wiki}/api.php" to point every wiki at a mock.
    apiUrlTemplate: process.env.WIKIMEDIA_API_URL_TEMPLATE || null,
  },
  userAgent: 'Zury/0.1 (https://github.com/aishikrehman/Zury)',
  isDemoModeEnabled,
};

if (!env.sessionSecret) {
  throw new Error('SESSION_SECRET is not set. Copy .env.example to .env and fill it in.');
}

// Settings that must be right before real people use the site. Returns a list of problems.
function productionProblems(vars = process.env) {
  const problems = [];
  const placeholder = (v) => !v || /^(your_|change|replace)/.test(v);
  if ((vars.SESSION_SECRET || '').length < 32 || placeholder(vars.SESSION_SECRET)) problems.push('SESSION_SECRET must be a random string of at least 32 characters.');
  if (placeholder(vars.WIKIMEDIA_CONSUMER_KEY) || placeholder(vars.WIKIMEDIA_CONSUMER_SECRET)) problems.push('WIKIMEDIA_CONSUMER_KEY and WIKIMEDIA_CONSUMER_SECRET must be set.');
  if (!/^https:\/\//.test(vars.WIKIMEDIA_CALLBACK_URL || '')) problems.push('WIKIMEDIA_CALLBACK_URL must be an https:// address.');
  if (!vars.DATABASE_URL) problems.push('DATABASE_URL must be set.');
  if (vars.WIKIMEDIA_API_URL_TEMPLATE) problems.push('WIKIMEDIA_API_URL_TEMPLATE is for tests only; remove it.');
  return problems;
}
env.productionProblems = productionProblems;

if (nodeEnv === 'production') {
  const problems = productionProblems();
  if (problems.length) throw new Error(`Zury can't start in production:\n- ${problems.join('\n- ')}`);
}
if (process.env.DEMO_MODE === 'true' && !env.demoMode) {
  console.warn('DEMO_MODE is ignored in production.');
}

module.exports = env;

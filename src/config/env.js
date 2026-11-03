require('dotenv').config();

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
  },
  userAgent: 'Zury/0.1 (https://github.com/aishikrehman/Zury)',
  isDemoModeEnabled,
};

if (!env.sessionSecret) {
  throw new Error('SESSION_SECRET is not set. Copy .env.example to .env and fill it in.');
}
if (process.env.DEMO_MODE === 'true' && !env.demoMode) {
  console.warn('DEMO_MODE is ignored in production.');
}

module.exports = env;

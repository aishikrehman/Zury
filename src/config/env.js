require('dotenv').config();

const env = {
  port: parseInt(process.env.PORT, 10) || 5000,
  nodeEnv: process.env.NODE_ENV || 'development',
  sessionSecret: process.env.SESSION_SECRET,
  wikimedia: {
    consumerKey: process.env.WIKIMEDIA_CONSUMER_KEY,
    consumerSecret: process.env.WIKIMEDIA_CONSUMER_SECRET,
    callbackUrl: process.env.WIKIMEDIA_CALLBACK_URL,
    oauthBaseUrl: process.env.WIKIMEDIA_OAUTH_BASE_URL || 'https://meta.wikimedia.org/w/index.php',
  },
  userAgent: 'Zury/0.1 (https://github.com/aishikrehman/Zury)',
};

if (!env.sessionSecret) {
  throw new Error('SESSION_SECRET is not set. Copy .env.example to .env and fill it in.');
}

module.exports = env;

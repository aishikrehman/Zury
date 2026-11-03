require('dotenv').config();

const env = {
  port: parseInt(process.env.PORT, 10) || 5000,
  nodeEnv: process.env.NODE_ENV || 'development',
  sessionSecret: process.env.SESSION_SECRET,
  wikimedia: {
    consumerKey: process.env.WIKIMEDIA_CONSUMER_KEY,
    consumerSecret: process.env.WIKIMEDIA_CONSUMER_SECRET,
    callbackUrl: process.env.WIKIMEDIA_CALLBACK_URL,
  },
};

module.exports = env;

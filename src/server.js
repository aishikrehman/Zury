const env = require('./config/env');
const app = require('./app');
const { refreshStatuses } = require('./services/lifecycleService');
const { ensureFresh } = require('./wiki/catalogService');

const STATUS_SWEEP_MS = 10 * 60 * 1000;

async function sweep() {
  try {
    const changed = await refreshStatuses();
    if (changed) console.log(`Updated the status of ${changed} event(s).`);
  } catch (err) {
    console.error('Event status sweep failed:', err);
  }
}

app.listen(env.port, () => {
  console.log(`Zury is running at http://127.0.0.1:${env.port}`);
  ensureFresh()
    .then((r) => r && console.log(`Wiki catalog refreshed: ${r.wikis} wikis, ${r.languages} languages.`))
    .catch((err) => console.error('Wiki catalog refresh failed:', err.message));
  sweep();
  setInterval(sweep, STATUS_SWEEP_MS).unref();
});

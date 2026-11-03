const env = require('./config/env');
const app = require('./app');
const { refreshStatuses } = require('./services/lifecycleService');
const { ensureFresh } = require('./wiki/catalogService');
const prisma = require('./config/prisma');
const trackingService = require('./services/trackingService');

const STATUS_SWEEP_MS = 10 * 60 * 1000;
const TRACKING_SWEEP_MS = 60 * 60 * 1000;

async function sweep() {
  try {
    const changed = await refreshStatuses();
    if (changed) console.log(`Updated the status of ${changed} event(s).`);
  } catch (err) {
    console.error('Event status sweep failed:', err);
  }
}

// Looks for new contributions in every running event that tracks them.
async function trackingSweep() {
  try {
    const events = await prisma.contest.findMany({ where: { status: 'active', deletedAt: null, isDemo: false }, include: { settings: true, wikis: true } });
    for (const { settings, wikis, ...contest } of events) {
      if (!settings || !trackingService.isTracking(settings)) continue;
      const { added, errors } = await trackingService.refresh({ contest, settings, eventWikis: wikis });
      if (added) console.log(`Tracking: ${added} new contribution(s) for "${contest.title}".`);
      for (const e of errors) console.error(`Tracking "${contest.title}": ${e}`);
    }
  } catch (err) {
    console.error('Tracking sweep failed:', err);
  }
}

app.listen(env.port, () => {
  console.log(`Zury is running at http://127.0.0.1:${env.port}`);
  ensureFresh()
    .then((r) => r && console.log(`Wiki catalog refreshed: ${r.wikis} wikis, ${r.languages} languages.`))
    .catch((err) => console.error('Wiki catalog refresh failed:', err.message));
  sweep();
  setInterval(sweep, STATUS_SWEEP_MS).unref();
  setInterval(trackingSweep, TRACKING_SWEEP_MS).unref();
});

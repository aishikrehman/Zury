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
    const events = await prisma.contest.findMany({ where: { status: 'active', deletedAt: null }, include: { settings: true, wikis: true } });
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

// Superusers' changes to the roles apply from the first request.
require('./services/rolePermissionService').load().catch((err) => console.error('Role permissions not loaded:', err.message));
const server = app.listen(env.port, () => {
  console.log(`Zury is running at http://127.0.0.1:${env.port}`);
  ensureFresh()
    .then((r) => r && console.log(`Wiki catalog refreshed: ${r.wikis} wikis, ${r.languages} languages.`))
    .catch((err) => console.error('Wiki catalog refresh failed:', err.message));
  sweep();
  setInterval(sweep, STATUS_SWEEP_MS).unref();
  // A backup every day (and the first one an hour after start).
  const backupNow = () => require('./services/backupService').write('daily').then((f) => console.log(`Backup written: ${f}`)).catch((err) => console.error('Backup failed:', err.message));
  setTimeout(backupNow, 60 * 60 * 1000).unref();
  setInterval(backupNow, 24 * 60 * 60 * 1000).unref();
  setInterval(trackingSweep, TRACKING_SWEEP_MS).unref();
  // Editathons followed on Fountain: entries and jury decisions, every hour.
  const fountainNow = () => require('./services/fountainService').syncAll().catch((err) => console.error('Fountain sync failed:', err.message));
  setTimeout(fountainNow, 5 * 60 * 1000).unref();
  setInterval(fountainNow, 60 * 60 * 1000).unref();
});

// Hosts stop the app with SIGTERM: finish open requests, close the database, exit.
function shutdown(signal) {
  console.log(`${signal} received, shutting down.`);
  server.close(() => {
    prisma.$disconnect().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err));

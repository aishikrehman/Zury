// Brings every event's entries under the one word rule: words follow the wiki while an event
// runs, then the revision at the end time; events with locked results or archived stay as they are.
// Run once: node scripts/apply-word-rule.js
require('dotenv').config();
require('../src/config/database');
const prisma = require('../src/config/prisma');
const watch = require('../src/services/articleWatchService');

(async () => {
  const events = await prisma.contest.findMany({
    where: { deletedAt: null, status: { notIn: ['draft', 'cancelled', 'archived'] }, resultsPublishedAt: null, submissions: { some: { entryType: 'article' } } },
    include: { settings: true },
  });
  let n = 0;
  for (const { settings, ...contest } of events) {
    if (!settings) continue;
    // The old revision choice is no longer kept.
    try {
      const p = JSON.parse(settings.participation || '{}') || {};
      if (p.rules && 'revision' in p.rules) {
        delete p.rules.revision;
        await prisma.contestSettings.update({ where: { contestId: contest.id }, data: { participation: JSON.stringify(p) } });
      }
    } catch { /* unreadable settings stay as they are */ }
    try {
      await watch.checkEvent(contest, settings);
      n += 1;
      console.log(`${contest.title}: done`);
    } catch (err) {
      console.error(`${contest.title}: ${err.message}`);
    }
  }
  console.log(`${n} events brought under the word rule.`);
  await prisma.$disconnect();
})();

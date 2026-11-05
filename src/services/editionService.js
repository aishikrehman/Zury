// Editions as their own records (stage 1 of the Series / Edition / Event / Local Event
// structure). Until the addresses move over, an event still carries seriesId + edition;
// this keeps the Edition record, its place under the series and the event's link in step.
const prisma = require('../config/prisma');

const EDITION_STATUS = (status) => (status === 'draft' ? 'draft' : ['completed', 'archived'].includes(status) ? status : 'active');

// After an event is created or changed: give its series + edition an Edition record (made
// once, shared by every event of that edition) and point the event at it. An event that
// left its series loses the link; an Edition stays, even empty, as editions may.
async function sync(contestId, client = prisma) {
  const c = await client.contest.findUnique({ where: { id: contestId }, select: { id: true, seriesId: true, edition: true, editionId: true, title: true, status: true, startDate: true, endDate: true } });
  if (!c) return null;
  if (!c.seriesId || !c.edition) {
    if (c.editionId) await client.contest.update({ where: { id: c.id }, data: { editionId: null } });
    return null;
  }
  let edition = await client.edition.findUnique({ where: { seriesId_slug: { seriesId: c.seriesId, slug: c.edition } } });
  if (!edition) {
    edition = await client.edition.create({
      data: {
        seriesId: c.seriesId,
        slug: c.edition,
        title: c.title,
        year: /^\d{4}$/.test(c.edition) ? Number(c.edition) : null,
        status: EDITION_STATUS(c.status),
        startDate: c.startDate,
        endDate: c.endDate,
      },
    });
  }
  await client.seriesSlug.upsert({
    where: { seriesId_slug: { seriesId: c.seriesId, slug: c.edition } },
    update: {},
    create: { seriesId: c.seriesId, slug: c.edition, editionId: edition.id },
  });
  if (c.editionId !== edition.id) await client.contest.update({ where: { id: c.id }, data: { editionId: edition.id } });
  return edition;
}

module.exports = { sync };

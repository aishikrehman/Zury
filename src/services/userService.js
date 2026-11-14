const { isValidTimezone } = require('../utils/time');
const prisma = require('../config/prisma');

const LANGUAGE_CODE = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i;

// Wikimedia-sourced fields are refreshed on every login; Zury-local
// preferences (language, timezone) are never overwritten by sync.
async function syncFromWikimedia({ wikimediaId, username, homeWiki, registeredAt }) {
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    // A global rename can hand an old username to a different account.
    await tx.user.updateMany({
      where: { username, NOT: { wikimediaId } },
      data: { username: `${username} (renamed ${wikimediaId})` },
    });
    return tx.user.upsert({
      where: { wikimediaId },
      update: {
        username,
        lastLoginAt: now,
        ...(homeWiki && { homeWiki }),
        ...(registeredAt && { wikimediaRegisteredAt: registeredAt }),
      },
      create: {
        wikimediaId,
        username,
        homeWiki,
        wikimediaRegisteredAt: registeredAt,
        lastLoginAt: now,
      },
    });
  });
}


// knownLanguage: check against the stored language catalog (permissive if not loaded).
function validatePreferences({ preferredLanguage, timezone }, knownLanguage = () => true) {
  const errors = {};
  const lang = (preferredLanguage || '').trim();
  const tz = (timezone || '').trim();

  if (lang && (!LANGUAGE_CODE.test(lang) || !knownLanguage(lang))) errors.preferredLanguage = 'Unknown language.';
  if (tz && !isValidTimezone(tz)) errors.timezone = 'Unknown timezone.';

  return { errors, values: { preferredLanguage: lang || null, timezone: tz || null } };
}

function updatePreferences(userId, values) {
  return prisma.user.update({ where: { id: userId }, data: values });
}

module.exports = {
  syncFromWikimedia,
  validatePreferences,
  updatePreferences,
};

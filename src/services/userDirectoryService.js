const prisma = require('../config/prisma');
const wikimediaApi = require('./wikimediaApiService');

// MediaWiki canonical form: underscores are spaces, first letter upper case.
function normalizeUsername(raw) {
  const name = String(raw || '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : '';
}

// Finds a Zury user by Wikimedia username, creating a local record from
// CentralAuth if they haven't logged in yet (e.g. a juror being invited).
async function findOrImport(rawUsername) {
  const username = normalizeUsername(rawUsername);
  if (!username || username.length > 85) return null;

  const local = await prisma.user.findUnique({ where: { username } });
  if (local) return local.status === 'active' ? local : null;

  const info = await wikimediaApi.fetchGlobalUserInfoByName(username);
  if (!info) return null;

  // Same account under an older username: refresh the name instead of duplicating.
  return prisma.user.upsert({
    where: { wikimediaId: info.id },
    update: { username: info.name },
    create: {
      wikimediaId: info.id,
      username: info.name,
      homeWiki: info.home,
      wikimediaRegisteredAt: info.registeredAt,
      globalEditCount: info.editCount,
    },
  });
}

module.exports = { normalizeUsername, findOrImport };

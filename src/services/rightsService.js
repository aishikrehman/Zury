const prisma = require('../config/prisma');
const wikimediaApi = require('./wikimediaApiService');
const audit = require('./auditService');
const { GLOBAL_GROUP_ROLES, LOCAL_GROUP_ROLES } = require('../permissions/registry');

const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;

function extractTrackedRights(info) {
  const rights = info.globalGroups
    .filter((g) => GLOBAL_GROUP_ROLES[g])
    .map((g) => ({ wiki: '*', rightName: g }));
  for (const { wiki, groups } of info.localGroups) {
    for (const g of groups) if (LOCAL_GROUP_ROLES[g]) rights.push({ wiki, rightName: g });
  }
  return rights;
}

const rightKey = (r) => `${r.wiki}:${r.rightName}`;

async function replaceVerifiedRights(userId, rights, source = 'globaluserinfo') {
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const before = await tx.userWikiRole.findMany({ where: { userId } });
    await tx.userWikiRole.deleteMany({ where: { userId } });
    if (rights.length) {
      await tx.userWikiRole.createMany({
        data: rights.map((r) => ({ userId, ...r, verifiedAt: now, verificationSource: source })),
      });
    }
    await tx.user.update({ where: { id: userId }, data: { rightsCheckedAt: now } });

    const beforeKeys = new Set(before.map(rightKey));
    const afterKeys = new Set(rights.map(rightKey));
    const added = [...afterKeys].filter((k) => !beforeKeys.has(k));
    const removed = [...beforeKeys].filter((k) => !afterKeys.has(k));
    if (added.length || removed.length) {
      await audit.record(
        { actorId: userId, action: 'wikiRights.verified', entityType: 'User', entityId: userId, details: { added, removed, source } },
        tx,
      );
    }
  });
}

async function refreshFromWikimedia(user) {
  const info = await wikimediaApi.fetchGlobalUserInfo(user.wikimediaId);
  if (!info) return null;
  await replaceVerifiedRights(user.id, extractTrackedRights(info));
  return info;
}

function needsRefresh(user, now = new Date()) {
  if (user.isDemo) return false;
  return !user.rightsCheckedAt || now - user.rightsCheckedAt > REFRESH_AFTER_MS;
}

module.exports = { extractTrackedRights, replaceVerifiedRights, refreshFromWikimedia, needsRefresh };

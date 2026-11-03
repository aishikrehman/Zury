const prisma = require('../config/prisma');
const permissionService = require('../services/permissionService');
const contestService = require('../services/contestService');
const { defaultSettings } = require('../services/contestFormService');
const { effectiveFor } = require('../events/effective');
const { requireAuth } = require('./auth');

function forbidden() {
  const err = new Error("You don't have permission to do that.");
  err.status = 403;
  return err;
}

// Paths that can never be an event series (they belong to the app).
const RESERVED = new Set([
  'events', 'contest', 'admin', 'api', 'users', 'dashboard', 'settings', 'submissions', 'login', 'logout',
  'auth', 'demo', 'layout', 'preferences', 'vendor', 'css', 'js', 'images', 'about', 'favicon.ico',
]);

const notFound = (res) => res.status(404).render('pages/404', { title: 'Event Not Found' });

/**
 * Sets up everything an event page needs:
 * req.contest, req.settings (effective for the current wiki), req.eventWikis,
 * req.wikiScope (the wiki part being viewed, or null for the whole event),
 * req.scope / req.permissions (permissions in this context), and req.base
 * (the URL prefix for links: /wam/2026, /wam/2026/bn or /contest/12).
 */
async function setupEvent(req, res, next, contest, code) {
  const { settings: rawSettings, wikis, series, ...rest } = contest;
  const settings = rawSettings || { contestId: contest.id, ...defaultSettings(contest.type) };
  const participating = wikis.filter((w) => w.status !== 'pending');
  let wikiScope = null;
  if (code) {
    wikiScope = wikis.find((w) => w.code === code);
    if (!wikiScope) return notFound(res);
  }
  const scope = await permissionService.contestScope(req.subject, rest, {
    wikis: participating.map((w) => w.wiki),
    wiki: wikiScope?.wiki,
  });
  if (wikiScope?.status === 'pending' && !scope.isGlobalController) return notFound(res);
  if (!contestService.isVisible(rest, scope)) return notFound(res);

  // A single-wiki event is managed as that wiki; its page is the event page.
  const contextWiki = wikiScope || (participating.length === 1 ? participating[0] : null);
  const eff = effectiveFor(rest, settings, contextWiki);
  const eventBase = series && rest.edition ? `/${series.slug}/${rest.edition}` : `/${rest.slug}`;
  const base = wikiScope ? `${eventBase}/${wikiScope.code}` : eventBase;

  req.contest = rest;
  req.eventSettings = settings;
  req.settings = eff.settings;
  req.effective = eff;
  req.series = series;
  req.eventWikis = participating;
  req.allWikis = wikis;
  req.wikiScope = wikiScope;
  req.contextWiki = contextWiki;
  req.scope = scope;
  req.permissions = scope.permissions;
  req.base = base;
  req.eventBase = eventBase;
  // Views show the effective values for the wiki in context; eventContest is the event as stored.
  Object.assign(res.locals, {
    contest: eff.contest,
    eventContest: rest,
    settings: eff.settings,
    overridden: eff.overridden,
    series,
    eventWikis: participating,
    allWikis: wikis,
    wikiScope,
    scope,
    base,
    eventBase,
    can: (permission) => scope.permissions.has(permission),
  });
  next();
}

const EVENT_INCLUDE = { settings: true, wikis: { orderBy: [{ status: 'asc' }, { code: 'asc' }] }, series: true };

// A moved event's old address leads to its wiki in the event it joined.
async function redirectMerged(req, res, where, prefixLength) {
  if (req.method !== 'GET') return false;
  const old = await prisma.contest.findFirst({ where: { ...where, mergedIntoId: { not: null } }, select: { mergedIntoId: true, mergedWikiCode: true } });
  if (!old) return false;
  const target = await prisma.contest.findFirst({ where: { id: old.mergedIntoId, deletedAt: null }, include: { series: true } });
  if (!target) return false;
  const base = target.series && target.edition ? `/${target.series.slug}/${target.edition}` : `/${target.slug}`;
  res.redirect(301, `${base}/${old.mergedWikiCode}${req.originalUrl.slice(prefixLength)}`);
  return true;
}

// /contest/:contestId
async function loadContest(req, res, next) {
  try {
    const id = Number(req.params.contestId);
    const contest = Number.isSafeInteger(id) && id > 0 ? await prisma.contest.findFirst({ where: { id, deletedAt: null }, include: EVENT_INCLUDE }) : null;
    if (!contest) {
      if (Number.isSafeInteger(id) && (await redirectMerged(req, res, { id }, `/contest/${id}`.length))) return;
      return notFound(res);
    }
    await setupEvent(req, res, next, contest, null);
  } catch (err) {
    next(err);
  }
}

// Loaders below call next() without setting req.contest when the address isn't
// theirs, so the next kind of address can try (see the routes).

// /:series/:edition[/:code], e.g. /wam/2026/bn
function loadSeriesEvent({ withWiki }) {
  return async (req, res, next) => {
    try {
      const { series, edition } = req.params;
      if (RESERVED.has(series)) return next();
      const contest = await prisma.contest.findFirst({
        where: { edition, deletedAt: null, series: { slug: series } },
        include: EVENT_INCLUDE,
      });
      if (!contest) return next();
      await setupEvent(req, res, next, contest, withWiki ? req.params.code : null);
    } catch (err) {
      next(err);
    }
  };
}

// /:slug[/:code] for events that aren't part of a series, e.g. /dhaka-photowalk
function loadSlugEvent({ withWiki }) {
  return async (req, res, next) => {
    try {
      const { slug } = req.params;
      if (RESERVED.has(slug)) return next();
      const contest = await prisma.contest.findFirst({ where: { slug, deletedAt: null }, include: EVENT_INCLUDE });
      if (!contest) {
        if (!withWiki && (await redirectMerged(req, res, { slug }, slug.length + 1))) return;
        return next();
      }
      // An event that joined a series moved to /<series>/<edition>.
      if (contest.series && contest.edition) {
        if (req.method !== 'GET') return next();
        return res.redirect(301, `/${contest.series.slug}/${contest.edition}${req.originalUrl.slice(slug.length + 1)}`);
      }
      await setupEvent(req, res, next, contest, withWiki ? req.params.code : null);
    } catch (err) {
      next(err);
    }
  };
}

// Checks against the current scope: the event's (or wiki part's) if an event loaded, else global.
function requirePermission(...anyOf) {
  return (req, res, next) => {
    if (!req.user) return requireAuth(req, res, next);
    if (anyOf.some((p) => req.permissions.has(p))) return next();
    next(forbidden());
  };
}

// For actions that change the whole event: in a multi-wiki event only global controllers
// (event-wide roles and platform authority) may take them, even from a wiki's page.
function requireEventWide(permission) {
  return (req, res, next) => {
    if (!req.user) return requireAuth(req, res, next);
    const set = req.wikiScope || req.eventWikis.length > 1 ? req.scope.global : req.permissions;
    if (set.has(permission)) return next();
    next(forbidden());
  };
}

module.exports = { loadContest, loadSeriesEvent, loadSlugEvent, requirePermission, requireEventWide, forbidden, RESERVED };

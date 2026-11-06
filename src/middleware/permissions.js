const prisma = require('../config/prisma');
const permissionService = require('../services/permissionService');
const contestService = require('../services/contestService');
const { defaultSettings } = require('../services/contestFormService');
const { effectiveFor } = require('../events/effective');
const { requireAuth } = require('./auth');
const { EVENT_TABS } = require('../services/editionService');

function forbidden() {
  const err = new Error("You don't have permission to do that.");
  err.status = 403;
  return err;
}

// Paths that can never be an event series (they belong to the app).
const RESERVED = new Set([
  'events', 'contest', 'admin', 'api', 'users', 'dashboard', 'settings', 'submissions', 'login', 'logout',
  'auth', 'layout', 'preferences', 'review', 'vendor', 'css', 'js', 'images', 'about', 'favicon.ico', 'series', 'robots.txt', 'sitemap.xml', 'icons',
  'notifications',
  // Event types: kept free, so a series can't be named like one.
  ...Object.keys(require('../events/eventTypes').EVENT_TYPES),
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
  const { settings: rawSettings, wikis, series: directSeries, editionOf, ...rest } = contest;
  // The series: its own, or its edition's.
  const series = editionOf ? editionOf.series : directSeries;
  const edition = editionOf || null;
  const settings = rawSettings || { contestId: contest.id, ...defaultSettings(contest.type) };
  const participating = wikis.filter((w) => w.status !== 'pending');
  let wikiScope = null;
  if (code) {
    wikiScope = wikis.find((w) => w.code === code);
    if (!wikiScope) return notFound(res);
  }
  const scope = await permissionService.contestScope(req.subject, rest, {
    settings,
    wikis: participating.map((w) => w.wiki),
    wiki: wikiScope?.wiki,
  });
  if (wikiScope?.status === 'pending' && !scope.isGlobalController) return notFound(res);
  if (!contestService.isVisible(rest, scope)) return notFound(res);

  // A single-wiki event is managed as that wiki; its page is the event page.
  const contextWiki = wikiScope || (participating.length === 1 ? participating[0] : null);
  const eff = effectiveFor(rest, settings, contextWiki);
  const eventBase = rest.path || `/contest/${rest.id}`;
  const base = wikiScope ? `${eventBase}/${wikiScope.code}` : eventBase;

  req.contest = rest;
  req.eventSettings = settings;
  req.settings = eff.settings;
  req.effective = eff;
  req.series = series;
  req.edition = edition;
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
    edition,
    eventWikis: participating,
    allWikis: wikis,
    wikiScope,
    scope,
    base,
    eventBase,
    // A wiki's own address in this event (the event itself for the wiki it is named after).
    wikiHref: (w) => (rest.editionId && w.code === rest.slug ? eventBase : `${eventBase}/${w.code}`),
    can: (permission) => scope.permissions.has(permission),
  });
  next();
}

const EVENT_INCLUDE = { settings: true, wikis: { orderBy: [{ status: 'asc' }, { code: 'asc' }] }, series: true, editionOf: { include: { series: true } } };

// /contest/:contestId
async function loadContest(req, res, next) {
  try {
    const id = Number(req.params.contestId);
    const contest = Number.isSafeInteger(id) && id > 0 ? await prisma.contest.findFirst({ where: { id, deletedAt: null }, include: EVENT_INCLUDE }) : null;
    if (!contest) return notFound(res);
    await setupEvent(req, res, next, contest, null);
  } catch (err) {
    next(err);
  }
}

/**
 * Finds the event an address belongs to by its stored address (/events/<slug>,
 * /<series>/<slug> or /<series>/<edition>/<slug>): the longest one the address starts
 * with. What follows is an optional wiki code (/bn), then the event's page (/config).
 * Returns { contest, code, rest } or null; nothing is guessed from the address's shape.
 */
async function resolveEvent(req) {
  const segs = req.path.split('/').filter(Boolean).map((x) => { try { return decodeURIComponent(x); } catch { return x; } });
  if (!segs.length || RESERVED.has(segs[0])) return null;
  const prefixes = [];
  for (let n = Math.min(3, segs.length); n >= 1; n -= 1) prefixes.push('/' + segs.slice(0, n).join('/'));
  const found = await prisma.contest.findMany({ where: { path: { in: prefixes }, deletedAt: null }, include: EVENT_INCLUDE });
  if (!found.length) return null;
  const contest = found.sort((x, y) => y.path.length - x.path.length)[0];
  let rest = segs.slice(contest.path.split('/').filter(Boolean).length);
  let code = null;
  if (rest.length && !EVENT_TABS.has(rest[0]) && contest.wikis.some((w) => w.code === rest[0]) && !(contest.editionId && rest[0] === contest.slug)) {
    code = rest[0];
    rest = rest.slice(1);
  }
  const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  return { contest, code, rest: '/' + rest.join('/') + query };
}

// Runs the event pages (the given router) for any address that belongs to an event.
function eventAddresses(eventRouter) {
  return async (req, res, next) => {
    try {
      const found = await resolveEvent(req);
      if (!found) return next();
      const url = req.url;
      req.url = found.rest;
      await setupEvent(req, res, (err) => {
        if (err) return next(err);
        eventRouter(req, res, (e) => { req.url = url; next(e); });
      }, found.contest, found.code);
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

module.exports = { loadContest, eventAddresses, requirePermission, requireEventWide, forbidden, RESERVED, EVENT_INCLUDE };

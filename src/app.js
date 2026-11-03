const path = require('path');
const express = require('express');
const session = require('express-session');
const expressLayouts = require('express-ejs-layouts');

const env = require('./config/env');
const format = require('./utils/format');
const contestLabels = require('./utils/contestLabels');
const { PLATFORM_ROLES, EVENT_ROLES } = require('./permissions/registry');
const { TIMEZONES } = require('./utils/time');
const layouts = require('./utils/layouts');
const { FEATURE_FIELDS, DATE_FIELDS, PARTICIPATION_MODES, defaultSettings } = require('./services/contestFormService');
const { EVENT_TYPES } = require('./events/eventTypes');

// Switches each event type starts with, so the form can follow a change of type.
const FEATURE_DEFAULTS = Object.fromEntries(
  Object.keys(EVENT_TYPES).map((t) => {
    const d = defaultSettings(t);
    const keys = [...FEATURE_FIELDS.map(([k]) => k), 'registrationRequired'];
    return [t, Object.fromEntries(keys.map((k) => [k, !!d[k]]))];
  }),
);
const { eventWikiScope } = require('./services/permissionService');
const { attachUser } = require('./middleware/auth');
const { csrfProtection } = require('./middleware/csrf');
const { flashMessages } = require('./middleware/flash');
const { displayPreferences } = require('./middleware/display');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const { securityHeaders, rateLimit } = require('./middleware/security');
const { PrismaSessionStore } = require('./config/sessionStore');
const prisma = require('./config/prisma');

const app = express();
app.disable('x-powered-by');

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');

// Toolforge (and most hosts) put one proxy in front of the app; needed for secure cookies and client IPs.
if (env.nodeEnv === 'production') app.set('trust proxy', 1);

app.use(securityHeaders);

// One line per request in production (static files excluded), for the host's log.
if (env.nodeEnv === 'production') {
  app.use((req, res, next) => {
    if (/^\/(vendor|css|js|images)\//.test(req.path)) return next();
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      console.log(`${req.method} ${req.originalUrl.split('?')[0]} ${res.statusCode} ${ms.toFixed(0)}ms`);
    });
    next();
  });
}

// For uptime checks: the app is up and the database answers.
app.get('/healthz', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok' });
  } catch {
    res.status(503).json({ status: 'database unavailable' });
  }
});

Object.assign(app.locals, format, contestLabels, { EVENT_TYPES, FEATURE_DEFAULTS }, {
  PLATFORM_ROLES,
  EVENT_ROLES,
  TIMEZONES,
  FEATURE_FIELDS,
  DATE_FIELDS,
  PARTICIPATION_MODES,
  eventWikiScope,
  LAYOUTS: layouts.LAYOUTS,
  layoutHtmlAttributes: layouts.htmlAttributes,
  demoMode: env.demoMode,
});

app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: env.nodeEnv === 'production' ? '1d' : 0 }));
// Self-hosted: Toolforge forbids loading assets from third-party CDNs.
const vendor = (pkg) => express.static(path.join(__dirname, '..', 'node_modules', pkg, 'dist'), { maxAge: '7d' });
app.use('/vendor/tabler', vendor('@tabler/core'));
app.use('/vendor/tabler-icons', vendor('@tabler/icons-webfont'));
app.use('/vendor/apexcharts', vendor('apexcharts'));
app.use('/vendor/tom-select', vendor('tom-select'));

// Defaults so the layout can always render, even for early errors.
app.use((req, res, next) => {
  res.locals.currentUser = null;
  res.locals.csrfToken = '';
  res.locals.can = () => false;
  res.locals.currentPath = req.path;
  res.locals.layoutKey = layouts.DEFAULT_LAYOUT;
  res.locals.ui = { wide: false, textLarge: false };
  next();
});

app.use(express.urlencoded({ extended: false, limit: '200kb' }));
app.use(express.json({ limit: '100kb' }));

// Per-IP limits: generous for browsing, tighter for changes, login and lookups.
app.use(rateLimit({ windowMs: 60 * 1000, max: 600 }));
app.use(rateLimit({ windowMs: 60 * 1000, max: 60, methods: ['POST'] }));
app.use(['/login', '/oauth'], rateLimit({ windowMs: 10 * 60 * 1000, max: 30 }));
app.use('/api', rateLimit({ windowMs: 60 * 1000, max: 120 }));

// Sessions live in the database so logins survive restarts.
app.use(
  session({
    name: 'zury.sid',
    secret: env.sessionSecret,
    store: new PrismaSessionStore({ prune: env.nodeEnv !== 'test' }),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: env.nodeEnv === 'production',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    },
  }),
);

app.use(attachUser);
// Wiki and language names (English and the language's own) for the views.
app.use(async (req, res, next) => {
  try {
    const names = await require('./wiki/catalogService').names();
    const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const both = ({ name, localName }) => (localName ? `${name} · ${localName}` : name);
    Object.assign(res.locals, {
      wikiName: (db) => (db ? names.wiki(db).name : ''),
      langName: (code) => (code ? names.language(code).name : ''),
      // Plain text: "Bangla Wikipedia · বাংলা উইকিপিডিয়া".
      wikiText: (db) => (db ? both(names.wiki(db)) : ''),
      langText: (code) => (code ? both(names.language(code)) : ''),
      // HTML: the English name with the local one beside it, muted.
      wikiLabel: (db) => {
        if (!db) return '';
        const w = names.wiki(db);
        return `<span title="${esc(db)}">${esc(w.name)}</span>${w.localName ? ` <span class="text-secondary">${esc(w.localName)}</span>` : ''}`;
      },
      langLabel: (code) => {
        if (!code) return '';
        const l = names.language(code);
        return `<span title="${esc(code)}">${esc(l.name)}</span>${l.localName ? ` <span class="text-secondary">${esc(l.localName)}</span>` : ''}`;
      },
    });
    next();
  } catch (err) {
    next(err);
  }
});
app.use(displayPreferences);
app.use(csrfProtection);
app.use(flashMessages);

app.use('/', require('./routes/preferences'));
app.use('/', require('./routes'));
app.use('/', require('./routes/auth'));
app.use('/', require('./routes/users'));
app.use('/', require('./routes/account'));
app.use('/', require('./routes/api'));
app.use('/', require('./routes/admin'));
if (env.demoMode) app.use('/', require('./routes/demo'));
// Last: event series addresses (/wam/2026) must not shadow other pages.
app.use('/', require('./routes/events'));

app.use(notFound);
app.use(errorHandler);

module.exports = app;

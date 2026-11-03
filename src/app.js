const path = require('path');
const express = require('express');
const session = require('express-session');
const expressLayouts = require('express-ejs-layouts');

const env = require('./config/env');
const format = require('./utils/format');
const contestLabels = require('./utils/contestLabels');
const { PLATFORM_ROLES, EVENT_ROLES } = require('./permissions/registry');
const { attachUser } = require('./middleware/auth');
const { csrfProtection } = require('./middleware/csrf');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');

if (env.nodeEnv === 'production') app.set('trust proxy', 1);

Object.assign(app.locals, format, contestLabels, { PLATFORM_ROLES, EVENT_ROLES, demoMode: env.demoMode });

app.use(express.static(path.join(__dirname, '..', 'public')));

// Defaults so the layout can always render, even for early errors.
app.use((req, res, next) => {
  res.locals.currentUser = null;
  res.locals.csrfToken = '';
  res.locals.can = () => false;
  next();
});

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Uses the default in-memory store: sessions survive for 30 days but not a
// server restart. Swap in a persistent store before production.
app.use(
  session({
    name: 'zury.sid',
    secret: env.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: env.nodeEnv === 'production',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    },
  }),
);

app.use(attachUser);
app.use(csrfProtection);

app.use('/', require('./routes'));
app.use('/', require('./routes/auth'));
app.use('/', require('./routes/users'));
app.use('/', require('./routes/account'));
app.use('/', require('./routes/events'));
app.use('/', require('./routes/admin'));
if (env.demoMode) app.use('/', require('./routes/demo'));

app.use(notFound);
app.use(errorHandler);

module.exports = app;

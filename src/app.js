const path = require('path');
const express = require('express');
const expressLayouts = require('express-ejs-layouts');

const routes = require('./routes');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/', routes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;

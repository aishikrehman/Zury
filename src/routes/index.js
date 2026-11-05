const express = require('express');
const homeController = require('../controllers/homeController');
const authController = require('../controllers/authController');

const router = express.Router();

// Meta-Wiki returns users to the registered callback (the site root) with these params.
// Search engines: what to skip, and every public event and series.
router.get('/robots.txt', (req, res) => {
  const origin = `${req.protocol}://${req.get('host')}`;
  res.type('text/plain').send(['User-agent: *', 'Disallow: /admin', 'Disallow: /api', 'Disallow: /settings', 'Disallow: /dashboard', 'Disallow: /review', 'Disallow: /login', 'Disallow: /*/export/', `Sitemap: ${origin}/sitemap.xml`, ''].join('\n'));
});

router.get('/sitemap.xml', async (req, res, next) => {
  try {
    const prisma = require('../config/prisma');
    const { eventPath } = require('../utils/format');
    const origin = `${req.protocol}://${req.get('host')}`;
    const [events, series] = await Promise.all([
      prisma.contest.findMany({ where: { deletedAt: null, visibility: 'public', status: { notIn: ['draft'] } }, select: { id: true, slug: true, path: true, updatedAt: true, series: { select: { slug: true } }, wikis: { where: { status: 'active' }, select: { code: true } } } }),
      prisma.eventSeries.findMany({ select: { slug: true, createdAt: true } }),
    ]);
    const url = (loc, at) => `<url><loc>${origin}${loc}</loc>${at ? `<lastmod>${new Date(at).toISOString().slice(0, 10)}</lastmod>` : ''}</url>`;
    const urls = [url('/'), url('/events'), ...series.map((sr) => url(`/${sr.slug}`, sr.createdAt))];
    for (const e of events) {
      const base = eventPath(e);
      urls.push(url(base, e.updatedAt), url(`${base}/results`, e.updatedAt));
      if (e.wikis.length > 1) for (const w of e.wikis) urls.push(url(`${base}/${w.code}`, e.updatedAt));
    }
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`);
  } catch (err) {
    next(err);
  }
});

router.get('/', (req, res, next) => {
  if (req.query.oauth_verifier && req.query.oauth_token) return authController.callback(req, res, next);
  return homeController.index(req, res, next);
});
// There is no About page any more; old links go home.
router.get('/about', (req, res) => res.redirect(301, '/'));

module.exports = router;

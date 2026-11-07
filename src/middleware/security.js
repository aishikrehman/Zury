// Security headers and simple per-IP rate limits. Self-contained: Toolforge
// allows no third-party assets, so the policy only trusts this site and the
// Wikimedia hosts pages link to or load images from.
const env = require('../config/env');

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // ApexCharts and Tabler set inline styles.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://upload.wikimedia.org https://commons.wikimedia.org",
  "font-src 'self' data:",
  "connect-src 'self' https://*.wikipedia.org https://*.wiktionary.org https://*.wikibooks.org https://*.wikinews.org https://*.wikiquote.org https://*.wikisource.org https://*.wikiversity.org https://*.wikivoyage.org https://*.wikimedia.org https://www.wikidata.org",
  // The review window shows the entry's page from its wiki.
  "frame-src 'self' https://*.wikipedia.org https://*.wiktionary.org https://*.wikibooks.org https://*.wikinews.org https://*.wikiquote.org https://*.wikisource.org https://wikisource.org https://*.wikiversity.org https://*.wikivoyage.org https://*.wikimedia.org https://www.wikidata.org https://www.mediawiki.org",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self' https://meta.wikimedia.org",
  "object-src 'none'",
].join('; ');

function securityHeaders(req, res, next) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (env.nodeEnv === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.removeHeader('X-Powered-By');
  next();
}

/**
 * Fixed-window limiter kept in memory (one process). `max` requests per
 * `windowMs` per client IP; anything over gets 429.
 */
function rateLimit({ windowMs, max, methods = null, message = 'Too many requests. Please wait a moment and try again.', inTests = false }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) if (entry.reset <= now) hits.delete(key);
  }, windowMs).unref();

  return (req, res, next) => {
    if (methods && !methods.includes(req.method)) return next();
    if (env.nodeEnv === 'test' && !inTests) return next();
    const key = req.ip;
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.reset <= now) {
      entry = { count: 0, reset: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, max - entry.count)));
    if (entry.count <= max) return next();
    res.setHeader('Retry-After', String(Math.ceil((entry.reset - now) / 1000)));
    if (req.path.startsWith('/api/')) return res.status(429).json({ error: message });
    res.status(429).render('pages/error', { title: 'Slow Down', message });
  };
}

module.exports = { securityHeaders, rateLimit, CSP };

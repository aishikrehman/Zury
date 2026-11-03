// Serves /{wiki}/api.php with canned MediaWiki Action API responses.
const http = require('http');

function createMockWikiApi(pages, entities = {}) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const wiki = url.pathname.split('/')[1];
    const p = Object.fromEntries(url.searchParams);
    requests.push({ wiki, ...p, userAgent: req.headers['user-agent'] });
    const send = (body) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (p.action === 'wbgetentities') {
      const e = entities[p.ids];
      return send({ entities: { [p.ids]: e || { id: p.ids, missing: '' } } });
    }
    const key = p.pageids ? Object.keys(pages).find((k) => pages[k].pageid === Number(p.pageids)) : `${wiki}|${p.titles}`;
    const page = pages[key];
    send({ batchcomplete: true, query: { pages: [page ? { ns: 0, ...page } : { ns: 0, title: p.titles, missing: true }] } });
  });
  return {
    requests,
    async start() {
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      return `http://127.0.0.1:${server.address().port}/{wiki}/api.php`;
    },
    stop: () => new Promise((r) => server.close(r)),
  };
}

module.exports = { createMockWikiApi };

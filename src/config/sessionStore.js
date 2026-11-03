// express-session store backed by the app database, so logins survive restarts.
const session = require('express-session');
const prisma = require('./prisma');

const DAY_MS = 24 * 60 * 60 * 1000;
const PRUNE_MS = 60 * 60 * 1000;

class PrismaSessionStore extends session.Store {
  constructor({ client = prisma, prune = true } = {}) {
    super();
    this.client = client;
    if (prune) setInterval(() => this.prune().catch((err) => console.error('Session prune failed:', err.message)), PRUNE_MS).unref();
  }

  static expiry(sess) {
    return sess?.cookie?.expires ? new Date(sess.cookie.expires) : new Date(Date.now() + DAY_MS);
  }

  get(sid, cb) {
    this.client.session
      .findUnique({ where: { sid } })
      .then((row) => cb(null, row && row.expiresAt > new Date() ? JSON.parse(row.data) : null))
      .catch(cb);
  }

  set(sid, sess, cb = () => {}) {
    const data = JSON.stringify(sess);
    const expiresAt = PrismaSessionStore.expiry(sess);
    this.client.session
      .upsert({ where: { sid }, update: { data, expiresAt }, create: { sid, data, expiresAt } })
      .then(() => cb(null))
      .catch(cb);
  }

  touch(sid, sess, cb = () => {}) {
    this.client.session
      .updateMany({ where: { sid }, data: { expiresAt: PrismaSessionStore.expiry(sess) } })
      .then(() => cb(null))
      .catch(cb);
  }

  destroy(sid, cb = () => {}) {
    this.client.session
      .deleteMany({ where: { sid } })
      .then(() => cb(null))
      .catch(cb);
  }

  async prune() {
    const { count } = await this.client.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    return count;
  }
}

module.exports = { PrismaSessionStore };

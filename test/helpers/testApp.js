// Boots the real Express app against a throwaway SQLite database.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

async function startTestApp(extraEnv = {}) {
  const dbFile = path.join(os.tmpdir(), `zury-test-${process.pid}-${Date.now()}.db`);
  Object.assign(process.env, {
    NODE_ENV: 'test',
    SESSION_SECRET: 'test-secret',
    DATABASE_URL: `file:${dbFile.replace(/\\/g, '/')}`,
    WIKIMEDIA_CALLBACK_URL: 'http://127.0.0.1:5000/',
    ...extraEnv,
  });
  try {
    execSync('npx prisma migrate deploy', { env: process.env, stdio: 'pipe' });
  } catch (err) {
    throw new Error(`prisma migrate deploy failed:\n${err.stdout}\n${err.stderr}`);
  }

  const app = require('../../src/app');
  const prisma = require('../../src/config/prisma');
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  async function request(pathname, { cookie, method = 'GET', form } = {}) {
    const res = await fetch(baseUrl + pathname, {
      method,
      redirect: 'manual',
      headers: {
        ...(cookie && { Cookie: cookie }),
        ...(form && { 'Content-Type': 'application/x-www-form-urlencoded' }),
      },
      body: form && new URLSearchParams(Object.entries(form).flatMap(([k, v]) => [].concat(v).map((x) => [k, x]))).toString(),
    });
    const setCookie = res.headers.getSetCookie().find((c) => c.startsWith('zury.sid='));
    return {
      status: res.status,
      location: res.headers.get('location'),
      cookie: setCookie ? setCookie.split(';')[0] : null,
      body: await res.text(),
    };
  }

  async function stop() {
    await new Promise((resolve) => server.close(resolve));
    await prisma.$disconnect();
    for (const f of [dbFile, `${dbFile}-journal`]) fs.rmSync(f, { force: true });
  }

  return { prisma, request, stop, baseUrl };
}

const csrfFrom = (html) => html.match(/name="_csrf" value="([^"]+)"/)[1];

module.exports = { startTestApp, csrfFrom };

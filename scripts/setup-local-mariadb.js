// One-time setup on a developer's computer: creates the "zury" MariaDB user with a
// random password and the zury database. Writes DATABASE_URL into .env; the password is never printed.
// Needs a MariaDB server on 127.0.0.1:3306 whose root can log in without a password
// (a fresh mariadb-install-db). Usage: node scripts/setup-local-mariadb.js
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const client = process.env.MARIADB_CLIENT || 'C:\\Program Files\\MariaDB 13.0\\bin\\mariadb.exe';
const password = crypto.randomBytes(18).toString('base64url');
const sql = `
CREATE DATABASE IF NOT EXISTS zury CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'zury'@'localhost' IDENTIFIED BY '${password}';
ALTER USER 'zury'@'localhost' IDENTIFIED BY '${password}';
CREATE USER IF NOT EXISTS 'zury'@'127.0.0.1' IDENTIFIED BY '${password}';
ALTER USER 'zury'@'127.0.0.1' IDENTIFIED BY '${password}';
GRANT ALL PRIVILEGES ON zury.* TO 'zury'@'localhost', 'zury'@'127.0.0.1';
FLUSH PRIVILEGES;
`;
execFileSync(client, ['-u', 'root', '-h', '127.0.0.1', '-P', '3306'], { input: sql, stdio: ['pipe', 'inherit', 'inherit'] });

const envFile = path.join(__dirname, '..', '.env');
const url = `mysql://zury:${password}@127.0.0.1:3306/zury`;
let env = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : '';
env = env.replace(/^DATABASE_URL=(?!mysql:).*$/m, (line) => `# Before MariaDB: ${line}`);
env = /^DATABASE_URL=mysql:.*$/m.test(env) ? env.replace(/^DATABASE_URL=mysql:.*$/m, `DATABASE_URL=${url}`) : `${env.trimEnd()}\nDATABASE_URL=${url}\n`;
fs.writeFileSync(envFile, env);
console.log('MariaDB user "zury" and database "zury" are ready; DATABASE_URL is in .env.');

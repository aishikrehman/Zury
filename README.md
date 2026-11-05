# Zury

Writing contests and editathons for Wikimedia projects: events, series and editions, entries, jury review, appeals and results. English and Bangla.

## Requirements

- Node.js 20 or newer
- MariaDB 10.6 or newer

## Local setup

```bash
npm install
cp .env.example .env
npm run db:setup-local   # creates the zury MariaDB user and database, fills DATABASE_URL
npm start                # takes a backup, applies migrations, starts on PORT
```

Give yourself the superuser role after your first login: `npm run admin:grant -- <username>`.

## Wikimedia OAuth

Register an OAuth 1.0a consumer on Meta-Wiki with the callback URL from `WIKIMEDIA_CALLBACK_URL`, then put the key and secret in `WIKIMEDIA_CONSUMER_KEY` and `WIKIMEDIA_CONSUMER_SECRET`. Never commit them.

## Database safety

- `npm start` only runs `prisma migrate deploy`; it never resets the database.
- A gzip JSON backup is written before each start (when there is data), once a day, and on demand from Admin → Maintenance. The last 14 are kept in `ZURY_BACKUP_DIR` (default `backups/`).
- `npm run db:restore -- <file>` loads a backup into an empty database.

## Toolforge

Zury runs on the Build Service as the `zury` tool, on ToolsDB.

```bash
toolforge envvars create ZURY_DB toolsdb
toolforge envvars create ZURY_BACKUP_DIR /data/project/zury/backups
toolforge build start https://github.com/aishikrehman/Zury.git
webservice buildservice restart
```

Set `NODE_ENV=production`, `SESSION_SECRET`, `WIKIMEDIA_CALLBACK_URL` and the OAuth key and secret as envvars too.

## Scripts

| Script | Does |
| --- | --- |
| `npm start` | Backup, migrate, start |
| `npm run dev` | Start with reload |
| `npm run build:assets` | Build `public/css/style.css` (from `src/styles/zury.css` and trimmed Tabler) and the icon font |
| `npm run admin:grant` | Grant the superuser role |
| `npm run wikis:sync` | Refresh the list of Wikimedia wikis |
| `npm run db:setup-local` | Create the local MariaDB user and database |
| `npm run db:restore` | Restore a backup into an empty database |

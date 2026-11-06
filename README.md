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

### Updating Toolforge to the latest code on GitHub

Push to `main` first. Then, from your own computer's terminal (PowerShell or any shell with `ssh`):

```bash
ssh aishik@login.toolforge.org "sudo -niu tools.zury toolforge build start https://github.com/aishikrehman/Zury.git"
```

Wait until the build has finished. Check with this; the newest line must say `ok`:

```bash
ssh aishik@login.toolforge.org "sudo -niu tools.zury toolforge build list"
```

Then restart on the new build, and check the new pod after a minute:

```bash
ssh aishik@login.toolforge.org "sudo -niu tools.zury webservice buildservice restart"
```

```bash
ssh aishik@login.toolforge.org "sudo -niu tools.zury kubectl get pods"
```

The new pod must be `Running` with no `CrashLoopBackOff`. `https://zury.toolforge.org/healthz` answering 200 is not enough on its own: an old pod can keep answering while the new one fails. Database migrations run when the new pod starts, after a backup in `/data/project/zury/backups`; if a pod keeps restarting, its logs say why:

```bash
ssh aishik@login.toolforge.org "sudo -niu tools.zury webservice buildservice logs"
```

The same steps in one go (start the build, wait for it, restart, show the pods): `zury-toolsdb-deploy.sh` in the tool's home on Toolforge:

```bash
ssh aishik@login.toolforge.org "tr -d '\r' < zury-toolsdb-deploy.sh | bash"
```

If its build log stream fails ("container … is not available"), the build itself usually still finishes: check `build list`, then run the restart command above once it says `ok`.

## Scripts

| Script | Does |
| --- | --- |
| `npm start` | Backup, migrate, start |
| `npm run dev` | Start with reload |
| `npm run build:assets` | Build `public/css/style.css` (from `src/styles/zury.css`) and the icon font |
| `npm run admin:grant` | Grant the superuser role |
| `npm run wikis:sync` | Refresh the list of Wikimedia wikis |
| `npm run db:setup-local` | Create the local MariaDB user and database |
| `npm run db:restore` | Restore a backup into an empty database |

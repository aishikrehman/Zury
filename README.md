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

Everything below runs from your own computer's terminal (PowerShell, or any shell with `ssh`). Each command logs in to Toolforge, runs one step as the `zury` tool, and comes back. Toolforge builds from GitHub, so it only sees what is pushed to `main`.

**Step 1: Get the code ready on your computer.**

1. If you changed any CSS or added icons, rebuild the assets (it writes `public/css/style.css` and the icon font):

   ```bash
   npm run build:assets
   ```

2. Commit and push to `main`:

   ```bash
   git push origin main
   ```

3. Check that GitHub has your latest commit. The first line must be the commit you expect:

   ```bash
   git log origin/main --oneline -1
   ```

**Step 2: Start the build on Toolforge.**

```bash
ssh aishik@login.toolforge.org "sudo -niu tools.zury toolforge build start https://github.com/aishikrehman/Zury.git"
```

This builds a new image from GitHub's `main` and takes about a minute. It may print `container "prepare" ... is not available` while it tries to stream the log. That is only the log stream failing, and the build usually goes on anyway. Go to step 3.

**Step 3: Wait until the build has finished.**

```bash
ssh aishik@login.toolforge.org "sudo -niu tools.zury toolforge build list"
```

The newest line (at the top) must say `ok` in the `status` column, and its `end_time` must be filled in. While it says `running` or `pending`, wait half a minute and run it again. If it says `failed`, the build log says why:

```bash
ssh aishik@login.toolforge.org "sudo -niu tools.zury toolforge build logs"
```

Do not restart before the build says `ok`. A restart during the build starts the old image again.

**Step 4: Restart Zury on the new build.**

```bash
ssh aishik@login.toolforge.org "sudo -niu tools.zury webservice buildservice restart"
```

It prints `Restarting...` and comes back after about a minute.

**Step 5: Check that the new pod is running.**

```bash
ssh aishik@login.toolforge.org "sudo -niu tools.zury kubectl get pods"
```

There must be one pod with `STATUS` `Running`, `READY` `1/1` and a small `AGE` (it started after step 4). `CrashLoopBackOff` or `Error` means the new code fails to start. Go to step 7.

**Step 6: Check that it runs the new code and that the database migrations ran.**

```bash
ssh aishik@login.toolforge.org "sudo -niu tools.zury webservice buildservice logs" | grep -E "Backup before start|migrations found|Applying|applied|running at"
```

You should see, in this order:

1. `Backup before start: /data/project/zury/backups/…`: a backup of the database, made before anything changed.
2. `N migrations found in prisma/migrations`: N must be the number of folders in `prisma/migrations` on your computer. A smaller number means the pod started on the old image, so go back to step 3, then step 4.
3. `Applying migration …` for each new migration, then `All migrations have been successfully applied.` (or `No pending migrations to apply.` when nothing in the database changed).
4. `Zury is running at …`.

Then open https://zury.toolforge.org and try the pages you changed. `https://zury.toolforge.org/healthz` answering 200 is not enough on its own, because an old pod can keep answering while the new one fails.

**Step 7: If something went wrong.**

- **The pod keeps restarting:** read its logs (the last lines say why):

  ```bash
  ssh aishik@login.toolforge.org "sudo -niu tools.zury webservice buildservice logs" | tail -40
  ```

- **A migration failed:** the log names the migration and the database error. Fix the migration on your computer, push it, and start again from step 2. Migrations never delete data, and the backup from step 6 is kept.
- **Going back to the previous code:** revert the commit on your computer (`git revert <commit>`), push, and run steps 2 to 6 again.
- **Restoring the database from a backup** (only if data is really wrong): the backups are in `/data/project/zury/backups`, newest last. `npm run db:restore -- <file>` loads one into an empty database. Ask before doing this on the live tool.

**All steps in one go.** `zury-toolsdb-deploy.sh` in the tool's home on Toolforge runs steps 2 to 5: it starts the build, waits for it, restarts, and shows the pods.

```bash
ssh aishik@login.toolforge.org "tr -d '\r' < zury-toolsdb-deploy.sh | bash"
```

If its log stream fails ("container … is not available"), it may restart before the build has finished. Always do step 6 afterwards. If the migration count is too small, run `build list` until it says `ok`, then the restart from step 4 once more.

**Other useful commands.**

- See the tool's settings (envvars; secret values are hidden):

  ```bash
  ssh aishik@login.toolforge.org "sudo -niu tools.zury toolforge envvars list"
  ```

- Remove old build images (keeps the current one):

  ```bash
  ssh aishik@login.toolforge.org "sudo -niu tools.zury toolforge build clean"
  ```

- Follow the live log while you test (stop with Ctrl+C):

  ```bash
  ssh aishik@login.toolforge.org "sudo -niu tools.zury webservice buildservice logs -f"
  ```

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

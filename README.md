# Zury

A unified platform for Wikimedia contests and community events.

## Status

| Phase | Scope | State |
|---|---|---|
| 1 | Express + EJS + Bootstrap 5 + SQLite/Prisma foundation, layout, public pages, error handling | Done |
| 2 | Wikimedia OAuth 1.0a login/logout, sessions, user sync, public profiles, dashboard, preferences | Done (tested against a mock wiki; not yet against Meta-Wiki with real keys) |
| 3 | Permission registry, platform/wiki/event roles, authorization, admin panel, audit log, demo data | Done |
| 4+ | Event creation/editing, submissions, jury, appeals, communications, results, analytics | Not started |

## Requirements

- Node.js 18+

## Setup

```bash
npm install
cp .env.example .env
npx prisma migrate deploy
npm run seed
npm run dev
```

The app runs at http://127.0.0.1:5000. Use `127.0.0.1`, not `localhost`: the
OAuth callback is registered for `http://127.0.0.1:5000/`, and the session
cookie is tied to the host you log in on.

## Demo mode

With `DEMO_MODE=true` (the default in `.env.example`), `npm run seed` loads
sample users, events, roles and audit entries, and `/demo` lets you log in as
any demo user without Wikimedia OAuth. Demo users cover every role: Steward,
Global Sysop, a local admin on bnwiki, a platform administrator, an organizer,
a juror, a participant and a newcomer with no roles.

Demo login is disabled whenever `NODE_ENV=production`, whatever `DEMO_MODE`
says. Re-running the seed replaces earlier demo data and never touches real
users or events. Demo users have negative Wikimedia IDs so they can't clash
with real accounts.

## Permissions

All permissions and the roles that bundle them are defined in
[`src/permissions/registry.js`](src/permissions/registry.js); the database only
records who holds which role. There are three separate kinds of role:

- **Wikimedia-derived platform roles** — Steward and Global Sysop (from global
  groups) and Local Admin (from `sysop` on a wiki, effective only for events
  whose primary wiki is that wiki). Verified via `meta=globaluserinfo` at login
  and refreshed daily; rights not re-verified within 7 days stop counting. They
  can't be granted inside Zury.
- **Zury platform roles** — Platform Administrator, which runs Zury itself
  (admin panel, audit log, role grants) and has no authority over events.
- **Event roles** — Organizer, Jury, Participant, Viewer, per event. A user can
  hold several. Per-event overrides can add or remove event permissions but can
  never reduce platform authority.

Every protected route checks permissions on the server with
`requirePermission(...)`; templates use `can(...)` only to decide what to show.
Private and draft events return 404 to anyone who can't see them.

To make the first platform administrator (they must have logged in once):

```bash
npm run admin:grant -- "Username"
```

After that, administrators grant and revoke the role at `/admin/users`. Every
grant, revoke and change in verified rights is recorded in the audit log.

## Wikimedia OAuth

Zury uses an OAuth 1.0a consumer registered on Meta-Wiki
(`Special:OAuthConsumerRegistration`). Put its credentials in `.env`:

```env
WIKIMEDIA_CONSUMER_KEY=...
WIKIMEDIA_CONSUMER_SECRET=...
WIKIMEDIA_CALLBACK_URL=http://127.0.0.1:5000/
```

The consumer has callback override enabled with the registered URL as a
required prefix, so Zury sends `http://127.0.0.1:5000/auth/callback`. If a
consumer secret has ever been shared outside `.env`, treat it as exposed and
reset it on Meta-Wiki before relying on it.

Login flow: `/login` gets a request token from `Special:OAuth/initiate`,
sends the user to `Special:OAuth/authorize`, and `/auth/callback` exchanges the
verifier at `Special:OAuth/token`. Zury then calls `Special:OAuth/identify` and
verifies the returned JWT (signature, audience, issuer, nonce, expiry) before
trusting the username and central user ID. OAuth access tokens are not stored.

Optional: `WIKIMEDIA_OAUTH_BASE_URL` overrides the OAuth wiki
(default `https://meta.wikimedia.org/w/index.php`).

## Known limitations

- Sessions use the in-memory store, so everyone is logged out when the server
  restarts. Needs a persistent store before production.
- Avatars aren't populated; Wikimedia OAuth doesn't provide one.
- Event pages are read-only; creating and editing events is Phase 4.

## Scripts

- `npm run dev` — start the server with auto-reload
- `npm start` — start the server
- `npm run seed` — load (or reload) demo data
- `npm run admin:grant -- "Username"` — make a user a platform administrator
- `npm test` — run tests (throwaway SQLite databases and a mock MediaWiki
  server; no network or real credentials needed)
- `npm run prisma:migrate` — create/apply migrations in development
- `npm run prisma:generate` — regenerate the Prisma client

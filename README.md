# Zury

A unified platform for Wikimedia contests and community events.

## Status

| Phase | Scope | State |
|---|---|---|
| 1 | Express + EJS + Bootstrap 5 + SQLite/Prisma foundation, layout, public pages, error handling | Done |
| 2 | Wikimedia OAuth 1.0a login/logout, sessions, user sync, public profiles, dashboard, preferences | Done (tested against a mock wiki; not yet against Meta-Wiki with real keys) |
| 3+ | Permissions, events, submissions, jury, appeals, communications, results, analytics | Not started |

## Requirements

- Node.js 18+

## Setup

```bash
npm install
cp .env.example .env
npx prisma migrate deploy
npm run dev
```

The app runs at http://127.0.0.1:5000. Use `127.0.0.1`, not `localhost`: the
OAuth callback is registered for `http://127.0.0.1:5000/`, and the session
cookie is tied to the host you log in on.

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
trusting the username and central user ID. The home wiki is looked up via
`meta=globaluserinfo`. OAuth access tokens are not stored.

Optional: `WIKIMEDIA_OAUTH_BASE_URL` overrides the OAuth wiki
(default `https://meta.wikimedia.org/w/index.php`).

## Known limitations

- Sessions use the in-memory store, so everyone is logged out when the server
  restarts. Needs a persistent store before production.
- Avatars aren't populated; Wikimedia OAuth doesn't provide one.

## Scripts

- `npm run dev` — start the server with auto-reload
- `npm start` — start the server
- `npm test` — run tests (uses a throwaway SQLite database and a mock
  MediaWiki OAuth server; no network or real credentials needed)
- `npm run prisma:migrate` — create/apply migrations in development
- `npm run prisma:generate` — regenerate the Prisma client

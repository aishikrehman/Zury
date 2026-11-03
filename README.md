# Zury

A unified platform for Wikimedia contests and community events.

## Status

Phase 1 (foundation) only: Express + EJS + Bootstrap 5 + SQLite/Prisma, a shared
layout, the public homepage/about pages, navigation, and error handling. Wikimedia
OAuth login, permissions, event management, submissions, jury review, appeals,
communications, badges, results, and analytics are not implemented yet — see the
project roadmap for the phased plan.

## Requirements

- Node.js 18+

## Setup

```bash
npm install
cp .env.example .env
npm run prisma:migrate
npm run dev
```

The app runs at http://127.0.0.1:5000.

## Environment variables

See `.env.example`. `WIKIMEDIA_CONSUMER_KEY` / `WIKIMEDIA_CONSUMER_SECRET` are only
needed once OAuth login is implemented (Phase 2); they are unused for now. Never
commit real values — `.env` is gitignored.

## Scripts

- `npm run dev` — start the server with auto-reload
- `npm start` — start the server
- `npm run prisma:migrate` — run Prisma migrations against the local SQLite database
- `npm run prisma:generate` — regenerate the Prisma client
- `npm test` — run tests

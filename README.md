# PTA Mailer

Standalone mailing list app for a school PTA: double opt-in family subscriptions,
officer-composed branded newsletters, SES delivery.

Stack: Next.js (App Router, TypeScript), Postgres + Drizzle ORM, Vitest.

## Local setup

```sh
cp .env.example .env.local        # fill in values
npm install
npm run db:migrate                # apply migrations in drizzle/
npm run db:seed                   # fake data (refuses NODE_ENV=production)
npm run dev
```

First admin: set `BOOTSTRAP_ADMIN_EMAIL` and run `npm run db:bootstrap-admin`
(sign-in will also invoke it once auth lands). It becomes a permanent no-op as
soon as any active admin exists.

## Schema changes

Edit `src/db/schema.ts`, then `npm run db:generate -- --name <change>` and commit
the generated SQL in `drizzle/`.

## Tests

Tests run against a real Postgres at `TEST_DATABASE_URL`; the global setup drops
and rebuilds that database's schema from the migrations on every run. Never point
it at a database you care about.

```sh
npm test
```

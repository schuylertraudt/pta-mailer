# PTA Mailer

Standalone mailing list app for a school PTA. Families subscribe by email only
(double opt-in, one-click unsubscribe). Officers sign in with Google, compose
branded newsletters in a block editor, and send through Amazon SES.

- Launch steps: [docs/LAUNCH.md](docs/LAUNCH.md)
- Running it year to year: [docs/OPERATIONS.md](docs/OPERATIONS.md)

## Stack

Next.js 16 (App Router, route handlers) · TypeScript · Postgres + Drizzle ORM ·
Auth.js v5 (Google, database sessions) · TipTap editor · React Email · sharp ·
S3-compatible storage (R2/S3/Supabase) · Amazon SES (provider interface) · Vitest.

## Local development

```sh
cp .env.example .env.local      # defaults work for local dev except Google sign-in
npm install
npm run db:migrate              # migrations + starter templates
npm run db:seed                 # fake subscribers/officers (refuses NODE_ENV=production)
npm run dev
```

With `EMAIL_PROVIDER=console` mail is logged, not sent. With
`STORAGE_DRIVER=memory` uploads are served from `/dev-storage` and vanish on
restart. To use the admin UI without Google credentials, insert a session row
for a seeded officer and set the `authjs.session-token` cookie to its token.

| Command | Purpose |
| --- | --- |
| `npm test` | Full suite against real Postgres at `TEST_DATABASE_URL` (schema is dropped and rebuilt) |
| `npm run typecheck` / `npm run build` | Type check / production build |
| `npm run db:generate -- --name <change>` | New migration after editing `src/db/schema.ts` |
| `npm run db:bootstrap-admin` | Create the first admin from `BOOTSTRAP_ADMIN_EMAIL` (also runs on sign-in) |
| `npm run worker` | Long-running send worker for VM hosting (Vercel uses the cron route instead) |

## How it fits together

```
app/                       pages + route handlers (thin: parse, guard, call lib)
  page.tsx                 public subscribe form (QR target)
  confirm/, u/             confirm and unsubscribe pages (one button each)
  archive/                 public archive (stored HTML, strict CSP)
  admin/                   officer UI (composer, media, templates, subscribers, audiences, brand, officers)
  api/                     JSON endpoints, SES webhook, cron
src/db/schema.ts           the whole data model
src/lib/auth/              Google sign-in gate, Auth.js adapter, per-request guard, roles
src/lib/officers/          bootstrap, add/role/deactivate/reactivate, 2-admin floor, audit
src/lib/subscribers/       subscribe / confirm / unsubscribe / suppress; officer search, delete, CSV export
src/lib/editor/            document model, allowlist sanitizer, TipTap extensions, HTML import
src/lib/render/            React Email renderer, plaintext, size + content checks
src/lib/images/            upload pipeline (sniff, convert, rotate, strip, resize, compress)
src/lib/queue/             enqueue (freeze + fan out) and dispatch (claim, re-check, send, retry)
src/lib/webhooks/          SNS signature verification, SES bounce/complaint/inbound handling
```

Key invariants, each covered by tests:

- **Access control is server-side.** Every admin route goes through
  `requireOfficer`, which re-reads the officer's `active` flag and role from
  the database on every request and rejects cross-origin mutations.
- **Suppression wins.** `eligibleRecipientWhere` (active + confirmed + not
  suppressed) decides who is queued, and the dispatcher re-checks suppression
  and status for every message at send time.
- **At most once.** One `sends` row per (campaign, subscriber); workers claim
  rows with `FOR UPDATE SKIP LOCKED`; a row whose send outcome is unknown is
  marked failed, never retried.
- **Only allowlisted content reaches an email.** Editor JSON is rebuilt by
  `sanitizeDoc` on every save and render: known nodes/marks only, checked URLs,
  images only from the storage domain. Header and footer (with unsubscribe) are
  injected by the renderer and aren't part of the document.

## Decisions worth knowing

- **Unsubscribe link opens a page with one "Unsubscribe" button** instead of
  unsubscribing on page load. Corporate and school mail scanners open every
  link in a message, and a GET that unsubscribes would silently drop families.
  The RFC 8058 one-click header (what Gmail's and Apple Mail's unsubscribe
  buttons use) unsubscribes with no page at all. Same reasoning for the confirm
  link.
- **Officers are the Auth.js user table.** Custom adapter; `google_sub` on the
  officer row is the account link; the adapter never creates users.
- **Text colors are palette tokens** (`primary`, `accent`, neutrals), resolved
  at render time, so a brand color change applies to existing drafts.
- **Queue lives in Postgres**, driven by Vercel Cron every minute plus an
  immediate `after()` kick when Send is pressed. No extra infrastructure.
- **Uploads go browser → private bucket → server processing → public bucket**
  because Vercel functions cap request bodies at 4.5 MB. Multipart upload
  through the server remains as a fallback for self-hosting.
- **SES credentials use `SES_*` env names** because Vercel reserves `AWS_*`.

## Not verified here

The test suite uses fakes for Google, SES, SNS and object storage. These need a
real check during launch (see `docs/LAUNCH.md`):

- Google OAuth round trip (consent screen, callback URL).
- SES sending, the SNS subscription handshake, and real bounce/complaint
  notifications (use the SES mailbox simulator).
- R2/S3 presigned uploads and bucket CORS.
- Rendering in real clients (Outlook desktop, Gmail app, iOS Mail). The
  markup follows standard email practice and is snapshot-tested, but no
  rendering service was used.
- HEIC conversion: format detection is tested; decoding a real iPhone HEIC
  file is not (no fixture available).

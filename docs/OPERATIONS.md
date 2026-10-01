# Operations

Written for PTA volunteers who are not developers. Anything marked **(dev)**
needs someone comfortable with a terminal.

## Team turnover (each new school year or committee change)

1. **When new coordinators or committee members are chosen:** an outgoing admin
   opens **Team** and adds each new person by their Google email with the right role
   (admin / sender / drafter). No invite is sent; access works on their next
   Google login. Everyone is emailed when admin or sender access is granted.
2. **When someone steps down:** deactivate them. Deactivation
   signs them out immediately and cannot be undone by them. It never deletes
   anyone; reactivating restores the same record.
3. **Keep at least 2 active admins.** The app refuses any
   change that would leave fewer than two, so promote the new admins *before*
   deactivating the old ones.
4. **Once a year:** compare the Team list against your current roster of
   coordinators and committee members, and check the
   audit log at the bottom of that page. Anything you don't recognize: deactivate
   first, ask questions second.

If every admin is locked out **(dev)**: set `BOOTSTRAP_ADMIN_EMAIL` to a trusted
volunteer's Google email and redeploy; it only works while no active admin exists.
Otherwise, promote someone directly in the database and record why.

## Subscriber requests

**Subscribers** (admins and senders) lists everyone with search by email,
status and school. Admins also see Delete and Export.

- **"Please take me off the list":** they can use the unsubscribe link in any
  email. If they ask you instead, delete them and leave "add to do-not-mail
  list" ticked.
- **"Delete my data":** Delete. Tick "do-not-mail" unless they may want to
  re-subscribe later; the do-not-mail list keeps only the email address and
  why it's there.
- **Exports** download a CSV of the current search. The file contains family
  email addresses: store it only in PTA-controlled storage and delete it when
  done. Every delete and export is logged at the bottom of the page.

## Deliverability monitoring

Check after every send (the message's page → Delivery):

| Signal | Healthy | Act when |
| --- | --- | --- |
| Bounced | < 2% | > 5%: the list has stale addresses; don't import lists, rely on double opt-in |
| Complaints | < 0.1% | > 0.3%: Gmail/Yahoo start filtering. Send less often, make content more relevant, check the From name is recognizable |
| Failed | 0 | Any: open the message; `last_error` on the send rows explains why **(dev)** |

Engagement (same panel), as a share of delivered messages:

- **Clicked a link**: exact. The table under it shows each link, how many
  families clicked it, and total clicks. The unsubscribe and "View in browser"
  links aren't tracked.
- **Opened**: an estimate. Apple Mail opens every message on arrival (counted
  even if never read), Gmail counts once, and anyone blocking images is never
  counted. Compare opens between your own messages; don't treat them as
  "who read it".
- Both stay at 0 unless the SES configuration set has **Opens** and **Clicks**
  ticked (Google/Amazon guide, step 2.4). Send Preview copies aren't counted.

Monthly:
- **SES console → Reputation metrics**: bounce and complaint rates. AWS pauses
  sending at 10% bounces or 0.5% complaints.
- **Google Postmaster Tools** (<https://postmaster.google.com>, verify the
  sending domain once): domain reputation should stay *High* or *Medium*.
- **DMARC aggregate reports** arrive at the `rua` address. A free parser such as
  Postmark's DMARC digests turns them into a weekly email.

Bounces and complaints are suppressed automatically and are never mailed
again. Unsubscribes are suppressed immediately. To let someone back in after a
bounce (e.g. their mailbox was full), delete their row from `suppressions`
**(dev)** and have them subscribe again.

## Redeploying

**Vercel:** every push to `main` deploys automatically. To redeploy without a
code change: Vercel → project → Deployments → latest → ⋯ → Redeploy.

**Schema changes (dev):** `DATABASE_URL=<prod> npm run db:migrate` before (or
immediately after) deploying the commit that needs it. Migrations only add;
they are safe to run twice.

**Own Ubuntu server (dev):** follow "Updating to a new version" in
[DEPLOY_UBUNTU.md](DEPLOY_UBUNTU.md): pull, install, build, migrate, then
`sudo systemctl restart pta-web pta-worker`. After changing a setting in
`/etc/pta-mailer.env`, only the restart is needed.

## Rotating secrets

Do this when someone with access to the hosting account leaves, or yearly.
After each change, redeploy (Vercel: environment variables only apply to new
deployments).

| Secret | Where to rotate | Side effect |
| --- | --- | --- |
| `AUTH_SECRET` | `openssl rand -base64 32` → host env | Nothing visible; sessions are DB-backed. Open subscribe forms need a reload. |
| `AUTH_GOOGLE_SECRET` | Google Cloud → Credentials → client → Reset secret | None after redeploy |
| AWS keys | IAM → user → Security credentials → create new, deploy, delete old | None |
| R2/S3 keys | Cloudflare → R2 → API tokens → create new, deploy, revoke old | None |
| `CRON_SECRET` | any random string → host env | None |
| `DATABASE_URL` password | Neon/Supabase → reset password → host env | Brief errors until redeployed |

To sign every team member out at once **(dev)**: `delete from sessions;`.

## Backups and restore

- **Neon:** point-in-time restore is built in (Branches → Restore). Retention
  depends on plan; free tier is 1 day, so also take the weekly dump below.
- **Supabase:** Database → Backups (daily on paid plans).
- **Weekly dump (dev):** `pg_dump "$DATABASE_URL" -Fc -f pta-$(date +%F).dump`,
  stored somewhere the PTA controls (shared drive owned by a role account).

**Restore (dev):**
1. Create an empty database (new Neon branch or Supabase project).
2. `pg_restore --no-owner --clean --if-exists -d "<new url>" pta-YYYY-MM-DD.dump`
3. `DATABASE_URL=<new url> npm run db:migrate` (brings the schema up to date).
4. Point `DATABASE_URL` at it and redeploy.
5. Log in and spot-check the team, subscribers and the last message.

Images live in the storage bucket, not the database, and are not deleted by a
restore. Losing the bucket breaks images in old emails and the archive, so keep
bucket deletion protection on.

## Handover pack for the next tech volunteer

Store these in the PTA's shared (role-owned) password manager:
- Hosting account (Vercel or Hetzner), database provider, Cloudflare, AWS,
  Google Cloud project, domain registrar/DNS.
- A copy of this file, `docs/LAUNCH.md`, and the repository URL.

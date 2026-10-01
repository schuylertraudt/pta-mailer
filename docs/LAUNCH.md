# Launch checklist

Work through this top to bottom before the first real send. Each item names
where the setting lives. Click-by-click instructions for Google login and
Amazon SES are in [SETUP_GOOGLE_AND_AMAZON.md](SETUP_GOOGLE_AND_AMAZON.md), and
for the server in [DEPLOY_UBUNTU.md](DEPLOY_UBUNTU.md). The PTA's domain is
`atreapta.com`; the app runs at `mail.atreapta.com`; newsletters are sent from
`news.atreapta.com`.

## 1. Sending domain DNS (SPF, DKIM, DMARC)

Send from a subdomain such as `news.atreapta.com` so newsletter reputation
is separate from the PTA's everyday mail.

- [ ] **DKIM**: In SES (Configuration → Identities → Create identity → Domain),
      enable Easy DKIM (RSA 2048). Add the three `CNAME` records SES shows.
- [ ] **Custom MAIL FROM** (aligns SPF with your domain): in the same identity,
      set MAIL FROM to `bounce.news.atreapta.com`, then add:
      - `MX bounce.news.atreapta.com → 10 feedback-smtp.<region>.amazonses.com`
      - `TXT bounce.news.atreapta.com → "v=spf1 include:amazonses.com ~all"`
- [ ] **DMARC**: `TXT _dmarc.atreapta.com → "v=DMARC1; p=none; rua=mailto:dmarc@atreapta.com; adkim=r; aspf=r"`.
      After 2–4 weeks of clean aggregate reports, raise to `p=quarantine`.
- [ ] Wait for SES to show the identity as **Verified** and DKIM as **Successful**.
- [ ] Check with <https://mxtoolbox.com/SuperTool.aspx> (SPF, DKIM, DMARC lookups).

Gmail and Yahoo require SPF, DKIM, DMARC, one-click unsubscribe and a spam
complaint rate under 0.3% for bulk senders. The app handles the unsubscribe part;
the DNS above handles the rest.

## 2. Amazon SES

- [ ] Pick one region and use it everywhere (`SES_REGION`). Inbound mail for the
      unsubscribe mailto needs a receiving region (us-east-1, us-west-2 or eu-west-1).
- [ ] **Request production access** (Account dashboard → Request production
      access). Sandbox accounts can only send to verified addresses. Describe:
      school PTA newsletter, double opt-in, one-click unsubscribe, automatic
      bounce/complaint suppression, ~400 recipients, a few sends per month.
- [ ] Note the approved **max send rate**; set `SEND_RATE_PER_SECOND` at or below it.
- [ ] Create an IAM user (or role) limited to `ses:SendEmail` and
      `ses:SendRawEmail` on the identity; put its keys in `SES_ACCESS_KEY_ID` /
      `SES_SECRET_ACCESS_KEY`.
- [ ] **Bounce/complaint events**:
      1. Create an SNS topic, e.g. `pta-ses-events`.
      2. Create a configuration set (e.g. `pta-newsletter`) with an event
         destination → SNS → that topic, event types **Bounce** and **Complaint**.
      3. Set `SES_CONFIGURATION_SET=pta-newsletter` and
         `SNS_TOPIC_ARNS=<topic ARN>`.
      4. Add an HTTPS subscription on the topic to
         `https://mail.atreapta.com/api/webhooks/ses`. The app verifies the
         signature and confirms the subscription automatically; check it shows
         **Confirmed**.
- [ ] **Mailto unsubscribe** (optional but recommended):
      1. `MX news.atreapta.com → 10 inbound-smtp.<region>.amazonaws.com`.
      2. SES → Email receiving → rule set → rule for `unsubscribe@news.atreapta.com`
         with action **SNS** (same topic is fine; add its ARN to `SNS_TOPIC_ARNS`).
      3. Set `UNSUBSCRIBE_MAILTO=unsubscribe@news.atreapta.com`.
- [ ] Use the SES mailbox simulator to prove the loop: send a test newsletter to a
      committee segment containing `bounce@simulator.amazonses.com` and
      `complaint@simulator.amazonses.com` (add them as confirmed subscribers via SQL
      in a staging DB). Both must appear in `suppressions` within a minute.

## 3. Google Cloud (team login)

- [ ] Create a Google Cloud project for the PTA (owned by a PTA role account,
      not a personal one).
- [ ] OAuth consent screen: **User type External**. App name, support email
      (role address), authorized domain `atreapta.com`.
- [ ] Scopes: `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`
      only. These are non-sensitive, so no Google verification review is needed.
- [ ] **Publishing status: In production.** In "Testing", authorizations expire
      after 7 days and only listed test users can log in.
- [ ] Credentials → OAuth client ID → Web application. Authorized redirect URIs:
      - `https://mail.atreapta.com/api/auth/callback/google`
      - `http://localhost:3000/api/auth/callback/google` (development)
- [ ] Put the client ID/secret in `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`.
- [ ] Set `BOOTSTRAP_ADMIN_EMAIL` to the first admin's Google address, log in
      once, then add a **second admin** immediately (the app requires two to
      demote or deactivate any admin). You can then remove the env var; it is
      ignored anyway once an active admin exists.

## 4. Image storage bucket

Cloudflare R2 shown; S3 and Supabase Storage (S3 endpoint) work the same way.

- [ ] Create bucket `pta-images`. Enable public access **only through a custom
      domain** (e.g. `images.atreapta.com`). Do not enable the `r2.dev` URL.
      Custom-domain public access serves objects by exact key and does not list
      the bucket.
- [ ] Set `STORAGE_PUBLIC_BASE_URL=https://images.atreapta.com`.
- [ ] Create a second, **private** bucket `pta-incoming` for unprocessed
      originals (they carry EXIF/GPS until processed) and set
      `S3_INCOMING_BUCKET=pta-incoming`. Add a lifecycle rule deleting objects
      after 1 day as a safety net.
- [ ] CORS on `pta-incoming` only (browsers upload straight to it with a
      10-minute presigned URL):
      ```json
      [{ "AllowedOrigins": ["https://mail.atreapta.com"], "AllowedMethods": ["PUT"], "AllowedHeaders": ["content-type"], "MaxAgeSeconds": 3600 }]
      ```
      No CORS rule on `pta-images`.
- [ ] API token scoped to these two buckets with Object Read & Write. Set
      `S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com`,
      `S3_REGION=auto`, `S3_BUCKET=pta-images`, `S3_ACCESS_KEY_ID`,
      `S3_SECRET_ACCESS_KEY`, `STORAGE_DRIVER=s3`.

## 5. Hosting

**Vercel**
- [ ] Import the repo; set every variable from `.env.example` in Project →
      Settings → Environment Variables (Production).
- [ ] `CRON_SECRET` set: `vercel.json` schedules `/api/cron/send-queue` and
      Vercel sends the secret automatically. It runs once a day because the free
      Hobby plan refuses to deploy anything more frequent. Pressing Send already
      delivers right away (about 500 emails per run at 10/second), so daily only
      delays retries of temporary failures. On a paid plan, change the schedule
      in `vercel.json` to `* * * * *` (every minute).
- [ ] Build command runs `next build`. Run migrations from your machine against
      production before the first deploy and after every schema change:
      `DATABASE_URL=<prod url> npm run db:migrate`.

**Your own Ubuntu server (Hetzner or any VM)**
- [ ] Follow [DEPLOY_UBUNTU.md](DEPLOY_UBUNTU.md): Node 22, local PostgreSQL,
      Caddy for HTTPS, two systemd services (website and send worker), images
      on the server's disk (`STORAGE_DRIVER=local`, so section 4's bucket isn't
      needed), nightly backups.

## 6. Before the first send

- [ ] Admin → Brand: upload the logo (transparent PNG, ~400px wide), set colors,
      footer text and the **PTA mailing address** (sending is blocked until set).
- [ ] Render-test all three starter templates with "Send test to me" into:
      Gmail (web + phone app), Outlook desktop for Windows, Outlook.com, Apple
      Mail / iOS Mail. Check light and dark mode, images, buttons, two-column
      stacking on the phone, and that the unsubscribe link works. (Or use a
      Litmus / Email on Acid trial for all clients at once.)
- [ ] In Gmail, open a test → ⋮ → "Show original": SPF, DKIM, DMARC all **PASS**.
- [ ] Put the subscribe page URL on a QR code and a Facebook post.
- [ ] **First real send goes to the team only**: create a committee audience
      "Team", have each team member subscribe through the public page and
      confirm, add them to it, and send there first. Check Delivery stats,
      then send to everyone.

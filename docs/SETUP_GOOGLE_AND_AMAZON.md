# Setting up Google (team login) and Amazon (sending email)

Two one-time setups connect the app to outside services:

- **Google** lets committee members and coordinators log in with their Google
  account. It is used for identity only (name and email), never Gmail access.
- **Amazon SES** sends the newsletters and confirmation emails, and reports
  bounces and spam complaints back to the app.

Throughout, replace:

| Placeholder | Meaning | Example |
| --- | --- | --- |
| `mailer.pta.example.org` | Where the app is hosted | `news.shenpta.org` or `pta-mailer.vercel.app` |
| `pta.example.org` | The PTA's own domain | `shenpta.org` |
| `news.pta.example.org` | Subdomain newsletters are sent from | `news.shenpta.org` |

Each value you collect goes into the hosting environment variables (Vercel →
Project → Settings → Environment Variables, or the server's env file). A table
of all of them is at the end. Never paste them into email, chat or the repo.

Use a **PTA role account** (e.g. `tech@pta.example.org`), not a personal one,
as the owner of both the Google Cloud project and the AWS account, and store
its password in the PTA's password manager. Add a second person as a backup
owner on each.

---

## Part 1: Google login

Time: about 15 minutes. Cost: free.

### 1.1 Create the project

1. Go to <https://console.cloud.google.com> and log in with the PTA role account.
2. Top bar → project picker → **New project**. Name it `PTA Mailer`. Create it
   and make sure it is selected in the top bar.

### 1.2 Set up the consent screen

1. Left menu → **APIs & Services → OAuth consent screen** (it may be labelled
   **Google Auth Platform**). Click **Get started**.
2. **App information:** App name `PTA News` (this is what people see on the
   Google login screen); User support email: the PTA role address.
3. **Audience:** choose **External**. (Internal only works if every team member
   has an address in the PTA's own Google Workspace.)
4. **Contact information:** the PTA role address. Agree to the policy, **Create**.
5. **Branding** page (all optional):
   - Application home page: `https://mailer.pta.example.org`.
   - Authorized domains: the PTA's domain (e.g. `pta.example.org`) once the app
     runs on it. If you're still on a temporary `*.vercel.app` address, leave
     this empty.
   - **Leave the logo empty.** Uploading a logo makes Google require a brand
     review that can take weeks.
6. **Data Access** page → **Add or remove scopes** → tick only
   `.../auth/userinfo.email`, `.../auth/userinfo.profile` and `openid`. Save.
   These are "non-sensitive", so no Google review is needed.

### 1.3 Publish it (important)

**Audience** page → **Publish app** → confirm. The status must read
**In production**.

If it stays in "Testing", only people you list one by one as test users can
log in, and Google limits how long their approval lasts.

### 1.4 Create the login credentials

1. **Clients** page (or **Credentials → Create credentials → OAuth client ID**).
2. Application type: **Web application**. Name: `PTA Mailer`.
3. **Authorized redirect URIs** → add both:
   - `https://mailer.pta.example.org/api/auth/callback/google`
   - `http://localhost:3000/api/auth/callback/google` (for local testing)

   The address must match exactly: `https`, no trailing slash. If the app
   later moves to a new address, add the new redirect URI here too.
4. **Create.** Copy the **Client ID** and **Client secret** immediately; Google
   may not show the secret again (you can always add a new one).

### 1.5 Give the values to the app

| Variable | Value |
| --- | --- |
| `AUTH_GOOGLE_ID` | the Client ID (ends in `.apps.googleusercontent.com`) |
| `AUTH_GOOGLE_SECRET` | the Client secret |
| `AUTH_SECRET` | a random string: run `openssl rand -base64 32`, or use a password manager's generator (32+ characters) |
| `APP_URL` | `https://mailer.pta.example.org` (no trailing slash) |
| `BOOTSTRAP_ADMIN_EMAIL` | the Google email of the first admin |

### 1.6 First login

1. Redeploy so the new variables take effect.
2. The person in `BOOTSTRAP_ADMIN_EMAIL` opens the site → **Login** →
   **Sign in with Google**. They land on the Newsletters page as admin.
3. Right away, open **Team** and add a **second admin**. The app requires two
   active admins before either can be demoted or removed.
4. Add everyone else. Each person needs a Google account for the email you
   enter. Anyone without Gmail can create a free Google account for their
   existing address at <https://accounts.google.com/signup> (choose "Use my
   current email address instead").

**If login fails**, the login page says why:

| Message | Fix |
| --- | --- |
| Google shows `redirect_uri_mismatch` | The redirect URI in 1.4 doesn't exactly match the app's address |
| "isn't on the team list" | Add that exact email on the Team page (or check `BOOTSTRAP_ADMIN_EMAIL` for the first admin) |
| "linked to a different Google account" | The email was used with another Google account before. Deactivate and re-add the person, or ask a developer to clear their link |
| Google says "Access blocked: app is in testing" | Step 1.3 was skipped |

---

## Part 2: Amazon SES (sending email)

Time: about an hour of clicking, plus waiting up to a day for Amazon to approve
production sending. Cost: about $0.10 per 1,000 emails, so a few cents a month
for ~400 families.

You will need access to the domain's DNS settings (wherever the domain is
registered or hosted: GoDaddy, Cloudflare, Google Domains/Squarespace, etc.).

### 2.1 Create and secure the AWS account

1. Sign up at <https://aws.amazon.com> with the PTA role email.
2. Account menu → **Security credentials** → turn on **MFA** for the root user.
3. **Billing → Budgets** → create a monthly budget of $5 with an email alert, so
   any surprise is caught early.
4. Choose **one region** and use it for everything below. Pick **US East (N.
   Virginia) `us-east-1`** unless you have a reason not to: it supports
   receiving email, which the unsubscribe-by-email feature (2.8) needs.
   Check the region shown in the top-right of the console on every page.

### 2.2 Verify the sending domain

1. Open **Amazon SES** → **Configuration → Identities → Create identity**.
2. Identity type **Domain**; domain `news.pta.example.org`.
3. Tick **Use a custom MAIL FROM domain** → `bounce.news.pta.example.org`;
   behavior on MX failure: **Use default MAIL FROM**.
4. **Easy DKIM**, key length **RSA_2048_BIT**, publish DNS records **enabled**.
5. **Create identity.** SES shows the DNS records to add.
6. In your DNS provider, add every record SES lists:
   - three **CNAME** records for DKIM (`xxxx._domainkey.news...`)
   - one **MX** record for `bounce.news.pta.example.org` →
     `10 feedback-smtp.us-east-1.amazonses.com`
   - one **TXT** record for `bounce.news.pta.example.org` →
     `"v=spf1 include:amazonses.com ~all"`

   Some DNS providers add the domain name automatically, so you enter only the
   part before `.pta.example.org` in the name field.
7. Add a **DMARC** record (SES doesn't list this one):
   - TXT, name `_dmarc.pta.example.org`, value
     `v=DMARC1; p=none; rua=mailto:dmarc@pta.example.org`
8. Wait for SES to show the identity as **Verified** and DKIM as
   **Successful** (usually under an hour; up to 72).

### 2.3 Create the bounce/complaint notification topic

1. Open **Amazon SNS** → **Topics → Create topic**.
2. Type **Standard**, name `pta-ses-events`. Create.
3. Copy the **ARN** (looks like
   `arn:aws:sns:us-east-1:123456789012:pta-ses-events`).

### 2.4 Create the configuration set

This tells SES to report bounces and complaints to the topic.

1. **SES → Configuration → Configuration sets → Create set**. Name
   `pta-newsletter`. Create.
2. Open it → **Event destinations → Add destination**.
3. Event types: tick **Hard bounces** and **Complaints** (the app ignores
   other types; ticking Deliveries is harmless but adds noise).
4. Destination **Amazon SNS**, name `to-app`, topic `pta-ses-events`. Save.

If SES reports it can't publish to the topic, open the topic in SNS → **Access
policy → Edit** and add this statement inside `"Statement": [ ... ]` (put your
account number and region in):

```json
{
  "Sid": "AllowSES",
  "Effect": "Allow",
  "Principal": { "Service": "ses.amazonaws.com" },
  "Action": "sns:Publish",
  "Resource": "arn:aws:sns:us-east-1:123456789012:pta-ses-events",
  "Condition": { "StringEquals": { "AWS:SourceAccount": "123456789012" } }
}
```

### 2.5 Create the app's credentials

The app gets its own login that can only send email, nothing else.

1. **IAM → Users → Create user**. Name `pta-mailer-app`. Do **not** give it
   console access. Next.
2. **Attach policies directly** → don't tick any → Next → **Create user**.
3. Open the user → **Permissions → Add permissions → Create inline policy** →
   **JSON** tab → paste:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": ["ses:SendEmail", "ses:SendRawEmail"],
         "Resource": "*"
       }
     ]
   }
   ```

   Name the policy `send-pta-email`. Create. This key can send email and
   nothing else: it can't read data, change settings or create resources.
4. **Security credentials → Create access key** → use case **Application
   running outside AWS** → Create. Copy the **Access key ID** and **Secret
   access key** now; the secret is shown only once.

### 2.6 Request production access

New SES accounts are in a "sandbox" that can only send to addresses you have
verified one by one.

1. **SES → Account dashboard → Request production access**.
2. Mail type **Marketing**. Website URL: `https://mailer.pta.example.org`.
3. Use case description, for example:

   > Newsletter for a school PTA with roughly 400 subscribing families, sent a
   > few times a month. Families subscribe through a double opt-in form on our
   > website and must click a confirmation link before receiving anything.
   > Every message includes a one-click unsubscribe link and List-Unsubscribe
   > headers; unsubscribes take effect immediately. We publish bounce and
   > complaint events to SNS and our application automatically and
   > permanently suppresses hard-bounced and complaining addresses. We do not
   > purchase or import lists.

4. Submit. Amazon usually answers within 24 hours. If they ask questions,
   answer them in the support case.

While waiting, you can still test: under **Identities → Create identity →
Email address**, verify your own email, and test-send to it.

Once approved, the Account dashboard shows your **maximum send rate** (usually
14 per second). Set `SEND_RATE_PER_SECOND` to that number or lower.

### 2.7 Connect the topic to the app

Do this **after** the app is deployed with the variables from 2.9, so it can
answer Amazon's confirmation request.

1. **SNS → Topics → pta-ses-events → Create subscription**.
2. Protocol **HTTPS**; endpoint `https://mailer.pta.example.org/api/webhooks/ses`.
3. Leave **Enable raw message delivery** **off**. The app checks Amazon's
   signature on each message, which raw delivery removes.
4. Create. Within a minute the subscription status should change to
   **Confirmed**. If it stays "Pending confirmation", check that
   `SNS_TOPIC_ARNS` is set exactly to the topic ARN and redeploy, then select
   the subscription → **Request confirmation**.

### 2.8 Unsubscribe by email (optional, recommended)

Gmail and Apple Mail mostly use the one-click web unsubscribe, which already
works. This adds the email-based unsubscribe that some other mail programs use.

1. DNS: add **MX** for `news.pta.example.org` →
   `10 inbound-smtp.us-east-1.amazonaws.com`.
2. **SES → Email receiving → Rule sets** → create a rule set (if none) and
   **Set as active**.
3. **Create rule**: recipient `unsubscribe@news.pta.example.org`; action
   **Publish to Amazon SNS topic** → `pta-ses-events`, encoding **UTF-8**.
   Accept the prompt to let SES publish to the topic.
4. Set `UNSUBSCRIBE_MAILTO=unsubscribe@news.pta.example.org`.

### 2.9 Give the values to the app

| Variable | Value |
| --- | --- |
| `EMAIL_PROVIDER` | `ses` |
| `EMAIL_FROM` | `"PTA News <news@news.pta.example.org>"` (must be on the verified domain) |
| `EMAIL_REPLY_TO` | optional: a mailbox someone reads, e.g. `pta@pta.example.org` |
| `SES_REGION` | `us-east-1` (the region you chose) |
| `SES_ACCESS_KEY_ID` | from 2.5 |
| `SES_SECRET_ACCESS_KEY` | from 2.5 |
| `SES_CONFIGURATION_SET` | `pta-newsletter` |
| `SNS_TOPIC_ARNS` | the topic ARN from 2.3 |
| `SEND_RATE_PER_SECOND` | your SES max send rate, e.g. `14` |
| `UNSUBSCRIBE_MAILTO` | from 2.8, or leave empty |

Redeploy after setting them, then do 2.7.

### 2.10 Prove it works

1. **Sending:** on a newsletter, use **Send test to me**. It should arrive
   within a minute. In Gmail, open it → ⋮ → **Show original**: SPF, DKIM and
   DMARC should all say **PASS**.
2. **Bounces:** on the public signup page, subscribe
   `bounce@simulator.amazonses.com`. Amazon's simulator bounces the
   confirmation email. Within a minute or two it should appear on the
   **Subscribers** page with status **Bounced**.
3. **Complaints:** do the same with `complaint@simulator.amazonses.com`; it
   should show **Marked as spam**.

If 2 or 3 don't change status: check the SNS subscription is **Confirmed**,
`SES_CONFIGURATION_SET` matches the set name, and the hosting logs for
`/api/webhooks/ses` (a `403 Rejected: topic not allowed` means `SNS_TOPIC_ARNS`
doesn't match).

---

## All the variables in one place

| Variable | From |
| --- | --- |
| `APP_URL` | your app's address |
| `AUTH_SECRET` | random, 1.5 |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | Google, 1.4 |
| `BOOTSTRAP_ADMIN_EMAIL` | first admin's Google email |
| `EMAIL_PROVIDER`, `EMAIL_FROM`, `EMAIL_REPLY_TO` | 2.9 |
| `SES_REGION`, `SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY` | Amazon, 2.1 and 2.5 |
| `SES_CONFIGURATION_SET` | 2.4 |
| `SNS_TOPIC_ARNS` | 2.3 |
| `SEND_RATE_PER_SECOND` | 2.6 |
| `UNSUBSCRIBE_MAILTO` | 2.8 |

The database, image storage and cron settings are covered in
[LAUNCH.md](LAUNCH.md).

# Deploying on an Ubuntu server

Step by step, from a fresh Ubuntu server to the signup page running at
`https://mailer.yourpta.org` with HTTPS, a database, image storage, the send
worker and nightly backups. About an hour.

When this guide is done, the site works for parents (signup, confirm, archive,
privacy page), but emails are only written to the logs and nobody can log in
yet. That's expected: Google login and Amazon sending come next, in
[SETUP_GOOGLE_AND_AMAZON.md](SETUP_GOOGLE_AND_AMAZON.md), and they need this
site to be online first.

Replace these everywhere:

| Placeholder | Meaning |
| --- | --- |
| `mailer.yourpta.org` | The address the site will have |
| `news.yourpta.org` | The domain newsletters are sent from (set up in the Amazon guide) |
| `SERVER_IP` | Your server's public IP address |

Commands are run as a user with `sudo` rights, over SSH. Lines starting with
`#` inside command blocks are comments; you don't need to type them.

---

## What you need

- A server running **Ubuntu 22.04 or 24.04** with at least **2 GB of RAM**
  (building the app needs about that much; step 2 adds swap if you have less)
  and about 5 GB of free disk.
- Access to the DNS settings for your domain.
- Access to the code on GitHub (`schuylertraudt/pta-mailer`).

**About the code branch:** the app is currently on the branch
`ccr-6d2f924f-jf1u7k`. The cleanest setup is to merge it into `main` on GitHub
first (open a pull request from that branch and merge it), then use `main`
below. If you don't merge it, use that branch name wherever this guide says
`main`.

---

## 1. Point the domain at the server

In your DNS provider, add an **A record**: name `mailer` (for
`mailer.yourpta.org`), value `SERVER_IP`. If the server has an IPv6 address,
add an **AAAA record** with it too.

Check from your own computer after a few minutes:

```bash
nslookup mailer.yourpta.org
```

It should print `SERVER_IP`. HTTPS in step 10 won't work until it does.

## 2. Prepare the server

```bash
sudo apt update && sudo apt -y upgrade
sudo apt -y install git curl ufw

# Firewall: allow SSH and web traffic only.
sudo ufw allow OpenSSH
sudo ufw allow 80,443/tcp
sudo ufw --force enable
```

**If the server has less than 2 GB of RAM**, add swap so the build doesn't run
out of memory:

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 3. Install Node.js 22

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt -y install nodejs
node -v    # should print v22.something
```

## 4. Install the database (PostgreSQL)

```bash
sudo apt -y install postgresql

# Make a strong database password and show it. Copy it for step 7.
DBPASS=$(openssl rand -hex 24); echo "$DBPASS"

sudo -u postgres psql -c "CREATE USER pta WITH PASSWORD '$DBPASS';"
sudo -u postgres createdb -O pta pta_mailer
```

The database only listens on the server itself, not the internet (Ubuntu's
default).

## 5. Create the app's user and folders

The app runs as its own user, `pta`, which can't log in and can't change the
rest of the system.

```bash
sudo adduser --system --group --home /opt/pta-mailer --shell /bin/bash pta
sudo mkdir -p /var/lib/pta-mailer/media
sudo chown -R pta:pta /var/lib/pta-mailer
sudo chmod 755 /var/lib/pta-mailer /var/lib/pta-mailer/media
```

`/var/lib/pta-mailer/media` holds uploaded newsletter images.

## 6. Get the code

The repository is private, so give the server a read-only "deploy key":

```bash
sudo -u pta -H mkdir -p /opt/pta-mailer/.ssh
sudo -u pta -H ssh-keygen -t ed25519 -N "" -C "pta-mailer server" -f /opt/pta-mailer/.ssh/id_ed25519
sudo -u pta -H bash -c 'ssh-keyscan github.com >> /opt/pta-mailer/.ssh/known_hosts'
sudo cat /opt/pta-mailer/.ssh/id_ed25519.pub
```

On GitHub: the repository → **Settings → Deploy keys → Add deploy key**. Title
`pta-mailer server`, paste the line printed above, leave **Allow write access**
unticked, **Add key**.

Then clone:

```bash
sudo -u pta -H git clone --branch main git@github.com:schuylertraudt/pta-mailer.git /opt/pta-mailer/app
```

## 7. Write the settings file

```bash
# Make a random secret and show it. Copy it into AUTH_SECRET below.
openssl rand -hex 32

sudo nano /etc/pta-mailer.env
```

Paste this, replacing the `<...>` parts and the addresses:

```bash
NODE_ENV=production
DATABASE_URL=postgres://pta:<database password from step 4>@localhost:5432/pta_mailer
APP_URL=https://mailer.yourpta.org
AUTH_SECRET=<random secret from the line above>

# Newsletters come from this address (must be on the domain you verify with Amazon).
EMAIL_FROM="PTA News <news@news.yourpta.org>"
# A mailbox someone reads. Replies and privacy requests go here.
EMAIL_REPLY_TO=pta@yourpta.org

# Images are stored on this server and served by Caddy (step 10).
STORAGE_DRIVER=local
STORAGE_LOCAL_DIR=/var/lib/pta-mailer/media
STORAGE_PUBLIC_BASE_URL=https://mailer.yourpta.org/media

# Added later by SETUP_GOOGLE_AND_AMAZON.md:
# AUTH_GOOGLE_ID=
# AUTH_GOOGLE_SECRET=
# BOOTSTRAP_ADMIN_EMAIL=
# EMAIL_PROVIDER=ses
# SES_REGION= / SES_ACCESS_KEY_ID= / SES_SECRET_ACCESS_KEY=
# SES_CONFIGURATION_SET= / SNS_TOPIC_ARNS= / SEND_RATE_PER_SECOND= / UNSUBSCRIBE_MAILTO=
```

Save (Ctrl+O, Enter) and exit (Ctrl+X). Then lock it down: it holds
passwords.

```bash
sudo chown root:pta /etc/pta-mailer.env
sudo chmod 640 /etc/pta-mailer.env
```

Avoid `$` and backticks in values; the hex secrets above never contain them.

## 8. Install, build and set up the database

```bash
cd /opt/pta-mailer/app
sudo -u pta -H npm ci
sudo -u pta -H npm run build

# Create the tables and the three starter templates.
sudo -u pta -H bash -c 'set -a; . /etc/pta-mailer.env; set +a; npm run db:migrate'
```

The build takes a few minutes. It should end with a list of routes and no
errors. The migrate step should print `Migrations applied; starter templates
present.`

## 9. Run the app as services

Two services: the website, and the worker that sends queued emails.

```bash
sudo tee /etc/systemd/system/pta-web.service > /dev/null <<'EOF'
[Unit]
Description=PTA Mailer website
After=network.target postgresql.service

[Service]
User=pta
WorkingDirectory=/opt/pta-mailer/app
EnvironmentFile=/etc/pta-mailer.env
ExecStart=/usr/bin/npm start -- -H 127.0.0.1 -p 3000
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo tee /etc/systemd/system/pta-worker.service > /dev/null <<'EOF'
[Unit]
Description=PTA Mailer send worker
After=network.target postgresql.service

[Service]
User=pta
WorkingDirectory=/opt/pta-mailer/app
EnvironmentFile=/etc/pta-mailer.env
ExecStart=/opt/pta-mailer/app/node_modules/.bin/tsx scripts/worker.ts
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now pta-web pta-worker
```

Check both are running:

```bash
systemctl status pta-web pta-worker --no-pager
curl -sI http://127.0.0.1:3000 | head -1     # should print HTTP/1.1 200 OK
```

The website only listens on the server itself; Caddy (next step) puts it on
the internet with HTTPS.

## 10. HTTPS with Caddy

Caddy gets and renews the HTTPS certificate automatically and serves the
uploaded images.

```bash
sudo apt -y install debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt -y install caddy
```

Replace Caddy's configuration (change the domain on the first line):

```bash
sudo tee /etc/caddy/Caddyfile > /dev/null <<'EOF'
mailer.yourpta.org {
	encode zstd gzip

	# Uploaded newsletter images. Read-only, no folder listings.
	handle_path /media/* {
		root * /var/lib/pta-mailer/media
		file_server
		header Cache-Control "public, max-age=31536000, immutable"
	}

	# Everything else goes to the app.
	handle {
		reverse_proxy 127.0.0.1:3000
	}
}
EOF

sudo systemctl reload caddy
```

## 11. Check it

In a browser:

- `https://mailer.yourpta.org` shows the signup page, with a padlock in the
  address bar.
- `https://mailer.yourpta.org/privacy` shows the privacy policy.
- `https://mailer.yourpta.org/archive` shows "Past newsletters".

Subscribe with your own email. You won't receive anything yet (sending isn't
connected), but the confirmation email appears in the website's log, which
proves the whole path works:

```bash
sudo journalctl -u pta-web -n 20 --no-pager | grep '\[mail\]'
```

## 12. Nightly backups

Back up the database and the uploaded images every night, keeping two weeks:

```bash
sudo tee /usr/local/bin/pta-backup > /dev/null <<'EOF'
#!/bin/bash
set -euo pipefail
dir=/var/backups/pta-mailer
mkdir -p "$dir"
stamp=$(date +%F)
sudo -u postgres pg_dump -Fc pta_mailer > "$dir/db-$stamp.dump"
tar -czf "$dir/media-$stamp.tar.gz" -C /var/lib/pta-mailer media
find "$dir" -type f -mtime +14 -delete
EOF
sudo chmod 755 /usr/local/bin/pta-backup
echo '30 3 * * * root /usr/local/bin/pta-backup' | sudo tee /etc/cron.d/pta-backup
sudo /usr/local/bin/pta-backup && ls -lh /var/backups/pta-mailer
```

These backups are on the same server, so they don't survive losing the server.
Once a month (or automatically, with a tool like `rclone`), copy
`/var/backups/pta-mailer` somewhere the PTA controls, such as a shared drive
owned by a PTA role account. Restoring is described in
[OPERATIONS.md](OPERATIONS.md).

## 13. Next: Google login and Amazon sending

Follow [SETUP_GOOGLE_AND_AMAZON.md](SETUP_GOOGLE_AND_AMAZON.md), starting at
"Do things in this order", step 2. Your addresses for it are:

- App address: `https://mailer.yourpta.org`
- Google redirect URI: `https://mailer.yourpta.org/api/auth/callback/google`
- Privacy policy link: `https://mailer.yourpta.org/privacy`
- Amazon notification endpoint: `https://mailer.yourpta.org/api/webhooks/ses`

Whenever that guide says to set a variable and redeploy, on this server that
means: add the line to `/etc/pta-mailer.env` (`sudo nano /etc/pta-mailer.env`),
then

```bash
sudo systemctl restart pta-web pta-worker
```

You can skip the image-storage bucket part of LAUNCH.md: images are stored on
this server.

---

## Updating to a new version

```bash
cd /opt/pta-mailer/app
sudo -u pta -H git pull
sudo -u pta -H npm ci
sudo -u pta -H npm run build
sudo -u pta -H bash -c 'set -a; . /etc/pta-mailer.env; set +a; npm run db:migrate'
sudo systemctl restart pta-web pta-worker
```

The site is unavailable for a few seconds during the restart. Running the
migrate step every time is safe; it only applies changes that haven't been
applied yet.

## Keeping the server healthy

- Security updates: `sudo apt -y install unattended-upgrades` installs them
  automatically.
- Logs: `sudo journalctl -u pta-web -f` (website) and
  `sudo journalctl -u pta-worker -f` (sending). Press Ctrl+C to stop watching.
- Disk space: `df -h /` once in a while. Images and backups are the only
  things that grow.

## Troubleshooting

| Problem | What to check |
| --- | --- |
| Browser shows "502 Bad Gateway" | The website service isn't running: `systemctl status pta-web`, then `sudo journalctl -u pta-web -n 50` |
| Logs say "Invalid environment configuration" | A setting in `/etc/pta-mailer.env` is missing or malformed; the message names it |
| No padlock / certificate error | DNS doesn't point at the server yet (step 1), or ports 80/443 are blocked (step 2). `sudo journalctl -u caddy -n 50` says which |
| Build stops with "JavaScript heap out of memory" or "Killed" | Not enough RAM: add swap (step 2) and build again |
| Images in newsletters don't show | `STORAGE_PUBLIC_BASE_URL` must be `https://<your domain>/media`, and the Caddy `/media/*` block must be present |
| `git pull` says "Permission denied (publickey)" | The deploy key was removed from GitHub; add it again (step 6) |

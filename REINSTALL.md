# Rebuilding the VPS from scratch

How to bring back everything that runs on the VPS: the portfolio and contact form, n8n, Ollama with Open WebUI, the file uploader, and the WireGuard VPN. The setup lives in three GitHub repos; secrets and data live in a backup file made by `vps-backup`.

| What | Where it comes from |
|---|---|
| Portfolio, contact form, nginx, cert monitor, ops scripts | repo `prasanthebenezer.github.io` (public) |
| File uploader at `files.` | repo `vps-uploader` (private) |
| WireGuard VPN | repo `wg-easy` (private) |
| Secrets, TLS certs, VPN keys, n8n data, uploaded files, uploader share links, n8n and Ollama compose files | backup file `vps-backup-<date>.tgz` |
| Ollama models, Open WebUI chats, ClamAV signatures, Docker images | not backed up; downloaded again (models: step 7) |

---

## Before you need it: make a backup

A backup runs automatically **every day at about 02:30 UTC** (systemd timer `vps-backup.timer`). Each run writes `/root/backups/vps-backup-<date>.tgz` (under 1 MB at present) and then deletes older ones, so the newest 7 (a week's worth) stay on the VPS. If a run fails, an alert goes to the cert monitor's ntfy topic.

To make one right away, for example after adding a VPN device, run `vps-backup` on the VPS. It prints the command to download the file. On your Windows PC, in PowerShell:

```
scp root@187.77.170.101:/root/backups/vps-backup-<date>.tgz .
```

Keep the file somewhere private, such as a password manager attachment or an encrypted drive. It contains the Gmail app password, reCAPTCHA secret, TLS and VPN private keys, and n8n credentials. Never commit it or upload it through the `files.` uploader.

A backup that stays on the VPS is lost along with the VPS, so download the latest one regularly, and always after anything important changes: a new VPN device, new n8n workflows, a password change, or uploads you want kept.

---

## Rebuild

Commands run as root on the new VPS unless they say otherwise. Fresh Ubuntu 24.04 or later is assumed.

### 1. DNS (only if the IP address changed)

At the domain registrar, point these A records at the new IP: `@`, `www`, `n8n`, `webui`, `files`. Wait until `dig +short files.prasanthebenezer.com` shows the new IP.

If the IP changed, every `187.77.170.101` in these instructions and in the `wg-easy` README becomes the new IP.

### 2. Install the tools

```
apt update && apt upgrade -y
curl -fsSL https://get.docker.com | sh
apt install -y git gh certbot ufw
gh auth login                       # needed for the two private repos
```

### 3. Firewall

```
ufw allow 22/tcp comment 'SSH'
ufw allow 80/tcp comment 'HTTP'
ufw allow 443/tcp comment 'HTTPS'
ufw allow 51820/udp comment 'WireGuard (wg-easy)'
ufw enable
```

Turn off SSH password logins as before: set `PasswordAuthentication no` in `/etc/ssh/sshd_config.d/` and run `systemctl reload ssh`, after checking that key login works.

### 4. Clone the three repos

They must sit in `/root`, because symlinks and compose files use these paths.

```
cd /root
gh repo clone prasanthebenezer/prasanthebenezer.github.io
gh repo clone prasanthebenezer/vps-uploader
gh repo clone prasanthebenezer/wg-easy
```

### 5. Restore the backup

From your PC, upload it:

```
scp vps-backup-<date>.tgz root@187.77.170.101:/root/
```

On the VPS:

```
mkdir -p /root/restore && cd /root/restore
tar xzf /root/vps-backup-*.tgz
tar xzf host-files.tgz -C /          # /etc secrets and certs, /srv/uploads, /root/n8n, /root/ollama, ...
cp -rL /etc/letsencrypt/{live,archive,renewal} /root/prasanthebenezer.github.io/letsencrypt/
```

**No backup?** See [Without a backup](#without-a-backup) at the end, then continue with step 6.

### 6. Install the ops symlinks, timers and cron jobs

```
R=/root/prasanthebenezer.github.io
ln -sf $R/ops/cert-expiry-check.sh /usr/local/bin/cert-expiry-check.sh
ln -sf $R/ops/n8n-upgrade.sh /usr/local/bin/n8n-upgrade
ln -sf $R/ops/vps-backup.sh /usr/local/bin/vps-backup
ln -sf /root/vps-uploader/set-password.sh /usr/local/bin/uploader-set-password
ln -sf $R/ops/systemd/cert-expiry-check.service /etc/systemd/system/
ln -sf $R/ops/systemd/cert-expiry-check.timer /etc/systemd/system/
ln -sf $R/ops/systemd/vps-backup.service /etc/systemd/system/
ln -sf $R/ops/systemd/vps-backup.timer /etc/systemd/system/
mkdir -p /etc/letsencrypt/renewal-hooks/deploy
ln -sf $R/ops/letsencrypt-hooks/sync-and-reload.sh /etc/letsencrypt/renewal-hooks/deploy/
cp /root/vps-uploader/rescan.cron /etc/cron.d/vps-uploader-rescan
systemctl daemon-reload
systemctl enable --now cert-expiry-check.timer certbot.timer vps-backup.timer
```

### 7. Start the stacks, in this order

The order matters: the portfolio creates the shared network the others join, and Ollama joins n8n's network.

```
# 1. Portfolio + contact form (creates the prasanthebenezergithubio_default network)
cd /root/prasanthebenezer.github.io && docker compose up -d --build

# 2. n8n, with its data restored into the volume first
cd /root/n8n && docker compose create
docker run --rm -v n8n_n8n-data:/data -v /root/restore/volumes:/b alpine tar xzf /b/n8n_n8n-data.tgz -C /data
docker compose up -d
n8n-upgrade --check

# 3. Ollama + Open WebUI, then download the models again
cd /root/ollama && docker compose up -d
docker exec ollama ollama pull qwen3.5:4b
docker exec ollama ollama pull llama3.2:3b
docker exec ollama ollama pull nomic-embed-text

# 4. File uploader (the ClamAV scanner needs a few minutes to load signatures)
cd /root/vps-uploader && docker compose up -d --build

# 5. WireGuard VPN, with its keys restored into the volume first
cd /root/wg-easy && docker compose create
docker run --rm -v wg-easy_etc_wireguard:/data -v /root/restore/volumes:/b alpine tar xzf /b/wg-easy_etc_wireguard.tgz -C /data
docker compose up -d
```

Open WebUI starts empty. Create its admin account again at https://webui.prasanthebenezer.com.

### 8. Check everything

| Check | Expected |
|---|---|
| `docker ps` | all containers `Up`; none restarting |
| https://prasanthebenezer.com | site loads; send yourself a test message through the contact form |
| https://n8n.prasanthebenezer.com | your workflows are there |
| https://webui.prasanthebenezer.com | answers a prompt |
| https://files.prasanthebenezer.com | same password as before; files and share links are there |
| VPN on a phone | connects; https://whatismyipaddress.com shows the VPS IP |
| `systemctl start cert-expiry-check.service && journalctl -u cert-expiry-check -n 20` | all five hosts OK |
| `certbot renew --dry-run` | all renewals succeed |

Then clean up: `rm -rf /root/restore /root/vps-backup-*.tgz`, and run `vps-backup` once on the new VPS.

---

## Without a backup

Everything can be rebuilt, but secrets have to be entered again and data is lost: n8n workflows and credentials, VPN devices, uploader share links and uploaded files.

**TLS certificates.** nginx won't start without them, so issue them before step 7 while port 80 is free, then switch renewals to the webroot method that nginx serves:

```
R=/root/prasanthebenezer.github.io
certbot certonly --standalone --cert-name prasanthebenezer.com-0001 -d prasanthebenezer.com -d www.prasanthebenezer.com
for d in n8n webui files; do certbot certonly --standalone -d $d.prasanthebenezer.com; done
cp -rL /etc/letsencrypt/{live,archive,renewal} $R/letsencrypt/
```

After step 7's portfolio container is up, run this for each certificate (`prasanthebenezer.com-0001`, then `n8n.`, `webui.` and `files.prasanthebenezer.com`):

```
certbot reconfigure --cert-name <name> --webroot -w /root/prasanthebenezer.github.io/webroot
```

**Contact-form secrets** (`/etc/contact-form.env`, chmod 600). Needs a Gmail app password and the reCAPTCHA v2 secret:

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=<gmail address>
SMTP_PASS=<gmail app password>
MAIL_TO=<where messages go>
RECAPTCHA_SECRET=<recaptcha secret key>
```

**Cert monitor** (`/etc/cert-monitor.env`, chmod 600): `NTFY_TOPIC=<your ntfy topic>`. Use the same topic so the ntfy app keeps receiving alerts.

**Uploader secrets.** Run these, then set the password:

```
install -d -m 700 -o 10001 /etc/vps-uploader
openssl rand -hex 32 > /etc/vps-uploader/secret_key
chown 10001 /etc/vps-uploader/secret_key && chmod 400 /etc/vps-uploader/secret_key
install -d -m 2775 -o 10001 /srv/uploads
install -d -m 700 -o 10001 /var/lib/vps-uploader
uploader-set-password            # after step 7 has built the uploader image
```

**n8n and Ollama.** `/root/n8n` and `/root/ollama` aren't in git. Reinstall n8n with the installer from https://get.n8n.io into `/root/n8n`. Then add the localhost-only port, `N8N_HOST`/`WEBHOOK_URL` and the `portfolio` network to its `compose.yml`, as `ops/n8n-upgrade.sh --check` expects. Recreate `/root/ollama/docker-compose.yml` from the description in `CLAUDE.md`.

**VPN.** In step 7, skip the `docker compose create` and restore lines for wg-easy, run `docker compose up -d`, then follow *First-time setup* in the `wg-easy` README and re-add each device.

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This repo serves two deployment targets from the same tree:

1. **Static portfolio** — deployed via GitHub Pages at `https://prasanthebenezer.github.io` (root-level `index.html`, `styles.css`, `script.js`, `assets/`). No build step.
2. **VPS** — the same static files served by an nginx container via Docker Compose, behind a separate edge proxy (`/root/edge-proxy`, not in this repo) that terminates Let's Encrypt TLS for `https://prasanthebenezer.com` and every subdomain. To rebuild the whole VPS (this repo plus `vps-uploader` and `wg-easy`), follow `REINSTALL.md`; `VPS-DEPLOYMENT-GUIDE.md` is the older, generic first-install guide.

## Git & Deployment

Always use the `gh` CLI for git authentication and push operations:
```
gh auth setup-git && git push origin main
```

Pushing to `main` triggers the GitHub Actions workflow (`.github/workflows/static.yml`), which deploys the repository root to GitHub Pages. The VPS stack is updated separately by pulling on the server and running `docker compose up -d --build`.

To preview locally, serve the root directory with any static file server, e.g.:
```
python3 -m http.server 8000
```

## File Structure

### Portfolio
- **`index.html` / `styles.css` / `script.js`** — Live portfolio site (root level).
- **`assets/Prasanth_Philip_CV.pdf`** — CV linked from nav and footer.
- **`assets/profile.jpg`** — hero portrait (4:5, ~760×950). Optional: if missing, the frame falls back to "PP" initials.
- **`Dockerfile` / `nginx.conf`** — nginx container that serves the static portfolio and `/api/contact` over plain HTTP on the VPS (no TLS; the edge proxy handles that).
- **`setup-ssl.sh`** — original first-install cert script (historical). The gitignored `letsencrypt/` and `webroot/` folders are leftovers from before the edge proxy and are no longer mounted.

### VPS ops (`ops/`)
- **`ops/cert-expiry-check.sh`** — daily TLS expiry monitor. TLS-probes `prasanthebenezer.com`, `www.`, `n8n.`, `webui.`, `files.`, `training.`, `tts.`, `trade.`, `chrome.`, `agent.` and `notiq.` and alerts via ntfy.sh at ≤20 days (WARN) / ≤7 days (CRITICAL). Deliberately independent of certbot state so it catches silent renewal failures.
- **`ops/systemd/cert-expiry-check.{service,timer}`** — systemd units for the monitor (runs 09:00 UTC daily).
- **`ops/n8n-upgrade.sh`** — upgrades the n8n stack (`get-n8n.sh --upgrade` with `N8N_DIR=/root/n8n` pinned) and then verifies the `n8n.` proxy setup; `--check` verifies only. Installed as the `n8n-upgrade` command; use it instead of the raw curl one-liner.
- **`ops/vps-backup.sh`** — installed as `vps-backup`. Writes `/root/backups/vps-backup-<date>.tgz` (chmod 640, group 10001 so the uploader container can serve it: `/root/backups` is mounted read-only into `vps-uploader` as its "Backups" folder) with everything a rebuild needs that git doesn't hold: `/etc` secrets, `/etc/letsencrypt`, `/root/edge-proxy`, uploader secrets/shares.db/`/srv/uploads`, `/root/n8n`, the Ollama compose file, ClaudeAgent's `.env` and `/etc/claude-bridge.env`, Notiq's `.env` and a `pg_dump` of its database (`notiq-db.sql.gz`), and the `wg-easy_etc_wireguard`, `n8n_n8n-data`, `onboarding-training-system_media` and `claudeagent_agent-data` volumes (briefly `docker pause`s their containers). Ollama models, Open WebUI data and ClaudeAgent's connector key (`/etc/claudeagent`, so backed-up connector tokens stay ciphertext) are deliberately excluded. After a successful run it deletes all but the newest 3 (`KEEP`). Restore steps: `REINSTALL.md`.
- **`ops/systemd/vps-backup.{service,timer}`** — runs `vps-backup` daily (02:30 UTC); on failure, `ExecStopPost` alerts via the cert monitor's ntfy topic (`/etc/cert-monitor.env`).

Runtime paths on the VPS (`/usr/local/bin/cert-expiry-check.sh`, `/usr/local/bin/n8n-upgrade`, `/usr/local/bin/vps-backup`, `/etc/systemd/system/cert-expiry-check.{service,timer}`, `/etc/systemd/system/vps-backup.{service,timer}`) are symlinks into `ops/` — so a `git pull` on the box deploys edits with no copy step. The ntfy topic lives in `/etc/cert-monitor.env` (chmod 600, not in git). All symlinks assume the repo stays at `/root/prasanthebenezer.github.io/`.

## Docker Compose

`docker-compose.yml` defines a `portfolio` service (nginx serving the static site on port 80, **no published ports**) and a `contact` service (contact-form backend; the portfolio nginx proxies `/api/contact` to it). `portfolio` joins the external `edge` network as host `portfolio`; `contact` stays on this project's default network only. `nginx.conf` trusts `X-Real-IP` from private ranges (`real_ip`), so logs and the contact rate limit see the visitor. Common ops:
```
docker compose up -d --build portfolio
docker compose logs -f portfolio
```

### Edge proxy (`/root/edge-proxy`, separate stack, not in this repo)

The only container publishing 80/443 is `edge-proxy` (stock `nginx:1.31-alpine`, `/root/edge-proxy/docker-compose.yml`; see its `README.md`). It terminates TLS for every hostname and forwards to apps on the shared external Docker network `edge` (created once with `docker network create edge`). Each app stack declares `networks: portfolio: {name: edge, external: true}` (the key is still called `portfolio` in their compose files) with an alias, and publishes no public port:

| Hostname | Upstream on `edge` | Stack |
|---|---|---|
| `prasanthebenezer.com` (+ `www.` → apex) | `portfolio:80` | this repo |
| `n8n.` | `n8n:5678` | `/root/n8n` (5678 also bound to 127.0.0.1) |
| `webui.` | `open-webui:8080` | `/root/ollama/docker-compose.yml` |
| `files.` | `uploader:8090` | `/root/vps-uploader` |
| `training.` | `training:8000` | `/root/onboarding-training-system` (untracked `docker-compose.override.yml` disables its Caddy) |
| `tts.` | `tts:3900` | `/root/voicestudio` (apex `/tts` 301s here; its UI needs a domain root) |
| `trade.` | `console:8000` | `/root/kite-console` (site file owned by that repo at `deploy/nginx/`; `TRUSTED_PROXY_HOST=edge-proxy` so it trusts only the proxy's `X-Forwarded-For`) |
| `chrome.` | `chrome:8080` | `/root/chrome` (neko remote Chromium, untracked local compose + `.env`; WebRTC media goes direct to the host on UDP 52000-52049, not through the proxy) |
| `notiq.` | `notiq:3000` | `/root/notiq` (notes/tasks app; repo prasanthebenezer/notiq; site file owned by that repo at `deploy/nginx/`, `/api/auth/login` rate limited; sign-in is set up with `scripts/set-login.sh`) |
| `agent.` | `claudeagent:8000` | `/root/ClaudeAgent` (self-hosted Claude chat; repo prasanthebenezer/ClaudeAgent. Its Claude Code mode talks over a Unix socket to the host service `claude-bridge`, which runs as the non-root user `claude` with code in `/opt/claude-bridge`. Connectors (MCP servers) need the key file `/etc/claudeagent/connector.key`, mounted by `docker-compose.connectors.yml`; it is kept out of `vps-backup` on purpose. `/api/login` is rate limited in the site file) |

Ollama (`ollama:11434`, 127.0.0.1 on the host) is only on `n8n_default`; never expose it, it has no auth.

Layout: `conf.d/00-http.conf` (http-level settings, `resolver 127.0.0.11`, default servers: unknown HTTP hosts → apex redirect with ACME passthrough, unknown HTTPS names → handshake rejected), `snippets/tls.conf` (shared TLS + HSTS), `sites/<host>.conf` (one per hostname; `/root/nginx-sites` is a symlink to it). Certs are mounted read-only straight from `/etc/letsencrypt`; certbot renews via `--webroot -w /root/edge-proxy/webroot` and its deploy hook `/etc/letsencrypt/renewal-hooks/deploy/edge-reload.sh` → `/root/edge-proxy/hooks/reload.sh` just reloads nginx. Upstreams are `proxy_pass $var` so the proxy starts even when an app is down.

Adding a new subdomain: DNS A record → the VPS IPv4; `certbot certonly --webroot -w /root/edge-proxy/webroot -d <sub>.prasanthebenezer.com` (works before the site file exists, via the default server); put the app on the `edge` network with an alias; add `/root/edge-proxy/sites/<sub>.prasanthebenezer.com.conf` (copy `n8n.`'s); `docker exec edge-proxy nginx -t && docker exec edge-proxy nginx -s reload`; add the host to `HOSTS` in `ops/cert-expiry-check.sh`.

## Architecture

The site is a single-page, vanilla HTML/CSS/JS portfolio with no frameworks or dependencies beyond CDN-loaded libraries:
- **Google Fonts** — Inter (body/headings) and JetBrains Mono (labels, stats, tags)
- **Font Awesome 6.4** — icons throughout

**`styles.css`** uses CSS custom properties (`--bg-primary`, `--accent`, etc.) defined in `:root` for the light theme, overridden under `body.dark-theme` for dark mode. All spacing, color, and typography use these variables — extend them rather than hardcoding values.

**`script.js`** initialises on `DOMContentLoaded` and wires up:
- `toggleTheme()` / `loadTheme()` — dark/light mode persisted via `localStorage`
- `toggleMobileMenu()` / `closeMobileMenu()` — responsive nav
- `smoothScroll()` — offset-corrected anchor scrolling (80px nav offset)
- `initScrollAnimations()` — IntersectionObserver fade-in for `.section`, `.timeline-item`, `.project-card`
- `updateActiveNav()` — highlights current section in nav on scroll
- `handleFormSubmit()` — async POST to the N8N webhook for the contact form
- `animateStats()` / `animateValue()` — counter animation for hero stats on scroll into view

**Contact form** posts URL-encoded fields to `https://prasanthebenezer.com/api/contact` (the `<form action="...">` in `index.html`; absolute so the GitHub Pages copy uses it too). nginx proxies that path to the `contact` service (`contact/app.py`, Python stdlib only), which emails the message via Gmail SMTP with the visitor as Reply-To. Secrets (`SMTP_*`, `MAIL_TO`, `RECAPTCHA_SECRET`) live in `/etc/contact-form.env` on the VPS (chmod 600, not in git). CORS allows only `prasanthebenezer.com` and `prasanthebenezer.github.io`.

Spam protection — keep field names in sync between page and `app.py`:
- **Page:** a reCAPTCHA v2 checkbox (`.g-recaptcha`, site key in `data-sitekey`) and a hidden honeypot input `name="website"`. `handleFormSubmit()` refuses to send without a solved captcha, fakes success when the honeypot is filled, shows the server's `error` text on failure, and calls `grecaptcha.reset()` after each send (tokens are single-use).
- **`contact/app.py`:** drops honeypot submissions (returns 200), validates fields, verifies `g-recaptcha-response` with Google's siteverify (must succeed with a hostname in `ALLOWED_HOSTNAMES`), and rate-limits to 5 sends per IP per hour (in memory, reset on restart). This server-side check is what actually blocks bots.
- Test sending without a browser: `docker compose exec contact python -c "import app; app.send_mail('Test','you@example.com','hi','local')"`. Logs: `docker compose logs -f contact`.

## Sections (in order)

Hero → About → Experience (timeline) → Projects (two categories: AI Automation, Industrial Automation) → Skills → Education & Certifications → Contact → Footer

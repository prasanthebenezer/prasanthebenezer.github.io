# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This repo serves two deployment targets from the same tree:

1. **Static portfolio** — deployed via GitHub Pages at `https://prasanthebenezer.github.io` (root-level `index.html`, `styles.css`, `script.js`, `assets/`). No build step.
2. **VPS** — the same static files served by an nginx container via Docker Compose at `https://prasanthebenezer.com`, with Let's Encrypt TLS. To rebuild the whole VPS (this repo plus `vps-uploader` and `wg-easy`), follow `REINSTALL.md`; `VPS-DEPLOYMENT-GUIDE.md` is the older, generic first-install guide.

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
- **`Dockerfile` / `nginx.conf`** — nginx container that serves the static portfolio on the VPS.
- **`setup-ssl.sh` / `letsencrypt/`** — Let's Encrypt cert provisioning + volume mount (read-only into the portfolio container).

### VPS ops (`ops/`)
- **`ops/cert-expiry-check.sh`** — daily TLS expiry monitor. TLS-probes `prasanthebenezer.com`, `www.`, `n8n.`, `webui.` and `files.` and alerts via ntfy.sh at ≤20 days (WARN) / ≤7 days (CRITICAL). Deliberately independent of certbot state so it catches silent renewal failures.
- **`ops/systemd/cert-expiry-check.{service,timer}`** — systemd units for the monitor (runs 09:00 UTC daily).
- **`ops/n8n-upgrade.sh`** — upgrades the n8n stack (`get-n8n.sh --upgrade` with `N8N_DIR=/root/n8n` pinned) and then verifies the `n8n.` proxy setup; `--check` verifies only. Installed as the `n8n-upgrade` command; use it instead of the raw curl one-liner.
- **`ops/vps-backup.sh`** — installed as `vps-backup`. Writes `/root/backups/vps-backup-<date>.tgz` (chmod 600) with everything a rebuild needs that git doesn't hold: `/etc` secrets, `/etc/letsencrypt`, uploader secrets/shares.db/`/srv/uploads`, `/root/n8n`, the Ollama compose file, and the `wg-easy_etc_wireguard` and `n8n_n8n-data` volumes (briefly `docker pause`s their containers). Ollama models and Open WebUI data are deliberately excluded. After a successful run it deletes the older backups, keeping only the newest. Restore steps: `REINSTALL.md`.
- **`ops/systemd/vps-backup.{service,timer}`** — runs `vps-backup` weekly (Sun 02:30 UTC); on failure, `ExecStopPost` alerts via the cert monitor's ntfy topic (`/etc/cert-monitor.env`).
- **`ops/letsencrypt-hooks/sync-and-reload.sh`** — certbot deploy hook: after renewal, copies `/etc/letsencrypt/` into `./letsencrypt/` (the read-only mount into the nginx container) and reloads nginx.

Runtime paths on the VPS (`/usr/local/bin/cert-expiry-check.sh`, `/usr/local/bin/n8n-upgrade`, `/usr/local/bin/vps-backup`, `/etc/systemd/system/cert-expiry-check.{service,timer}`, `/etc/systemd/system/vps-backup.{service,timer}`, `/etc/letsencrypt/renewal-hooks/deploy/sync-and-reload.sh`) are symlinks into `ops/` — so a `git pull` on the box deploys edits with no copy step. The ntfy topic lives in `/etc/cert-monitor.env` (chmod 600, not in git). All symlinks assume the repo stays at `/root/prasanthebenezer.github.io/`.

## Docker Compose

`docker-compose.yml` defines a `portfolio` service (nginx, ports 80/443) with `./letsencrypt` and `./webroot` mounted read-only, and a `contact` service (contact-form backend, not exposed; nginx proxies `/api/contact` to it). Common ops:
```
docker compose up -d --build portfolio
docker compose logs -f portfolio
docker compose exec portfolio nginx -s reload    # after nginx.conf edits
```

`nginx.conf` terminates TLS for `prasanthebenezer.com` and redirects `www.` to the apex. It also proxies `n8n.prasanthebenezer.com` to the self-hosted n8n stack in `/root/n8n`, which joins this compose network as host `n8n` (port 5678 is bound to localhost only). It also proxies `webui.prasanthebenezer.com` to Open WebUI, which runs with Ollama in a separate compose stack at `/root/ollama/docker-compose.yml` (not in this repo) and joins this compose network as host `open-webui` (port 8080, no published port). It also proxies `files.prasanthebenezer.com` to a password-protected file uploader in a separate compose stack at `/root/vps-uploader/` (not in this repo; see its README), which joins this compose network as host `uploader` (port 8090, no published port) and writes into `/srv/uploads`. Ollama itself (`ollama:11434`, bound to 127.0.0.1 on the host) sits on the `n8n_default` network so n8n and Open WebUI can reach it; it is never exposed publicly because it has no auth. Certs live under `./letsencrypt/live/<domain>/`.

Adding a new subdomain: create the DNS A record (→ the VPS IPv4), issue the cert with `certbot certonly --webroot -w /root/prasanthebenezer.github.io/webroot -d <sub>.prasanthebenezer.com`, copy it in with `cp -rL /etc/letsencrypt/{live,archive,renewal} letsencrypt/` (the deploy hook runs only on renewals, not first issuance), add HTTP-redirect + HTTPS server blocks to `nginx.conf` (copy the `n8n.`/`webui.` blocks, which resolve the upstream per request via `resolver 127.0.0.11`), add the host to `HOSTS` in `ops/cert-expiry-check.sh`, then `docker compose up -d --build portfolio`.

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

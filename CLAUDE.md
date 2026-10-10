# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This repo serves two deployment targets from the same tree:

1. **Static portfolio** — deployed via GitHub Pages at `https://prasanthebenezer.github.io` (root-level `index.html`, `styles.css`, `script.js`, `assets/`). No build step.
2. **VPS** — the same static files served by an nginx container via Docker Compose at `https://prasanthebenezer.com`, with Let's Encrypt TLS. See `VPS-DEPLOYMENT-GUIDE.md`.

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
- **`Dockerfile` / `nginx.conf`** — nginx container that serves the static portfolio on the VPS.
- **`setup-ssl.sh` / `letsencrypt/`** — Let's Encrypt cert provisioning + volume mount (read-only into the portfolio container).

### VPS ops (`ops/`)
- **`ops/cert-expiry-check.sh`** — daily TLS expiry monitor. TLS-probes `prasanthebenezer.com` and `www.` and alerts via ntfy.sh at ≤20 days (WARN) / ≤7 days (CRITICAL). Deliberately independent of certbot state so it catches silent renewal failures.
- **`ops/systemd/cert-expiry-check.{service,timer}`** — systemd units for the monitor (runs 09:00 UTC daily).
- **`ops/letsencrypt-hooks/sync-and-reload.sh`** — certbot deploy hook: after renewal, copies `/etc/letsencrypt/` into `./letsencrypt/` (the read-only mount into the nginx container) and reloads nginx.

Runtime paths on the VPS (`/usr/local/bin/cert-expiry-check.sh`, `/etc/systemd/system/cert-expiry-check.{service,timer}`, `/etc/letsencrypt/renewal-hooks/deploy/sync-and-reload.sh`) are symlinks into `ops/` — so a `git pull` on the box deploys edits with no copy step. The ntfy topic lives in `/etc/cert-monitor.env` (chmod 600, not in git). All symlinks assume the repo stays at `/root/prasanthebenezer.github.io/`.

## Docker Compose

`docker-compose.yml` defines a single `portfolio` service (nginx, ports 80/443) with `./letsencrypt` and `./webroot` mounted read-only. Common ops:
```
docker compose up -d --build portfolio
docker compose logs -f portfolio
docker compose exec portfolio nginx -s reload    # after nginx.conf edits
```

`nginx.conf` terminates TLS for `prasanthebenezer.com` and redirects `www.` to the apex. Certs live under `./letsencrypt/live/<domain>/`.

## Architecture

The site is a single-page, vanilla HTML/CSS/JS portfolio with no frameworks or dependencies beyond CDN-loaded libraries:
- **Google Fonts** — Inter typeface
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

**Contact form** posts to an N8N cloud webhook URL defined directly in `index.html` on the `<form action="...">` attribute. Update that URL there if the webhook changes.

Spam protection is split between the page and n8n — keep the field names in sync:
- **Page:** a reCAPTCHA v2 checkbox (`.g-recaptcha`, site key in `data-sitekey`; Google loads it via `recaptcha/api.js`) and a hidden honeypot input `name="website"`. `handleFormSubmit()` refuses to send without a solved captcha, fakes success when the honeypot is filled, and calls `grecaptcha.reset()` after each send (tokens are single-use).
- **n8n workflow:** Webhook → HTTP Request (POST `https://www.google.com/recaptcha/api/siteverify` with `secret` + `response` = `body["g-recaptcha-response"]`) → IF (`success` is true AND `body.website` empty) → email node, which reads fields via `$('Webhook').item.json.body.*`. The secret key lives only in n8n, never in this repo.
- The webhook URL is public, so the n8n check is what actually blocks bots; the page-side checks only stop form-filling bots.

## Sections (in order)

Hero → About → Experience (timeline) → Projects (two categories: AI Automation, Industrial Automation) → Skills → Education & Certifications → Contact → Footer

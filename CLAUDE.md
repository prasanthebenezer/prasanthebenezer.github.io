# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This repo serves two deployment targets from the same tree:

1. **Static portfolio** — deployed via GitHub Pages at `https://prasanthebenezer.github.io` (root-level `index.html`, `styles.css`, `script.js`, `assets/`). No build step.
2. **VPS multi-app stack** — deployed via Docker Compose at `https://prasanthebenezer.com` and subdomains, serving the portfolio plus several sibling apps behind nginx with Let's Encrypt TLS. See `VPS-DEPLOYMENT-GUIDE.md`.

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

### Portfolio (GitHub Pages + nginx container root)
- **`index.html` / `styles.css` / `script.js`** — Live portfolio site (root level).
- **`assets/Prasanth_Philip_CV.pdf`** — CV linked from nav and footer.
- **`Dockerfile` / `nginx.conf`** — nginx container that serves the static portfolio and reverse-proxies to the other apps on the VPS.
- **`setup-ssl.sh` / `letsencrypt/`** — Let's Encrypt cert provisioning + volume mount (read-only into the portfolio container).

### Sibling apps (each is its own Docker service)
- **`calibration/`** — Calibration equipment management app. Container `calibration-app` on port 3000, served at `calibration.prasanthebenezer.com`. Env: `ADMIN_PASSWORD`, `CERT_VIEW_PASSWORD`. Volumes: `calibration-data` (SQLite), `calibration-certs`.
- **`quiz-app/`** — Live quiz app for kids (host-driven, real-time, multi-team). Container `quiz-app` on port 3100 with Postgres sidecar `quiz-db`, served at `prasanthebenezer.com/quiz/`. Requires `.env` with `QUIZ_SESSION_SECRET`, `QUIZ_DB_PASSWORD`, and `QUIZ_ADMIN_PASSWORD` or `QUIZ_ADMIN_PASSWORD_HASH`. See `quiz-app/README.md` for the game-day workflow and round types.
- **`maintenance`** service — built from `../maintenance-dashboard` (sibling repo, outside this tree). Served at `maintenance.prasanthebenezer.com`.

### Legacy / reference (do not edit unless asked)
- **`prasanth_portfolio_site/`**, **`prasanth_portfolio_site_v2/`** — earlier portfolio versions.
- **`index_old.html`, `index_y.html`, `styles_old.css`, `MyGit.html`** — legacy/experimental files.

When editing the portfolio, only touch root-level files. When editing a sibling app, stay within its subdirectory.

## Docker Compose stack

`docker-compose.yml` defines five services on a shared `web` network: `portfolio` (nginx, ports 80/443), `calibration`, `maintenance`, `quiz`, `quiz-db`. Named volumes persist data for each app. `.env` at repo root holds quiz secrets (gitignored). Common ops:
```
docker compose up -d --build <service>
docker compose logs -f <service>
docker compose exec portfolio nginx -s reload    # after nginx.conf edits
```

`nginx.conf` terminates TLS for `prasanthebenezer.com`, `www.`, `calibration.`, and `maintenance.` subdomains and proxies `/quiz/` to the quiz container. Certs live under `./letsencrypt/live/<domain>/`.

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

## Sections (in order)

Hero → About → Experience (timeline) → Projects (two categories: AI Automation, Industrial Automation) → Skills → Education & Certifications → Contact → Footer

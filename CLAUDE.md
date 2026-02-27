# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is a static personal portfolio website for Prasanth Philip, deployed via GitHub Pages at `https://prasanthebenezer.github.io`. There is no build step, bundler, or package manager — all files are served directly.

## Deployment

Pushing to `main` triggers the GitHub Actions workflow (`.github/workflows/static.yml`), which deploys the entire repository root to GitHub Pages automatically. The live site reflects the root-level files (`index.html`, `styles.css`, `script.js`, `assets/`).

To preview locally, serve the root directory with any static file server, e.g.:
```
python3 -m http.server 8000
```

## File Structure

- **`index.html` / `styles.css` / `script.js`** — The current live site (root level). This is what gets deployed.
- **`assets/Prasanth_Philip_CV.pdf`** — CV file linked from the nav and footer.
- **`prasanth_portfolio_site/`** — Earlier version (v1) of the portfolio; kept for reference.
- **`prasanth_portfolio_site_v2/`** — Intermediate version (v2); kept for reference.
- **`index_old.html`, `index_y.html`, `styles_old.css`, `MyGit.html`** — Legacy/experimental files, not part of the live site.

When making changes, only edit the root-level files unless explicitly working on an archived version.

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

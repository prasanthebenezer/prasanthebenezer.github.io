# Quiz App UI/UX Improvement Plan

Living document — update as phases complete so a fresh session can pick up where we left off.

## Context

Review of `admin.html`, `host.html`, `display.html`, `scores.html`, `styles.css`
identified friction points in host ergonomics, visual noise, and admin onboarding.
Full findings in commit history / conversation; summarized below per phase.

## Phase A — Host quick wins (DONE)

Goal: reduce friction during live quiz without large refactors.

- [x] Sticky control zone at bottom of host viewport.
- [x] Visible keyboard-shortcut hint strip under the judging zone.
- [x] Tone down `.team-card.active` — no more scale/pulse; single calm ring.
- [x] Round-progress slot track on host (compact variant).
- [x] Softer page background gradient (`#111827 → #1a2236`).
- [x] `prefers-reduced-motion` disables animations; `:focus-visible` rings added.

## Phase B — Admin onboarding (DONE)

- [x] Stepper visual completion state (locked steps dimmed, green tick on done).
- [x] Import dry-run (`POST /api/admin/import-preview`) returns counts, issues,
      and missing-image refs without touching the database.
- [x] Typed-confirmation ("IMPORT") required to enable the destructive button.
- [x] Cross-check: preview lists image filenames referenced in Excel but not
      present on disk.
- [x] Last-import timestamp stored in `config.last_import_at` and surfaced in
      Session Status card via `GET /api/admin/status`.

## Phase C — Display polish (PLANNED)

- [ ] Large circular countdown timer with red pulse in final 5s.
- [ ] 200ms crossfade between questions.
- [ ] Fluid typography via `clamp()` shared between host and display.
- [ ] Larger team names, smaller swatches on projector.

## Phase D — Accessibility & theming (PLANNED)

- [ ] Light-mode toggle persisted to localStorage.
- [ ] `:focus-visible` rings on buttons.
- [ ] Icon + aria-label pairs on judge buttons (not color-only).
- [ ] Replace emoji-heavy buttons with consistent icon set.

## Completed

- Phase A (host quick wins) — commit `47eaab4`.
- Phase B (admin onboarding) — commit pending at time of writing.

## Notes for resuming

- All UI files are under `quiz-app/frontend/`. No build step — edit HTML/CSS
  directly. Bust cache with `styles.css?v=N` bumps already in place.
- Host shortcuts + undo + step bar + display leaderboard already shipped
  (commit `32a41d2`).
- Backend routes (`quiz-app/backend/routes/host.js`) only touched when a UI
  change needs a new endpoint.

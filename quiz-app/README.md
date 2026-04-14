# Quiz App

Live quiz app for kids — host-driven, real-time, multi-team.

## Live URLs (after deploy)

- `https://prasanthebenezer.com/quiz/` — landing
- `https://prasanthebenezer.com/quiz/admin` — admin (login)
- `https://prasanthebenezer.com/quiz/host` — host controller
- `https://prasanthebenezer.com/quiz/display` — projector view
- `https://prasanthebenezer.com/quiz/scores` — scorecard

## First-time deploy on VPS

```bash
cd /root/prasanthebenezer.github.io
# 1. Create .env (once)
cp quiz-app/.env.example .env
# Generate a strong session secret:
echo "QUIZ_SESSION_SECRET=$(openssl rand -hex 32)" >> .env
# Edit .env to set QUIZ_ADMIN_PASSWORD (or _HASH) and QUIZ_DB_PASSWORD

# 2. Build + start
docker compose build quiz
docker compose up -d quiz-db quiz portfolio
docker compose exec portfolio nginx -s reload
```

## Change admin password

Preferred — use a bcrypt hash so plaintext never lives in env:
```bash
docker compose run --rm quiz npm run hash-password -- 'my new password'
# Copy the resulting $2a$... string into QUIZ_ADMIN_PASSWORD_HASH in .env
docker compose up -d quiz
```
Or set `QUIZ_ADMIN_PASSWORD` for a plaintext fallback (not recommended).

## Workflow on quiz day

1. Open `/quiz/admin`, login, download the Excel template.
2. Fill in Teams (2 or 3), MCQ/RapidFire/PassQuestion/ImageRound sheets, define Rounds.
3. Upload images (filenames must match the `image` column).
4. Import the Excel file (this wipes old data).
5. Open `/quiz/host` on your laptop, `/quiz/display` on the projector.
6. Pick a round → assign question to a team → Correct / Wrong / Pass / Skip / Next.
7. Pass logic: each pass halves the awarded points (configurable via `pass_decay` in Config sheet, default `[1, 0.5, 0.25, 0]`).

## Round types

| Type | Description |
|---|---|
| `mcq` | 4-option multiple choice |
| `rapidfire` | Quick short-answer questions |
| `pass` | Pass-through round (full pass-decay logic) |
| `image` | Picture-based question |

## Reset between sessions

Admin → "Reset Scores" (keeps questions, clears scores).

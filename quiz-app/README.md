# Quiz App

Live quiz app for kids — host-driven, real-time, multi-team.

## Live URLs (after deploy)

- `https://prasanthebenezer.com/quiz/` — landing
- `https://prasanthebenezer.com/quiz/admin` — admin (login)
- `https://prasanthebenezer.com/quiz/host` — host controller
- `https://prasanthebenezer.com/quiz/display` — projector view
- `https://prasanthebenezer.com/quiz/scores` — scorecard
- `https://prasanthebenezer.com/quiz/buzzer` — captain's mobile buzzer (one device per team)

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
2. Fill in Teams (2 or 3), MCQ/RapidFire/PassQuestion/ImageRound/Speaker sheets, define Rounds.
3. Upload images (filenames must match the `image` column) and/or audio (match the `audio` column in the Speaker sheet).
4. Import the Excel file (this wipes old data).
5. Open `/quiz/host` on your laptop, `/quiz/display` on the projector.
6. Pick a round → assign question to a team → Correct / Wrong / Pass / Skip / Next.
7. Pass logic: each pass halves the awarded points (configurable via `pass_decay` in Config sheet, default `[1, 0.5, 0.25, 0]`).
8. **Buzzer rounds:** each team captain opens `/quiz/buzzer` on their phone (same Wi-Fi or public URL) and picks their team. The host arms the buzzer (`B` shortcut), captains tap to buzz in. First press wins; host marks Correct (+points) / Wrong (−points). Other teams can pass without penalty from the host's panel.

## Round types

| Type | Description |
|---|---|
| `mcq` | 4-option multiple choice |
| `rapidfire` | Quick short-answer questions |
| `pass` | Pass-through round (full pass-decay logic) |
| `image` | Picture-based question |
| `speaker` | Play an audio clip and identify the speaker |
| `buzzer` | Captains buzz in from their phones at `/quiz/buzzer`. First press wins the chance to answer. Correct = +points, Wrong = −points, Pass = no penalty. |

## Reset between sessions

Admin → "Reset Scores" (keeps questions, clears scores).

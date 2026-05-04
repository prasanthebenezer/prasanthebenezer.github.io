const express = require('express');
const rateLimit = require('express-rate-limit');
const { pool } = require('../db');
const { snapshot } = require('../state');
const router = express.Router();

router.get('/state', async (req, res, next) => {
  try { res.json(await snapshot({ redactAnswer: true })); } catch (e) { next(e); }
});

// Rate-limit buzzer presses so a panicked captain hammering the button can't
// drown the server. The atomic UPDATE below already guarantees one winner;
// this is purely about request volume.
const buzzerLimiter = rateLimit({
  windowMs: 5 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many presses, slow down' },
});

// Public buzzer press. The single atomic UPDATE is the race-resolver: only one
// team can flip buzzer_locked_team_id from NULL to a value. Constraints in the
// WHERE clause enforce: buzzer must be armed, not already locked, current
// question matches the captain's view, and the team hasn't already attempted/
// passed on this question.
router.post('/buzzer/press', buzzerLimiter, async (req, res, next) => {
  try {
    const teamId = parseInt(req.body?.team_id, 10);
    const qId    = parseInt(req.body?.question_id, 10);
    if (!Number.isFinite(teamId) || !Number.isFinite(qId)) {
      return res.status(400).json({ error: 'team_id and question_id required' });
    }
    const team = (await pool.query('SELECT id FROM teams WHERE id=$1', [teamId])).rows[0];
    if (!team) return res.status(404).json({ error: 'unknown team' });

    const r = await pool.query(
      `UPDATE session_state
          SET buzzer_locked_team_id = $1,
              buzzer_locked_at      = NOW()
        WHERE id = 1
          AND buzzer_armed = TRUE
          AND buzzer_locked_team_id IS NULL
          AND current_question_id = $2
          AND NOT ($1 = ANY(buzzer_attempted))
          AND NOT ($1 = ANY(buzzer_passed))
        RETURNING buzzer_locked_team_id`,
      [teamId, qId]
    );
    if (!r.rows.length) {
      // Someone else won, or buzzer was disarmed / question changed / team blocked.
      return res.json({ ok: false, won: false });
    }
    const fn = req.app.get('broadcastState');
    if (fn) fn();
    res.json({ ok: true, won: true });
  } catch (e) { next(e); }
});

router.get('/scores', async (req, res) => {
  const teams = (await pool.query('SELECT * FROM teams ORDER BY position,id')).rows;
  const rows = (await pool.query(
    `SELECT s.*, t.name AS team_name, t.color AS team_color,
            q.question, q.type AS qtype, q.points AS qpoints, r.name AS round_name
     FROM scores s
     LEFT JOIN teams t ON t.id=s.team_id
     LEFT JOIN questions q ON q.id=s.question_id
     LEFT JOIN rounds r ON r.id=s.round_id
     ORDER BY s.id ASC`)).rows;
  res.json({ teams, rows });
});

module.exports = router;

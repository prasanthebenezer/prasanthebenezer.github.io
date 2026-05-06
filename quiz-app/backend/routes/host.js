const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('./auth');
const { snapshot, getTimerEnabled } = require('../state');

const router = express.Router();
router.use(requireAuth);

const broadcast = (req) => {
  const fn = req.app.get('broadcastState');
  if (fn) fn();
};

router.get('/state', async (req, res, next) => {
  try { res.json(await snapshot({ redactAnswer: false })); } catch (e) { next(e); }
});

const RESET_Q_FIELDS = `pass_level=0, hint_level=0, revealed=FALSE, attempted=FALSE,
 selected_option=NULL, wrong_options='{}', removed_option=NULL, clue=NULL,
 timer_started_at=NULL, timer_duration=NULL, original_team_id=NULL,
 last_result=NULL,
 buzzer_armed=FALSE, buzzer_locked_team_id=NULL, buzzer_locked_at=NULL,
 buzzer_attempted='{}', buzzer_passed='{}'`;

// Single source of truth for buzzer activation: the buzzer is live whenever a
// buzzer-type question is the one being shown on the projector. Switching to
// rules / leaderboard / hidden modes pulls the buzzer down (and clears any
// stale lock) so captains can't buzz on a screen they aren't supposed to be
// answering. Manual disarm is still possible via /buzzer/disarm.
// When the global timer toggle is on, auto-start the countdown for any
// question that has time_sec set. Called after every transition that
// puts a question on the projector. No-op if timer disabled, no current
// question, no time_sec, or projector isn't on the question screen.
// First pass halves the duration; subsequent passes keep it halved.
async function autoStartTimer() {
  if (!(await getTimerEnabled())) return;
  const r = await pool.query(`
    SELECT ss.current_question_id, ss.display_mode, ss.pass_level, q.time_sec
      FROM session_state ss
      LEFT JOIN questions q ON q.id = ss.current_question_id
     WHERE ss.id = 1`);
  const row = r.rows[0];
  if (!row || !row.current_question_id) return;
  if (row.display_mode !== 'question') return;
  if (!row.time_sec || row.time_sec <= 0) return;
  const base = row.time_sec;
  const dur = (row.pass_level || 0) >= 1 ? Math.max(1, Math.ceil(base / 2)) : base;
  await pool.query(
    'UPDATE session_state SET timer_started_at=NOW(), timer_duration=$1 WHERE id=1',
    [dur]
  );
}

const SYNC_BUZZER_SQL = `
  UPDATE session_state ss SET
    buzzer_armed = (
      ss.current_question_id IS NOT NULL
      AND ss.display_mode = 'question'
      AND ss.attempted = FALSE
      AND (SELECT type FROM rounds WHERE id = ss.current_round_id) = 'buzzer'
    ),
    buzzer_locked_team_id = CASE
      WHEN ss.display_mode <> 'question' OR ss.current_question_id IS NULL THEN NULL
      ELSE ss.buzzer_locked_team_id
    END,
    buzzer_locked_at = CASE
      WHEN ss.display_mode <> 'question' OR ss.current_question_id IS NULL THEN NULL
      ELSE ss.buzzer_locked_at
    END
  WHERE id=1`;
const syncBuzzer = () => pool.query(SYNC_BUZZER_SQL);

router.post('/select-round/:id', async (req, res, next) => {
  try {
    const r = await pool.query('SELECT * FROM rounds WHERE id=$1', [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'not found' });
    const round = r.rows[0];
    const firstQ = round.question_ids[0] || null;
    // If the round has rules, start the projector on the rules screen so the
    // host can brief the room before any question is revealed; otherwise jump
    // straight into questions. Buzzer arm follows from display_mode below.
    const startMode = (round.rules && String(round.rules).trim()) ? 'rules' : 'question';
    await pool.query(
      `UPDATE session_state SET current_round_id=$1, current_question_id=$2, display_mode=$3, ${RESET_Q_FIELDS} WHERE id=1`,
      [round.id, firstQ, startMode]
    );
    await syncBuzzer();
    await autoStartTimer();
    broadcast(req); res.json({ ok: true, mode: startMode });
  } catch (e) { next(e); }
});

router.post('/shuffle-round', async (req, res, next) => {
  try {
    const state = (await pool.query('SELECT current_round_id FROM session_state WHERE id=1')).rows[0];
    if (!state?.current_round_id) return res.status(400).json({ error: 'no round selected' });
    const r = await pool.query('SELECT * FROM rounds WHERE id=$1', [state.current_round_id]);
    const round = r.rows[0];
    if (!round) return res.status(404).json({ error: 'round not found' });
    const ids = [...round.question_ids];
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    await pool.query('UPDATE rounds SET question_ids=$1 WHERE id=$2', [ids, round.id]);
    await pool.query(
      `UPDATE session_state SET current_question_id=$1, ${RESET_Q_FIELDS} WHERE id=1`,
      [ids[0] || null]
    );
    await syncBuzzer();
    await autoStartTimer();
    broadcast(req); res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/select-question/:qid', async (req, res, next) => {
  try {
    await pool.query(
      `UPDATE session_state SET current_question_id=$1, ${RESET_Q_FIELDS} WHERE id=1`,
      [req.params.qid]
    );
    await syncBuzzer();
    await autoStartTimer();
    broadcast(req); res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/assign-team/:tid', async (req, res, next) => {
  try {
    await pool.query('UPDATE session_state SET current_team_id=$1, attempted=FALSE WHERE id=1', [req.params.tid]);
    broadcast(req); res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/reveal', async (req, res, next) => {
  try {
    await pool.query('UPDATE session_state SET revealed=TRUE WHERE id=1');
    broadcast(req); res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/select-option/:opt', async (req, res, next) => {
  try {
    const opt = String(req.params.opt).toLowerCase();
    await pool.query('UPDATE session_state SET selected_option=$1 WHERE id=1', [opt === 'clear' ? null : opt]);
    broadcast(req); res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/start-timer', async (req, res, next) => {
  try {
    if (!(await getTimerEnabled())) return res.status(400).json({ error: 'timer disabled' });
    const state = (await pool.query('SELECT * FROM session_state WHERE id=1')).rows[0];
    if (!state.current_question_id) return res.status(400).json({ error: 'no question' });
    const q = (await pool.query('SELECT time_sec FROM questions WHERE id=$1', [state.current_question_id])).rows[0];
    const base = q?.time_sec || 30;
    // First pass halves the timer; subsequent passes keep that halved value.
    const dur = (state.pass_level || 0) >= 1 ? Math.max(1, Math.ceil(base / 2)) : base;
    await pool.query('UPDATE session_state SET timer_started_at=NOW(), timer_duration=$1 WHERE id=1', [dur]);
    broadcast(req); res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/stop-timer', async (req, res, next) => {
  try {
    await pool.query('UPDATE session_state SET timer_started_at=NULL, timer_duration=NULL WHERE id=1');
    broadcast(req); res.json({ ok: true });
  } catch (e) { next(e); }
});

async function award(state, teamId, result, opts = {}) {
  const q = (await pool.query('SELECT * FROM questions WHERE id=$1', [state.current_question_id])).rows[0];
  const lvl = (state.pass_level || 0) + (state.hint_level || 0);
  // Pass decay is one-shot: original team gets full points; the moment any
  // pass (or hint) is used, points drop to 50% and stay there — further
  // passes never decay deeper. Hardcoded so a stale [1,0.5,0.25,0] from an
  // older template import can't reintroduce quartering.
  const factor = lvl >= 1 ? 0.5 : 1.0;
  let pts = 0;
  if (result === 'correct') pts = Math.round((q.points || 0) * factor);
  if (result === 'wrong')   pts = opts.negative ? -Math.round((q.points || 0) * factor) : 0;
  if (typeof opts.override === 'number') pts = opts.override;
  await pool.query(
    `INSERT INTO scores(team_id,question_id,round_id,points_awarded,was_passed,pass_level,result,note)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [teamId, q.id, state.current_round_id, pts, lvl > 0, lvl, result, opts.note || null]
  );
  if (pts) await pool.query('UPDATE teams SET score=score+$1 WHERE id=$2', [pts, teamId]);
  return pts;
}

router.post('/answer/:result', async (req, res, next) => {
  try {
    const result = req.params.result;
    if (!['correct', 'wrong', 'auto'].includes(result)) return res.status(400).json({ error: 'invalid result' });
    const state = (await pool.query('SELECT * FROM session_state WHERE id=1')).rows[0];
    if (!state.current_question_id || !state.current_team_id) return res.status(400).json({ error: 'no question/team selected' });
    if (state.attempted) return res.status(400).json({ error: 'team already attempted' });
    let actual = result;
    if (result === 'auto') {
      const q = (await pool.query('SELECT answer FROM questions WHERE id=$1', [state.current_question_id])).rows[0];
      actual = (state.selected_option && q && state.selected_option.toLowerCase() === String(q.answer).toLowerCase()) ? 'correct' : 'wrong';
    }
    const pts = await award(state, state.current_team_id, actual);
    // Stop the timer once the team has been judged. It will only restart on
    // a pass (halved) or when the host advances to the next question.
    if (actual === 'correct') {
      await pool.query(
        `UPDATE session_state SET revealed=TRUE, attempted=TRUE, last_result='correct',
                                  timer_started_at=NULL, timer_duration=NULL
          WHERE id=1`
      );
    } else {
      // Track wrong MCQ option so it renders yellow for subsequent teams.
      // Do NOT set revealed=TRUE on wrong — the next team may still pass-attempt,
      // so the correct answer must stay hidden until the host explicitly Reveals
      // or a team gets it right.
      const q = (await pool.query('SELECT type FROM questions WHERE id=$1', [state.current_question_id])).rows[0];
      if (q?.type === 'mcq' && state.selected_option) {
        await pool.query(
          `UPDATE session_state
             SET attempted=TRUE, last_result='wrong',
                 timer_started_at=NULL, timer_duration=NULL,
                 wrong_options = CASE WHEN $1 = ANY(wrong_options) THEN wrong_options
                                      ELSE array_append(wrong_options, $1) END
           WHERE id=1`,
          [state.selected_option]
        );
      } else {
        await pool.query(
          `UPDATE session_state SET attempted=TRUE, last_result='wrong',
                                    timer_started_at=NULL, timer_duration=NULL
            WHERE id=1`
        );
      }
    }
    broadcast(req); res.json({ ok: true, pts, result: actual });
  } catch (e) { next(e); }
});

router.post('/pass', async (req, res, next) => {
  try {
    const state = (await pool.query('SELECT * FROM session_state WHERE id=1')).rows[0];
    if (!state.current_question_id || !state.current_team_id) return res.status(400).json({ error: 'no question/team selected' });
    // Pass is blocked once the question is closed by a correct answer. After a
    // wrong answer the host can still rotate to the next team — the wrong team
    // keeps its penalty and the next team picks up at the halved pass factor.
    if (state.last_result === 'correct') return res.status(400).json({ error: 'team already answered correctly — cannot pass' });
    const teams = (await pool.query('SELECT id FROM teams ORDER BY position,id')).rows;
    // Pass cannot loop — every team gets at most one chance per question.
    // After (teams.length - 1) passes the next pass would wrap back to the
    // original team, so block it.
    if ((state.pass_level || 0) >= Math.max(0, teams.length - 1)) {
      return res.status(400).json({ error: 'all teams have had a chance — cannot pass further' });
    }
    // Skip the synthetic "pass" score row when the team already has a wrong
    // record for this question — we don't want to double-record their attempt.
    if (!state.attempted) {
      await award(state, state.current_team_id, 'pass', { note: 'passed' });
    }
    const idx = teams.findIndex((t) => t.id === state.current_team_id);
    const next = teams[(idx + 1) % teams.length];
    const origTeam = state.original_team_id || state.current_team_id;
    await pool.query(
      `UPDATE session_state SET current_team_id=$1, pass_level=pass_level+1,
                                attempted=FALSE, last_result=NULL,
                                original_team_id=$2 WHERE id=1`,
      [next.id, origTeam]
    );
    // pass_level just incremented to >= 1, so autoStartTimer halves the duration.
    await autoStartTimer();
    broadcast(req); res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/skip', async (req, res, next) => {
  try {
    const state = (await pool.query('SELECT * FROM session_state WHERE id=1')).rows[0];
    if (state.current_question_id) {
      await pool.query(
        `INSERT INTO scores(team_id,question_id,round_id,points_awarded,result,note)
         VALUES($1,$2,$3,0,'skip','skipped')`,
        [state.current_team_id, state.current_question_id, state.current_round_id]
      );
    }
    await advance(req); res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/next', async (req, res, next) => {
  try { await advance(req); res.json({ ok: true }); } catch (e) { next(e); }
});

async function advance(req) {
  const state = (await pool.query('SELECT * FROM session_state WHERE id=1')).rows[0];
  if (!state.current_round_id) return;
  const round = (await pool.query('SELECT * FROM rounds WHERE id=$1', [state.current_round_id])).rows[0];
  const ids = round.question_ids;
  const idx = ids.indexOf(state.current_question_id);
  const nextQ = idx >= 0 && idx < ids.length - 1 ? ids[idx + 1] : null;

  // Auto-rotate team on advance (except rapidfire, which is host-paced per-team).
  // If the current question was passed, rotate based on the original pre-pass team
  // so that the team after the passer gets the next question.
  const rotateBase = state.original_team_id || state.current_team_id;
  let nextTeam = rotateBase;
  if (round.type !== 'rapidfire' && rotateBase) {
    const teams = (await pool.query('SELECT id FROM teams ORDER BY position,id')).rows;
    if (teams.length) {
      const tIdx = teams.findIndex((t) => t.id === rotateBase);
      nextTeam = teams[(tIdx + 1) % teams.length].id;
    }
  }

  await pool.query(
    `UPDATE session_state SET current_question_id=$1, current_team_id=$2, ${RESET_Q_FIELDS} WHERE id=1`,
    [nextQ, nextTeam]
  );
  await syncBuzzer();
  await autoStartTimer();
  broadcast(req);
}

router.post('/remove-option/:opt', async (req, res, next) => {
  try {
    const opt = String(req.params.opt).toLowerCase();
    if (!['a','b','c','d',''].includes(opt) && opt !== 'clear') return res.status(400).json({ error: 'invalid option' });
    const state = (await pool.query('SELECT removed_option FROM session_state WHERE id=1')).rows[0];
    if (opt === 'clear' || opt === '') {
      await pool.query('UPDATE session_state SET removed_option=NULL WHERE id=1');
    } else {
      // Only increment hint_level when first introducing a removal
      const increment = state.removed_option ? 0 : 1;
      await pool.query(
        'UPDATE session_state SET removed_option=$1, hint_level=hint_level+$2 WHERE id=1',
        [opt, increment]
      );
    }
    broadcast(req); res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/set-clue', async (req, res, next) => {
  try {
    const text = typeof req.body?.text === 'string' ? req.body.text.slice(0, 500) : '';
    const state = (await pool.query('SELECT clue FROM session_state WHERE id=1')).rows[0];
    if (!text) {
      await pool.query('UPDATE session_state SET clue=NULL WHERE id=1');
    } else {
      const increment = state.clue ? 0 : 1;
      await pool.query(
        'UPDATE session_state SET clue=$1, hint_level=hint_level+$2 WHERE id=1',
        [text, increment]
      );
    }
    broadcast(req); res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/undo-last', async (req, res, next) => {
  try {
    // Undo the most recent scores row created in the last 10 minutes.
    // Reverses team points and resets the "attempted" flag so the team can be re-judged.
    const r = await pool.query(
      `SELECT * FROM scores WHERE created_at > NOW() - INTERVAL '10 minutes'
       ORDER BY id DESC LIMIT 1`
    );
    const row = r.rows[0];
    if (!row) return res.status(400).json({ error: 'Nothing to undo (10 min window)' });
    if (row.points_awarded && row.team_id) {
      await pool.query('UPDATE teams SET score=score-$1 WHERE id=$2', [row.points_awarded, row.team_id]);
    }
    await pool.query('DELETE FROM scores WHERE id=$1', [row.id]);

    // If undoing a scoring event on the current question, reset attempted state
    // so the team can attempt again or be reassigned.
    const state = (await pool.query('SELECT * FROM session_state WHERE id=1')).rows[0];
    if (row.question_id && row.question_id === state.current_question_id) {
      if (row.result === 'wrong' && state.wrong_options?.length) {
        await pool.query(
          `UPDATE session_state
             SET attempted=FALSE, last_result=NULL,
                 wrong_options = wrong_options[1:array_length(wrong_options,1)-1]
           WHERE id=1`
        );
      } else if (row.result === 'correct') {
        await pool.query('UPDATE session_state SET attempted=FALSE, revealed=FALSE, last_result=NULL WHERE id=1');
      } else if (row.result === 'pass') {
        // Revert: restore passer as current team, decrement pass_level,
        // clear original_team_id if no more active passes remain.
        const newLvl = Math.max((state.pass_level || 0) - 1, 0);
        await pool.query(
          `UPDATE session_state
             SET current_team_id=$1,
                 pass_level=$2,
                 attempted=FALSE,
                 last_result=NULL,
                 original_team_id = CASE WHEN $2 = 0 THEN NULL ELSE original_team_id END
           WHERE id=1`,
          [row.team_id, newLvl]
        );
      } else {
        await pool.query('UPDATE session_state SET attempted=FALSE, last_result=NULL WHERE id=1');
      }
    }
    broadcast(req); res.json({ ok: true, undone: row.result, pts: row.points_awarded });
  } catch (e) { next(e); }
});

// Switch what the projector shows: 'question' (normal), 'leaderboard'
// (force-show ranked teams), or 'hidden' (clear question area). Affects
// only the public broadcast — host view always sees the live question.
router.post('/display-mode/:mode', async (req, res, next) => {
  try {
    const mode = String(req.params.mode || '').toLowerCase();
    if (!['question', 'leaderboard', 'hidden', 'rules', 'intro', 'finale'].includes(mode)) {
      return res.status(400).json({ error: 'invalid display mode' });
    }
    await pool.query('UPDATE session_state SET display_mode=$1 WHERE id=1', [mode]);
    // Mode change implicitly enables/disables the buzzer for buzzer rounds.
    await syncBuzzer();
    // Stop the timer when leaving the question screen; start it when arriving.
    if (mode === 'question') {
      await autoStartTimer();
    } else {
      await pool.query('UPDATE session_state SET timer_started_at=NULL, timer_duration=NULL WHERE id=1');
    }
    broadcast(req); res.json({ ok: true, mode });
  } catch (e) { next(e); }
});

router.post('/adjust', async (req, res, next) => {
  try {
    const { team_id, delta, note } = req.body || {};
    const tid = parseInt(team_id, 10);
    const d = parseInt(delta, 10);
    if (!Number.isFinite(tid) || !Number.isFinite(d)) return res.status(400).json({ error: 'team_id and delta required' });
    await pool.query('UPDATE teams SET score=score+$1 WHERE id=$2', [d, tid]);
    await pool.query(
      `INSERT INTO scores(team_id,points_awarded,result,note) VALUES($1,$2,'adjust',$3)`,
      [tid, d, note || 'manual adjust']
    );
    broadcast(req); res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------- Buzzer round ----------
//
// Flow: host arms the buzzer for the current question → captains' phones light
// up → first valid press atomically locks the buzzer to that team → host
// judges. Correct = +full points; Wrong = −half points (calibrated guess
// penalty); Pass is free.

router.post('/buzzer/arm', async (req, res, next) => {
  try {
    const state = (await pool.query('SELECT current_question_id FROM session_state WHERE id=1')).rows[0];
    if (!state.current_question_id) return res.status(400).json({ error: 'no question' });
    await pool.query(
      `UPDATE session_state SET buzzer_armed=TRUE, buzzer_locked_team_id=NULL, buzzer_locked_at=NULL WHERE id=1`
    );
    broadcast(req); res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/buzzer/disarm', async (req, res, next) => {
  try {
    await pool.query(
      `UPDATE session_state SET buzzer_armed=FALSE, buzzer_locked_team_id=NULL, buzzer_locked_at=NULL WHERE id=1`
    );
    broadcast(req); res.json({ ok: true });
  } catch (e) { next(e); }
});

// Clear the lock without disarming, so the next-fastest team can buzz in
// (used when the locked team passes).
router.post('/buzzer/reset', async (req, res, next) => {
  try {
    await pool.query(
      `UPDATE session_state SET buzzer_locked_team_id=NULL, buzzer_locked_at=NULL, buzzer_armed=TRUE WHERE id=1`
    );
    broadcast(req); res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/buzzer/judge/:result', async (req, res, next) => {
  try {
    const result = req.params.result;
    if (!['correct', 'wrong'].includes(result)) return res.status(400).json({ error: 'invalid result' });
    const state = (await pool.query('SELECT * FROM session_state WHERE id=1')).rows[0];
    if (!state.current_question_id) return res.status(400).json({ error: 'no question' });
    const teamId = state.buzzer_locked_team_id;
    if (!teamId) return res.status(400).json({ error: 'no team locked' });
    const q = (await pool.query('SELECT * FROM questions WHERE id=$1', [state.current_question_id])).rows[0];
    const base = q?.points || 0;
    // Correct = +full points; wrong = −half points (less harsh than the full
    // negative the question is worth, so a guess on a buzzer is calibrated).
    const pts = result === 'correct' ? base : -Math.ceil(base / 2);
    await pool.query(
      `INSERT INTO scores(team_id,question_id,round_id,points_awarded,result,note)
       VALUES($1,$2,$3,$4,$5,$6)`,
      [teamId, q.id, state.current_round_id, pts, result, 'buzzer']
    );
    if (pts) await pool.query('UPDATE teams SET score=score+$1 WHERE id=$2', [pts, teamId]);
    if (result === 'correct') {
      // Question is over — disarm, reveal, and stop the timer so the audience
      // sees the answer and the countdown doesn't keep ticking after the win.
      await pool.query(
        `UPDATE session_state
           SET revealed=TRUE, attempted=TRUE, last_result='correct',
               buzzer_armed=FALSE,
               buzzer_locked_team_id=NULL, buzzer_locked_at=NULL,
               timer_started_at=NULL, timer_duration=NULL,
               buzzer_attempted = CASE WHEN $1 = ANY(buzzer_attempted) THEN buzzer_attempted
                                        ELSE array_append(buzzer_attempted, $1) END
         WHERE id=1`,
        [teamId]
      );
    } else {
      // Wrong — keep buzzer armed so other teams can try, but block this team.
      // last_result='wrong' lets the projector fire the wrong-answer cue; it'll
      // be cleared again the moment the next team locks the buzzer.
      await pool.query(
        `UPDATE session_state
           SET buzzer_locked_team_id=NULL, buzzer_locked_at=NULL, buzzer_armed=TRUE,
               last_result='wrong',
               buzzer_attempted = CASE WHEN $1 = ANY(buzzer_attempted) THEN buzzer_attempted
                                        ELSE array_append(buzzer_attempted, $1) END
         WHERE id=1`,
        [teamId]
      );
    }
    broadcast(req); res.json({ ok: true, pts, team_id: teamId });
  } catch (e) { next(e); }
});

// A team opts out of attempting on this question — no score change. They're
// added to buzzer_passed so the buzzer disables on their phone for this Q.
router.post('/buzzer/pass-team/:tid', async (req, res, next) => {
  try {
    const tid = parseInt(req.params.tid, 10);
    if (!Number.isFinite(tid)) return res.status(400).json({ error: 'invalid team' });
    await pool.query(
      `UPDATE session_state
         SET buzzer_passed = CASE WHEN $1 = ANY(buzzer_passed) THEN buzzer_passed
                                   ELSE array_append(buzzer_passed, $1) END,
             buzzer_locked_team_id = CASE WHEN buzzer_locked_team_id=$1 THEN NULL ELSE buzzer_locked_team_id END,
             buzzer_locked_at      = CASE WHEN buzzer_locked_team_id=$1 THEN NULL ELSE buzzer_locked_at END
       WHERE id=1`,
      [tid]
    );
    broadcast(req); res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;

const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('./auth');
const { snapshot, getDecay } = require('../state');

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
 timer_started_at=NULL, timer_duration=NULL, original_team_id=NULL`;

router.post('/select-round/:id', async (req, res, next) => {
  try {
    const r = await pool.query('SELECT * FROM rounds WHERE id=$1', [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'not found' });
    const round = r.rows[0];
    const firstQ = round.question_ids[0] || null;
    await pool.query(
      `UPDATE session_state SET current_round_id=$1, current_question_id=$2, ${RESET_Q_FIELDS} WHERE id=1`,
      [round.id, firstQ]
    );
    broadcast(req); res.json({ ok: true });
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
    broadcast(req); res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/select-question/:qid', async (req, res, next) => {
  try {
    await pool.query(
      `UPDATE session_state SET current_question_id=$1, ${RESET_Q_FIELDS} WHERE id=1`,
      [req.params.qid]
    );
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
    const state = (await pool.query('SELECT * FROM session_state WHERE id=1')).rows[0];
    if (!state.current_question_id) return res.status(400).json({ error: 'no question' });
    const q = (await pool.query('SELECT time_sec FROM questions WHERE id=$1', [state.current_question_id])).rows[0];
    const dur = q?.time_sec || 30;
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
  const decay = await getDecay();
  const lvl = (state.pass_level || 0) + (state.hint_level || 0);
  const factor = decay[Math.min(lvl, decay.length - 1)] || 0;
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
    if (actual === 'correct') {
      await pool.query('UPDATE session_state SET revealed=TRUE, attempted=TRUE WHERE id=1');
    } else {
      // Track wrong MCQ option so it renders yellow for subsequent teams
      const q = (await pool.query('SELECT type FROM questions WHERE id=$1', [state.current_question_id])).rows[0];
      if (q?.type === 'mcq' && state.selected_option) {
        await pool.query(
          `UPDATE session_state
             SET attempted=TRUE, revealed=TRUE,
                 wrong_options = CASE WHEN $1 = ANY(wrong_options) THEN wrong_options
                                      ELSE array_append(wrong_options, $1) END
           WHERE id=1`,
          [state.selected_option]
        );
      } else {
        await pool.query('UPDATE session_state SET attempted=TRUE, revealed=TRUE WHERE id=1');
      }
    }
    broadcast(req); res.json({ ok: true, pts, result: actual });
  } catch (e) { next(e); }
});

router.post('/pass', async (req, res, next) => {
  try {
    const state = (await pool.query('SELECT * FROM session_state WHERE id=1')).rows[0];
    if (!state.current_question_id || !state.current_team_id) return res.status(400).json({ error: 'no question/team selected' });
    if (state.attempted) return res.status(400).json({ error: 'team already attempted — cannot pass' });
    await award(state, state.current_team_id, 'pass', { note: 'passed' });
    const teams = (await pool.query('SELECT id FROM teams ORDER BY position,id')).rows;
    const idx = teams.findIndex((t) => t.id === state.current_team_id);
    const next = teams[(idx + 1) % teams.length];
    const origTeam = state.original_team_id || state.current_team_id;
    await pool.query(
      'UPDATE session_state SET current_team_id=$1, pass_level=pass_level+1, attempted=FALSE, original_team_id=$2 WHERE id=1',
      [next.id, origTeam]
    );
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
             SET attempted=FALSE,
                 wrong_options = wrong_options[1:array_length(wrong_options,1)-1]
           WHERE id=1`
        );
      } else if (row.result === 'correct') {
        await pool.query('UPDATE session_state SET attempted=FALSE, revealed=FALSE WHERE id=1');
      } else if (row.result === 'pass') {
        // Revert: restore passer as current team, decrement pass_level,
        // clear original_team_id if no more active passes remain.
        const newLvl = Math.max((state.pass_level || 0) - 1, 0);
        await pool.query(
          `UPDATE session_state
             SET current_team_id=$1,
                 pass_level=$2,
                 attempted=FALSE,
                 original_team_id = CASE WHEN $2 = 0 THEN NULL ELSE original_team_id END
           WHERE id=1`,
          [row.team_id, newLvl]
        );
      } else {
        await pool.query('UPDATE session_state SET attempted=FALSE WHERE id=1');
      }
    }
    broadcast(req); res.json({ ok: true, undone: row.result, pts: row.points_awarded });
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

module.exports = router;

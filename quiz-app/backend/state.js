const { pool } = require('./db');

// Pass decay: original team gets full points, every pass thereafter is 50%.
// (No further decay on subsequent passes — explicit tail of 0.5 ensures any
// out-of-range index also lands on 50%.)
const DEFAULT_DECAY = [1.0, 0.5];

async function getDecay() {
  const r = await pool.query("SELECT value FROM config WHERE key='pass_decay'");
  const v = r.rows[0]?.value;
  if (Array.isArray(v) && v.length) return v;
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch {}
  }
  return DEFAULT_DECAY;
}

async function getConfigValue(key) {
  const r = await pool.query('SELECT value FROM config WHERE key=$1', [key]);
  return r.rows[0]?.value ?? null;
}

async function getTimerEnabled() {
  const v = await getConfigValue('timer_enabled');
  if (v === null || v === undefined) return true;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    try { const p = JSON.parse(v); if (typeof p === 'boolean') return p; } catch {}
    return v.toLowerCase() === 'true';
  }
  return Boolean(v);
}

async function snapshot({ redactAnswer = false } = {}) {
  const teams   = (await pool.query('SELECT id,name,color,score,position FROM teams ORDER BY position,id')).rows;
  const rounds  = (await pool.query('SELECT id,round_no,name,type,question_ids,rules FROM rounds ORDER BY round_no')).rows;
  const state   = (await pool.query('SELECT * FROM session_state WHERE id=1')).rows[0];
  const title   = await getConfigValue('quiz_title');
  const timerEnabled = await getTimerEnabled();
  let question = null, round = null;
  if (state.current_question_id) {
    question = (await pool.query(
      'SELECT id,type,question,options,answer,points,time_sec,image,audio FROM questions WHERE id=$1',
      [state.current_question_id]
    )).rows[0] || null;
    // Buzzer answers stay hidden from the public projector until the host reveals
    // (mirrors mcq behaviour) — captains shouldn't see the answer on their phone.
    if (question && redactAnswer && !state.revealed) question.answer = null;
  }
  if (state.current_round_id) {
    round = (await pool.query(
      'SELECT id,round_no,name,type,question_ids,rules FROM rounds WHERE id=$1',
      [state.current_round_id]
    )).rows[0] || null;
  }
  const recent = (await pool.query(
    `SELECT s.*, t.name AS team_name, q.question
       FROM scores s
       LEFT JOIN teams t ON t.id=s.team_id
       LEFT JOIN questions q ON q.id=s.question_id
      ORDER BY s.id DESC LIMIT 10`
  )).rows;
  return { title, teams, rounds, state, question, round, recent, config: { timer_enabled: timerEnabled } };
}

function makeBroadcaster(io, logger) {
  return async function broadcastState() {
    try {
      const [hostSnap, publicSnap] = await Promise.all([
        snapshot({ redactAnswer: false }),
        snapshot({ redactAnswer: true }),
      ]);
      io.of('/host').emit('state', hostSnap);
      io.of('/public').emit('state', publicSnap);
    } catch (e) {
      (logger || console).error({ err: e.message }, '[broadcast] failed');
    }
  };
}

module.exports = { getDecay, getTimerEnabled, snapshot, makeBroadcaster, DEFAULT_DECAY };

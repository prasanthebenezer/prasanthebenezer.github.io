const { pool } = require('./db');

const DEFAULT_DECAY = [1.0, 0.5, 0.25, 0];

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

async function snapshot({ redactAnswer = false } = {}) {
  const teams   = (await pool.query('SELECT id,name,color,score,position FROM teams ORDER BY position,id')).rows;
  const rounds  = (await pool.query('SELECT id,round_no,name,type,question_ids FROM rounds ORDER BY round_no')).rows;
  const state   = (await pool.query('SELECT * FROM session_state WHERE id=1')).rows[0];
  const title   = await getConfigValue('quiz_title');
  let question = null, round = null;
  if (state.current_question_id) {
    question = (await pool.query(
      'SELECT id,type,question,options,answer,points,time_sec,image,audio FROM questions WHERE id=$1',
      [state.current_question_id]
    )).rows[0] || null;
    if (question && redactAnswer && !state.revealed) question.answer = null;
  }
  if (state.current_round_id) {
    round = (await pool.query(
      'SELECT id,round_no,name,type,question_ids FROM rounds WHERE id=$1',
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
  return { title, teams, rounds, state, question, round, recent };
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

module.exports = { getDecay, snapshot, makeBroadcaster, DEFAULT_DECAY };

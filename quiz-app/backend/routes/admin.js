const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');
const { pool, withTransaction } = require('../db');
const { requireAuth } = require('./auth');
const { getTimerEnabled } = require('../state');

const router = express.Router();
router.use(requireAuth);

const UPLOAD_DIR = process.env.UPLOAD_DIR || '/app/uploads';
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const SAFE_NAME = /^[A-Za-z0-9._-]+\.(png|jpe?g|gif|webp)$/i;
const SAFE_AUDIO = /^[A-Za-z0-9._-]+\.(mp3|wav|m4a|ogg|oga|webm|aac)$/i;
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp)$/i;
const AUDIO_EXT_RE = /\.(mp3|wav|m4a|ogg|oga|webm|aac)$/i;
const sanitize = (name) => path.basename(String(name || '')).replace(/[^A-Za-z0-9._-]/g, '_');

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const safe = sanitize(file.originalname);
      if (!SAFE_NAME.test(safe)) return cb(new Error('Unsupported image filename'));
      cb(null, safe);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024, files: 50 },
});

const audioUpload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const safe = sanitize(file.originalname);
      if (!SAFE_AUDIO.test(safe)) return cb(new Error('Unsupported audio filename'));
      cb(null, safe);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024, files: 30 },
});

const memUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// Parse an uploaded Excel and return counts + validation issues
// without touching the database. Used by admin dry-run preview.
function parseExcelSummary(buffer) {
  const wb = xlsx.read(buffer, { type: 'buffer' });
  const get = (n) => (wb.Sheets[n] ? xlsx.utils.sheet_to_json(wb.Sheets[n]) : []);
  const teams = get('Teams').filter((r) => r.name);
  const mcq = get('MCQ').filter((r) => r.question && r.correct != null);
  const rapid = get('RapidFire').filter((r) => r.question && r.answer != null);
  const pass = get('PassQuestion').filter((r) => r.question && r.answer != null);
  const image = get('ImageRound').filter((r) => r.question && r.answer != null);
  const speaker = get('Speaker').filter((r) => r.question && r.answer != null);
  const buzzer = get('Buzzer').filter((r) => r.question && r.answer != null);
  const rounds = get('Rounds').filter((r) => r.round_no && r.type);

  const issues = [];
  if (!teams.length) issues.push('No teams defined in the Teams sheet');
  if (!rounds.length) issues.push('No rounds defined in the Rounds sheet');
  const validTypes = new Set(['mcq', 'rapidfire', 'pass', 'image', 'speaker', 'buzzer']);
  for (const r of rounds) {
    if (!validTypes.has(r.type)) issues.push(`Round ${r.round_no}: unknown type "${r.type}"`);
  }

  const refImages = new Set();
  for (const r of [...mcq, ...rapid, ...pass, ...image, ...buzzer]) {
    if (r.image) refImages.add(String(r.image));
  }
  const refAudio = new Set();
  for (const r of speaker) {
    if (r.audio) refAudio.add(String(r.audio));
  }

  return {
    counts: {
      teams: teams.length,
      mcq: mcq.length,
      rapidfire: rapid.length,
      pass: pass.length,
      image: image.length,
      speaker: speaker.length,
      buzzer: buzzer.length,
      questions: mcq.length + rapid.length + pass.length + image.length + speaker.length + buzzer.length,
      rounds: rounds.length,
    },
    issues,
    imageRefs: [...refImages],
    audioRefs: [...refAudio],
  };
}

router.post('/import-preview', memUpload.single('file'), (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file is required' });
    const summary = parseExcelSummary(req.file.buffer);
    const files = fs.readdirSync(UPLOAD_DIR);
    const haveImages = new Set(files.filter((f) => IMAGE_EXT_RE.test(f)));
    const haveAudio  = new Set(files.filter((f) => AUDIO_EXT_RE.test(f)));
    const missingImages = summary.imageRefs.filter((n) => !haveImages.has(n));
    const missingAudio  = summary.audioRefs.filter((n) => !haveAudio.has(n));
    res.json({
      ok: true,
      counts: summary.counts,
      issues: summary.issues,
      missingImages,
      missingAudio,
    });
  } catch (e) { next(e); }
});

router.post('/import-excel', memUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file is required' });
    const wb = xlsx.read(req.file.buffer, { type: 'buffer' });
    const get = (n) => (wb.Sheets[n] ? xlsx.utils.sheet_to_json(wb.Sheets[n]) : []);

    const counts = await withTransaction(async (client) => {
      await client.query('TRUNCATE questions, rounds, teams, scores RESTART IDENTITY CASCADE');
      await client.query(
        `UPDATE session_state SET current_round_id=NULL, current_question_id=NULL,
         current_team_id=NULL, pass_level=0, revealed=FALSE, attempted=FALSE,
         selected_option=NULL, timer_started_at=NULL, timer_duration=NULL WHERE id=1`
      );

      for (const row of get('Config')) {
        if (row.key) {
          await client.query(
            'INSERT INTO config(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=$2',
            [row.key, JSON.stringify(row.value)]
          );
        }
      }

      for (const [i, row] of get('Teams').entries()) {
        if (row.name) {
          await client.query(
            'INSERT INTO teams(name,color,position) VALUES($1,$2,$3)',
            [row.name, row.color || '#3b82f6', i]
          );
        }
      }

      const idMap = {};
      const insertQ = async (type, q) => {
        if (!q.question || q.answer == null) return;
        const r = await client.query(
          `INSERT INTO questions(ext_id,type,question,options,answer,points,time_sec,image,audio)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [
            String(q.id || ''),
            type,
            q.question,
            q.options ? JSON.stringify(q.options) : null,
            String(q.answer || ''),
            q.points || 10,
            q.time_sec || 30,
            q.image || null,
            q.audio || null,
          ]
        );
        idMap[`${type}:${q.id}`] = r.rows[0].id;
      };

      for (const r of get('MCQ')) {
        await insertQ('mcq', {
          id: r.id, question: r.question, points: r.points, time_sec: r.time_sec, image: r.image,
          answer: r.correct,
          options: { a: r.option_a, b: r.option_b, c: r.option_c, d: r.option_d },
        });
      }
      for (const r of get('RapidFire')) await insertQ('rapidfire', r);
      for (const r of get('PassQuestion')) {
        await insertQ('pass', { ...r, points: r.base_points || r.points });
      }
      for (const r of get('ImageRound')) await insertQ('image', r);
      for (const r of get('Speaker')) await insertQ('speaker', r);
      for (const r of get('Buzzer')) await insertQ('buzzer', r);

      for (const r of get('Rounds')) {
        const ids = String(r.question_ids || '')
          .split(',').map((s) => s.trim()).filter(Boolean)
          .map((qid) => idMap[`${r.type}:${qid}`]).filter(Boolean);
        const rules = (r.rules == null || String(r.rules).trim() === '') ? null : String(r.rules);
        await client.query(
          'INSERT INTO rounds(round_no,name,type,question_ids,rules) VALUES($1,$2,$3,$4,$5)',
          [r.round_no, r.round_name, r.type, ids, rules]
        );
      }

      const [t, q, rd] = await Promise.all([
        client.query('SELECT COUNT(*) FROM teams'),
        client.query('SELECT COUNT(*) FROM questions'),
        client.query('SELECT COUNT(*) FROM rounds'),
      ]);
      await client.query(
        `INSERT INTO config(key,value) VALUES('last_import_at',$1)
         ON CONFLICT(key) DO UPDATE SET value=$1`,
        [JSON.stringify(new Date().toISOString())]
      );
      return { teams: t.rows[0].count, questions: q.rows[0].count, rounds: rd.rows[0].count };
    });

    res.json({ ok: true, counts });
  } catch (e) {
    next(e);
  }
});

router.post('/upload-images', upload.array('images', 50), (req, res) => {
  res.json({ ok: true, files: (req.files || []).map((f) => f.filename) });
});

router.get('/images', (req, res, next) => {
  try {
    const files = fs.readdirSync(UPLOAD_DIR).filter((f) => IMAGE_EXT_RE.test(f));
    res.json({ files });
  } catch (e) { next(e); }
});

router.delete('/images/:name', (req, res) => {
  const safe = sanitize(req.params.name);
  if (!SAFE_NAME.test(safe)) return res.status(400).json({ error: 'invalid name' });
  const p = path.join(UPLOAD_DIR, safe);
  if (!p.startsWith(UPLOAD_DIR + path.sep)) return res.status(400).json({ error: 'invalid path' });
  if (fs.existsSync(p)) fs.unlinkSync(p);
  res.json({ ok: true });
});

router.post('/upload-audio', audioUpload.array('audio', 30), (req, res) => {
  res.json({ ok: true, files: (req.files || []).map((f) => f.filename) });
});

router.get('/audio', (req, res, next) => {
  try {
    const files = fs.readdirSync(UPLOAD_DIR).filter((f) => AUDIO_EXT_RE.test(f));
    res.json({ files });
  } catch (e) { next(e); }
});

router.delete('/audio/:name', (req, res) => {
  const safe = sanitize(req.params.name);
  if (!SAFE_AUDIO.test(safe)) return res.status(400).json({ error: 'invalid name' });
  const p = path.join(UPLOAD_DIR, safe);
  if (!p.startsWith(UPLOAD_DIR + path.sep)) return res.status(400).json({ error: 'invalid path' });
  if (fs.existsSync(p)) fs.unlinkSync(p);
  res.json({ ok: true });
});

router.post('/reset-scores', async (req, res, next) => {
  try {
    await withTransaction(async (c) => {
      await c.query('UPDATE teams SET score=0');
      await c.query('TRUNCATE scores RESTART IDENTITY');
      await c.query(
        `UPDATE session_state SET current_round_id=NULL,current_question_id=NULL,
         current_team_id=NULL,pass_level=0,revealed=FALSE,attempted=FALSE,
         selected_option=NULL,timer_started_at=NULL,timer_duration=NULL WHERE id=1`
      );
    });
    req.app.get('broadcastState')?.();
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.get('/status', async (req, res, next) => {
  try {
    const [t, q, rd, cfg, timerEnabled] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM teams'),
      pool.query('SELECT COUNT(*) FROM questions'),
      pool.query('SELECT COUNT(*) FROM rounds'),
      pool.query("SELECT value FROM config WHERE key='last_import_at'"),
      getTimerEnabled(),
    ]);
    let lastImportAt = null;
    if (cfg.rows[0]?.value) {
      try { lastImportAt = JSON.parse(cfg.rows[0].value); } catch { lastImportAt = cfg.rows[0].value; }
    }
    res.json({
      teams: +t.rows[0].count,
      questions: +q.rows[0].count,
      rounds: +rd.rows[0].count,
      lastImportAt,
      timerEnabled,
    });
  } catch (e) { next(e); }
});

router.post('/config/timer', async (req, res, next) => {
  try {
    const enabled = !!req.body?.enabled;
    await pool.query(
      `INSERT INTO config(key,value) VALUES('timer_enabled',$1)
       ON CONFLICT(key) DO UPDATE SET value=$1`,
      [JSON.stringify(enabled)]
    );
    if (enabled) {
      // Kick off the countdown for the current question if one is showing.
      const r = await pool.query(`
        SELECT ss.current_question_id, ss.display_mode, ss.pass_level, q.time_sec
          FROM session_state ss
          LEFT JOIN questions q ON q.id = ss.current_question_id
         WHERE ss.id = 1`);
      const row = r.rows[0];
      if (row && row.current_question_id && row.display_mode === 'question'
          && row.time_sec && row.time_sec > 0) {
        const dur = (row.pass_level || 0) >= 1
          ? Math.max(1, Math.ceil(row.time_sec / 2)) : row.time_sec;
        await pool.query(
          'UPDATE session_state SET timer_started_at=NOW(), timer_duration=$1 WHERE id=1',
          [dur]
        );
      }
    } else {
      // Stop any running countdown when disabling.
      await pool.query('UPDATE session_state SET timer_started_at=NULL, timer_duration=NULL WHERE id=1');
    }
    req.app.get('broadcastState')?.();
    res.json({ ok: true, enabled });
  } catch (e) { next(e); }
});

router.get('/template.xlsx', (req, res, next) => {
  const file = path.join(__dirname, '..', 'scripts', 'quiz_template.xlsx');
  try {
    // Always regenerate so updates to the template layout ship without a rebuild cycle.
    const { generateTemplate } = require('../scripts/generate-template');
    generateTemplate(file);
    res.download(file, 'quiz_template.xlsx');
  } catch (e) { next(e); }
});

module.exports = router;

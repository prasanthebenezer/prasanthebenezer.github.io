const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');
const { pool, withTransaction } = require('../db');
const { requireAuth } = require('./auth');

const router = express.Router();
router.use(requireAuth);

const UPLOAD_DIR = process.env.UPLOAD_DIR || '/app/uploads';
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const SAFE_NAME = /^[A-Za-z0-9._-]+\.(png|jpe?g|gif|webp)$/i;
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

const memUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
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
          `INSERT INTO questions(ext_id,type,question,options,answer,points,time_sec,image)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [
            String(q.id || ''),
            type,
            q.question,
            q.options ? JSON.stringify(q.options) : null,
            String(q.answer || ''),
            q.points || 10,
            q.time_sec || 30,
            q.image || null,
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

      for (const r of get('Rounds')) {
        const ids = String(r.question_ids || '')
          .split(',').map((s) => s.trim()).filter(Boolean)
          .map((qid) => idMap[`${r.type}:${qid}`]).filter(Boolean);
        await client.query(
          'INSERT INTO rounds(round_no,name,type,question_ids) VALUES($1,$2,$3,$4)',
          [r.round_no, r.round_name, r.type, ids]
        );
      }

      const [t, q, rd] = await Promise.all([
        client.query('SELECT COUNT(*) FROM teams'),
        client.query('SELECT COUNT(*) FROM questions'),
        client.query('SELECT COUNT(*) FROM rounds'),
      ]);
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
    const files = fs.readdirSync(UPLOAD_DIR).filter((f) => /\.(png|jpe?g|gif|webp)$/i.test(f));
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

router.get('/template.xlsx', (req, res, next) => {
  const file = path.join(__dirname, '..', 'scripts', 'quiz_template.xlsx');
  try {
    if (!fs.existsSync(file)) {
      // Generate on demand in a child process context rather than as a side-effect require
      const { generateTemplate } = require('../scripts/generate-template');
      generateTemplate(file);
    }
    res.download(file, 'quiz_template.xlsx');
  } catch (e) { next(e); }
});

module.exports = router;

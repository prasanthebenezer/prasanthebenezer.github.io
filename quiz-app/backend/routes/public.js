const express = require('express');
const { pool } = require('../db');
const { snapshot } = require('../state');
const router = express.Router();

router.get('/state', async (req, res, next) => {
  try { res.json(await snapshot({ redactAnswer: true })); } catch (e) { next(e); }
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

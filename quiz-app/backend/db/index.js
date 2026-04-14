const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.DB_POOL_MAX || '10', 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  // Idle client errors shouldn't crash the process
  console.error('[pg] idle client error', err.message);
});

async function init() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const maxAttempts = 30;
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      await pool.query(schema);
      console.log('[pg] schema ready');
      return;
    } catch (e) {
      if (i === maxAttempts) throw new Error(`DB init failed after ${maxAttempts} attempts: ${e.message}`);
      console.log(`[pg] not ready (attempt ${i}/${maxAttempts}): ${e.message}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { pool, init, withTransaction };

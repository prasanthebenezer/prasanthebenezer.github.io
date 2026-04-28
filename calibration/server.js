const express = require('express');
const Database = require('better-sqlite3');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const INITIAL_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const INITIAL_CERT_VIEW_PASSWORD = process.env.CERT_VIEW_PASSWORD || 'view123';

// Ensure directories exist
const DB_DIR = path.join(__dirname, 'database');
const CERT_DIR = path.join(__dirname, 'certificates');
fs.mkdirSync(DB_DIR, { recursive: true });
fs.mkdirSync(CERT_DIR, { recursive: true });

// Database setup
const db = new Database(path.join(DB_DIR, 'calibration.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS equipment (
    equipment_id        TEXT PRIMARY KEY,
    serial_number       TEXT NOT NULL,
    name                TEXT NOT NULL,
    calibration_range   TEXT,
    interval_months     INTEGER,
    date_of_calibration TEXT,
    calibration_due_date TEXT,
    certificate_number  TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// ─── Password storage (scrypt-hashed in settings table) ───
function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(plain, salt, 64);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

function verifyPassword(plain, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  const derived = crypto.scryptSync(plain, salt, expected.length);
  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
}

const getSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
const upsertSetting = db.prepare(`
  INSERT INTO settings (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`);

function getStoredHash(key) {
  const row = getSetting.get(key);
  return row ? row.value : null;
}

// Seed from env vars on first boot only — subsequent changes happen via the admin UI
if (!getStoredHash('admin_password')) {
  upsertSetting.run('admin_password', hashPassword(INITIAL_ADMIN_PASSWORD));
  console.log('Seeded admin password from ADMIN_PASSWORD env var');
}
if (!getStoredHash('cert_view_password')) {
  upsertSetting.run('cert_view_password', hashPassword(INITIAL_CERT_VIEW_PASSWORD));
  console.log('Seeded certificate viewing password from CERT_VIEW_PASSWORD env var');
}

// Seed data if empty
const count = db.prepare('SELECT COUNT(*) as c FROM equipment').get();
if (count.c === 0) {
  const insert = db.prepare(`
    INSERT INTO equipment (equipment_id, serial_number, name, calibration_range, interval_months, date_of_calibration, calibration_due_date, certificate_number)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insert.run('EQUIP001', 'SN-2024-0451', 'Pressure Transmitter PT-101', '0 - 250 bar', 12, '2025-06-15', '2026-06-15', 'CERT-2025-0451');
  insert.run('EQUIP002', 'SN-2024-0782', 'Temperature Sensor TT-203', '-50 to 500 °C', 6, '2025-09-01', '2026-03-01', 'CERT-2025-0782');
  insert.run('EQUIP003', 'SN-2024-1105', 'Flow Meter FT-305', '0 - 1000 L/min', 12, '2025-11-20', '2026-11-20', 'CERT-2025-1105');

  console.log('Seeded 3 sample equipment records');
}

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Multer for certificate uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, CERT_DIR),
  filename: (req, file, cb) => {
    const certNumber = req.body.certificate_number || 'unknown';
    const safeName = certNumber.replace(/[^a-zA-Z0-9_-]/g, '_');
    cb(null, `${safeName}.pdf`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  }
});

// Auth middleware
function requireAdmin(req, res, next) {
  const password = req.headers['x-admin-password'];
  if (!password || !verifyPassword(password, getStoredHash('admin_password'))) {
    return res.status(401).json({ error: 'Invalid admin password' });
  }
  next();
}

function requireCertPassword(req, res, next) {
  const password = req.headers['x-cert-password'];
  if (!password || !verifyPassword(password, getStoredHash('cert_view_password'))) {
    return res.status(401).json({ error: 'Invalid certificate viewing password' });
  }
  next();
}

// ─── API Routes ────────────────────────────────────────────

// List all equipment
app.get('/api/equipment', (req, res) => {
  const rows = db.prepare('SELECT * FROM equipment ORDER BY equipment_id').all();
  res.json(rows);
});

// Get single equipment
app.get('/api/equipment/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM equipment WHERE equipment_id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Equipment not found' });
  res.json(row);
});

// Add equipment
app.post('/api/equipment', requireAdmin, (req, res) => {
  const { equipment_id, serial_number, name, calibration_range, interval_months, date_of_calibration, calibration_due_date, certificate_number } = req.body;

  if (!equipment_id || !serial_number || !name) {
    return res.status(400).json({ error: 'equipment_id, serial_number, and name are required' });
  }

  const existing = db.prepare('SELECT equipment_id FROM equipment WHERE equipment_id = ?').get(equipment_id);
  if (existing) {
    return res.status(409).json({ error: 'Equipment ID already exists' });
  }

  db.prepare(`
    INSERT INTO equipment (equipment_id, serial_number, name, calibration_range, interval_months, date_of_calibration, calibration_due_date, certificate_number)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(equipment_id, serial_number, name, calibration_range || null, interval_months || null, date_of_calibration || null, calibration_due_date || null, certificate_number || null);

  const created = db.prepare('SELECT * FROM equipment WHERE equipment_id = ?').get(equipment_id);
  res.status(201).json(created);
});

// Update equipment
app.put('/api/equipment/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM equipment WHERE equipment_id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Equipment not found' });

  const { serial_number, name, calibration_range, interval_months, date_of_calibration, calibration_due_date, certificate_number } = req.body;

  db.prepare(`
    UPDATE equipment SET
      serial_number = ?, name = ?, calibration_range = ?, interval_months = ?,
      date_of_calibration = ?, calibration_due_date = ?, certificate_number = ?
    WHERE equipment_id = ?
  `).run(
    serial_number || existing.serial_number,
    name || existing.name,
    calibration_range !== undefined ? calibration_range : existing.calibration_range,
    interval_months !== undefined ? interval_months : existing.interval_months,
    date_of_calibration !== undefined ? date_of_calibration : existing.date_of_calibration,
    calibration_due_date !== undefined ? calibration_due_date : existing.calibration_due_date,
    certificate_number !== undefined ? certificate_number : existing.certificate_number,
    req.params.id
  );

  const updated = db.prepare('SELECT * FROM equipment WHERE equipment_id = ?').get(req.params.id);
  res.json(updated);
});

// Delete equipment
app.delete('/api/equipment/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM equipment WHERE equipment_id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Equipment not found' });

  // Delete associated certificate file if exists
  if (existing.certificate_number) {
    const safeName = existing.certificate_number.replace(/[^a-zA-Z0-9_-]/g, '_');
    const certPath = path.join(CERT_DIR, `${safeName}.pdf`);
    if (fs.existsSync(certPath)) {
      fs.unlinkSync(certPath);
    }
  }

  db.prepare('DELETE FROM equipment WHERE equipment_id = ?').run(req.params.id);
  res.json({ message: 'Equipment deleted' });
});

// Verify certificate viewing password
app.post('/api/verify-password', (req, res) => {
  const { password } = req.body;
  if (verifyPassword(password, getStoredHash('cert_view_password'))) {
    res.json({ valid: true });
  } else {
    res.status(401).json({ valid: false, error: 'Invalid password' });
  }
});

// Admin login
app.post('/api/admin-login', (req, res) => {
  const { password } = req.body;
  if (verifyPassword(password, getStoredHash('admin_password'))) {
    res.json({ valid: true });
  } else {
    res.status(401).json({ valid: false, error: 'Invalid admin password' });
  }
});

// Change admin and/or certificate viewing password
app.post('/api/change-passwords', requireAdmin, (req, res) => {
  const { current_password, new_admin_password, new_cert_view_password } = req.body || {};

  if (!verifyPassword(current_password, getStoredHash('admin_password'))) {
    return res.status(401).json({ error: 'Current admin password is incorrect' });
  }

  const updates = [];
  if (new_admin_password !== undefined && new_admin_password !== null && new_admin_password !== '') {
    if (typeof new_admin_password !== 'string' || new_admin_password.length < 6) {
      return res.status(400).json({ error: 'New admin password must be at least 6 characters' });
    }
    upsertSetting.run('admin_password', hashPassword(new_admin_password));
    updates.push('admin');
  }
  if (new_cert_view_password !== undefined && new_cert_view_password !== null && new_cert_view_password !== '') {
    if (typeof new_cert_view_password !== 'string' || new_cert_view_password.length < 6) {
      return res.status(400).json({ error: 'New certificate viewing password must be at least 6 characters' });
    }
    upsertSetting.run('cert_view_password', hashPassword(new_cert_view_password));
    updates.push('cert_view');
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'Provide a new admin password, certificate viewing password, or both' });
  }

  res.json({ message: 'Password updated', updated: updates });
});

// Serve certificate PDF (password protected)
app.get('/api/certificate/:certNumber', requireCertPassword, (req, res) => {
  const safeName = req.params.certNumber.replace(/[^a-zA-Z0-9_-]/g, '_');
  const certPath = path.join(CERT_DIR, `${safeName}.pdf`);

  if (!fs.existsSync(certPath)) {
    return res.status(404).json({ error: 'Certificate file not found' });
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${req.params.certNumber}.pdf"`);
  fs.createReadStream(certPath).pipe(res);
});

// Upload certificate PDF
app.post('/api/upload-certificate', requireAdmin, upload.single('certificate'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  res.json({ message: 'Certificate uploaded', filename: req.file.filename });
});

// SPA fallback for frontend routes
app.get('/equipment.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'equipment.html'));
});

app.get('/admin.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  if (err.message === 'Only PDF files are allowed') {
    return res.status(400).json({ error: err.message });
  }
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Calibration server running on port ${PORT}`);
});

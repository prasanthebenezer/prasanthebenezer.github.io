const express = require('express');
const Database = require('better-sqlite3');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const XLSX = require('xlsx');

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

// ─── Bulk equipment upload (Excel) ─────────────────────────
const SPREADSHEET_COLUMNS = [
  'Equipment ID',
  'Equipment Name',
  'Serial Number',
  'Calibration Range',
  'Interval (months)',
  'Date of Calibration',
  'Calibration Due Date',
];

const bulkUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const ok =
      file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.mimetype === 'application/vnd.ms-excel' ||
      file.mimetype === 'text/csv' ||
      /\.(xlsx|xls|csv)$/i.test(file.originalname);
    if (ok) cb(null, true);
    else cb(new Error('Only .xlsx, .xls, or .csv files are allowed'));
  },
});

// Normalise header names so users can be a bit forgiving with their spreadsheets
function normaliseHeader(s) {
  return String(s || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

const HEADER_ALIASES = {
  equipmentid: 'equipment_id',
  equipid: 'equipment_id',
  id: 'equipment_id',
  equipmentname: 'name',
  name: 'name',
  serialnumber: 'serial_number',
  serial: 'serial_number',
  sn: 'serial_number',
  calibrationrange: 'calibration_range',
  range: 'calibration_range',
  intervalmonths: 'interval_months',
  interval: 'interval_months',
  dateofcalibration: 'date_of_calibration',
  calibrationdate: 'date_of_calibration',
  caldate: 'date_of_calibration',
  calibrationduedate: 'calibration_due_date',
  duedate: 'calibration_due_date',
};

function toIsoDate(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date && !isNaN(v)) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof v === 'number' && isFinite(v)) {
    // Excel serial date
    const parsed = XLSX.SSF.parse_date_code(v);
    if (parsed) {
      const y = String(parsed.y).padStart(4, '0');
      const m = String(parsed.m).padStart(2, '0');
      const d = String(parsed.d).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
  }
  const s = String(v).trim();
  if (!s) return null;
  // Already YYYY-MM-DD?
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  // DD/MM/YYYY or DD-MM-YYYY (UK/EU style — most common in this app)
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    let [_, d, mo, y] = m;
    if (y.length === 2) y = (parseInt(y, 10) >= 70 ? '19' : '20') + y;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  // Last resort: Date.parse
  const dt = new Date(s);
  if (!isNaN(dt)) {
    const y = dt.getFullYear();
    const mo = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    return `${y}-${mo}-${d}`;
  }
  return null;
}

// Download a blank template spreadsheet so users know the expected columns
app.get('/api/bulk-template.xlsx', (req, res) => {
  const sample = [
    {
      'Equipment ID': 'EQUIP100',
      'Equipment Name': 'Pressure Transmitter PT-100',
      'Serial Number': 'SN-2026-0001',
      'Calibration Range': '0 - 250 bar',
      'Interval (months)': 12,
      'Date of Calibration': '2026-01-15',
      'Calibration Due Date': '2027-01-15',
    },
  ];
  const ws = XLSX.utils.json_to_sheet(sample, { header: SPREADSHEET_COLUMNS });
  ws['!cols'] = SPREADSHEET_COLUMNS.map(h => ({ wch: Math.max(18, h.length + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Equipment');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="equipment-bulk-upload-template.xlsx"');
  res.send(buf);
});

// Parse + analyse an uploaded spreadsheet and produce per-row decisions.
// Returns { ok: true, analysis, summary } or { ok: false, status, error }.
function analyseBulkUploadFile(buffer) {
  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  } catch (err) {
    return { ok: false, status: 400, error: 'Could not read spreadsheet — make sure it is a valid .xlsx, .xls, or .csv file' };
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { ok: false, status: 400, error: 'Spreadsheet contains no sheets' };
  const sheet = workbook.Sheets[sheetName];

  // Read header row explicitly so we don't miss columns whose first data cell is blank
  const headerMatrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
  if (headerMatrix.length < 2) {
    return { ok: false, status: 400, error: 'Spreadsheet contains no data rows' };
  }
  const headerRow = (headerMatrix[0] || []).map(h => (h == null ? '' : String(h)));
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true });

  const keyMap = {};
  for (const h of headerRow) {
    if (!h) continue;
    const norm = normaliseHeader(h);
    if (HEADER_ALIASES[norm]) keyMap[h] = HEADER_ALIASES[norm];
  }
  const haveCanonical = new Set(Object.values(keyMap));
  const missingRequired = ['equipment_id', 'name', 'serial_number'].filter(c => !haveCanonical.has(c));
  if (missingRequired.length > 0) {
    return {
      ok: false,
      status: 400,
      error: `Spreadsheet is missing required column(s): ${missingRequired.map(c => ({
        equipment_id: 'Equipment ID',
        name: 'Equipment Name',
        serial_number: 'Serial Number',
      })[c]).join(', ')}`,
    };
  }

  // Pre-load existing records for fast lookup
  const existingRows = db.prepare('SELECT equipment_id, serial_number FROM equipment').all();
  const existingByEquipId = new Map(existingRows.map(r => [r.equipment_id, r]));
  const existingBySerial = new Map();
  for (const r of existingRows) {
    if (!existingBySerial.has(r.serial_number)) existingBySerial.set(r.serial_number, []);
    existingBySerial.get(r.serial_number).push(r.equipment_id);
  }

  const seenIdsInBatch = new Map();      // equipment_id -> first row number seen
  const seenSerialsInBatch = new Map();  // serial_number -> first row number seen

  const analysis = rows.map((row, idx) => {
    const rowNum = idx + 2; // header is row 1; data rows start at 2
    const canonical = {};
    for (const [origKey, canonKey] of Object.entries(keyMap)) {
      canonical[canonKey] = row[origKey];
    }

    const equipment_id = (canonical.equipment_id ?? '').toString().trim();
    const name = (canonical.name ?? '').toString().trim();
    const serial_number = (canonical.serial_number ?? '').toString().trim();

    if (!equipment_id || !name || !serial_number) {
      return {
        row: rowNum,
        equipment_id: equipment_id || null,
        name: name || null,
        serial_number: serial_number || null,
        status: 'error',
        flags: [],
        message: 'Equipment ID, Equipment Name, and Serial Number are required',
      };
    }

    const calibration_range = canonical.calibration_range != null
      ? String(canonical.calibration_range).trim() || null
      : null;

    let interval_months = null;
    if (canonical.interval_months != null && canonical.interval_months !== '') {
      const n = parseInt(canonical.interval_months, 10);
      interval_months = Number.isFinite(n) && n > 0 ? n : null;
    }

    const date_of_calibration = toIsoDate(canonical.date_of_calibration);
    const calibration_due_date = toIsoDate(canonical.calibration_due_date);

    // Within-batch Equipment ID duplicate is a hard error — there is no sensible
    // automatic way to choose which row "wins", so the user must fix the sheet.
    if (seenIdsInBatch.has(equipment_id)) {
      return {
        row: rowNum, equipment_id, name, serial_number,
        calibration_range, interval_months, date_of_calibration, calibration_due_date,
        status: 'error', flags: [],
        message: `Equipment ID "${equipment_id}" is repeated in this spreadsheet (first seen on row ${seenIdsInBatch.get(equipment_id)})`,
      };
    }
    seenIdsInBatch.set(equipment_id, rowNum);

    const flags = [];
    const messages = [];

    const existingForId = existingByEquipId.get(equipment_id);
    if (existingForId) {
      flags.push('id_conflict');
      messages.push(`Equipment ID exists in database (current serial: ${existingForId.serial_number})`);
    }

    // Serial duplicate: another existing record (with a different equipment_id) or
    // an earlier row in this batch already uses this serial.
    const dbSerialOwners = (existingBySerial.get(serial_number) || []).filter(eid => eid !== equipment_id);
    const batchSerialOwner = seenSerialsInBatch.get(serial_number);
    if (dbSerialOwners.length > 0 || batchSerialOwner) {
      flags.push('serial_conflict');
      const owners = dbSerialOwners.slice();
      if (batchSerialOwner) owners.push(`row ${batchSerialOwner} of this spreadsheet`);
      messages.push(`Serial number is also used by: ${owners.join(', ')}`);
    }
    if (!seenSerialsInBatch.has(serial_number)) seenSerialsInBatch.set(serial_number, rowNum);

    return {
      row: rowNum,
      equipment_id, name, serial_number,
      calibration_range, interval_months, date_of_calibration, calibration_due_date,
      status: flags.length === 0 ? 'ready' : 'conflict',
      flags,
      message: messages.join('; '),
    };
  });

  const summary = {
    total: rows.length,
    ready: analysis.filter(a => a.status === 'ready').length,
    id_conflicts: analysis.filter(a => a.flags.includes('id_conflict')).length,
    serial_conflicts: analysis.filter(a => a.flags.includes('serial_conflict')).length,
    errors: analysis.filter(a => a.status === 'error').length,
  };

  return { ok: true, analysis, summary };
}

app.post('/api/bulk-upload-equipment', requireAdmin, bulkUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const result = analyseBulkUploadFile(req.file.buffer);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  const { analysis, summary } = result;

  const mode = (req.body.mode || 'preview').toString();
  if (mode === 'preview') {
    return res.json({
      phase: 'preview',
      summary,
      rows: analysis.map(a => ({
        row: a.row,
        equipment_id: a.equipment_id,
        name: a.name,
        serial_number: a.serial_number,
        status: a.status,
        flags: a.flags,
        message: a.message,
      })),
    });
  }

  if (mode !== 'commit') {
    return res.status(400).json({ error: `Unknown mode "${mode}"` });
  }

  const overwriteIds = req.body.overwrite_ids === 'true';
  const acceptSerialWarnings = req.body.accept_serial_warnings === 'true';

  // Block commit when conflicts exist but the corresponding decision was not made,
  // unless every conflict row would be skipped silently — in that case we still
  // run, but the user will see them in the result as "skipped".
  // (We do not hard-block; the per-row result clearly explains what happened.)

  const insertEquipment = db.prepare(`
    INSERT INTO equipment (equipment_id, serial_number, name, calibration_range, interval_months, date_of_calibration, calibration_due_date, certificate_number)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
  `);
  const updateEquipment = db.prepare(`
    UPDATE equipment SET
      serial_number = ?, name = ?, calibration_range = ?, interval_months = ?,
      date_of_calibration = ?, calibration_due_date = ?
    WHERE equipment_id = ?
  `);

  const results = [];
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let errorsCount = 0;

  const runImport = db.transaction(() => {
    for (const a of analysis) {
      if (a.status === 'error') {
        errorsCount++;
        results.push({ row: a.row, equipment_id: a.equipment_id, status: 'error', message: a.message });
        continue;
      }

      const idConflict = a.flags.includes('id_conflict');
      const serialConflict = a.flags.includes('serial_conflict');

      if (idConflict && !overwriteIds) {
        skipped++;
        results.push({
          row: a.row, equipment_id: a.equipment_id, status: 'skipped',
          message: 'Equipment ID already exists; overwrite was not authorised',
        });
        continue;
      }
      if (serialConflict && !acceptSerialWarnings) {
        skipped++;
        results.push({
          row: a.row, equipment_id: a.equipment_id, status: 'skipped',
          message: 'Duplicate serial number; serial-warning override was not authorised',
        });
        continue;
      }

      const noteParts = [];
      if (idConflict) noteParts.push('overwrote existing record');
      if (serialConflict) noteParts.push('duplicate serial accepted');

      try {
        if (idConflict) {
          updateEquipment.run(
            a.serial_number, a.name, a.calibration_range, a.interval_months,
            a.date_of_calibration, a.calibration_due_date, a.equipment_id,
          );
          updated++;
          results.push({ row: a.row, equipment_id: a.equipment_id, status: 'updated', message: noteParts.join('; ') });
        } else {
          insertEquipment.run(
            a.equipment_id, a.serial_number, a.name, a.calibration_range,
            a.interval_months, a.date_of_calibration, a.calibration_due_date,
          );
          inserted++;
          results.push({ row: a.row, equipment_id: a.equipment_id, status: 'inserted', message: noteParts.join('; ') });
        }
      } catch (err) {
        errorsCount++;
        results.push({ row: a.row, equipment_id: a.equipment_id, status: 'error', message: err.message });
      }
    }
  });

  runImport();

  res.json({
    phase: 'commit',
    total: analysis.length,
    inserted,
    updated,
    skipped,
    errors: errorsCount,
    results,
  });
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
  if (
    err.message === 'Only PDF files are allowed' ||
    err.message === 'Only .xlsx, .xls, or .csv files are allowed'
  ) {
    return res.status(400).json({ error: err.message });
  }
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Calibration server running on port ${PORT}`);
});

const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const router = express.Router();

const IS_PROD = process.env.NODE_ENV === 'production';
const SECRET = process.env.SESSION_SECRET;
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const COOKIE_NAME = 'quiz_auth';
const TOKEN_TTL = '12h';
const COOKIE_MAX_AGE = 12 * 3600 * 1000;

if (IS_PROD) {
  if (!SECRET || SECRET.length < 32) {
    throw new Error('SESSION_SECRET must be set to a value of at least 32 chars in production');
  }
  if (!ADMIN_PASSWORD_HASH && !ADMIN_PASSWORD) {
    throw new Error('ADMIN_PASSWORD_HASH (preferred) or ADMIN_PASSWORD must be set in production');
  }
}

const effectiveSecret = SECRET || 'dev-only-secret-do-not-use-in-prod';

async function verifyPassword(candidate) {
  if (typeof candidate !== 'string' || !candidate) return false;
  if (ADMIN_PASSWORD_HASH) {
    try { return await bcrypt.compare(candidate, ADMIN_PASSWORD_HASH); } catch { return false; }
  }
  if (ADMIN_PASSWORD) {
    // constant-time-ish compare
    const a = Buffer.from(candidate);
    const b = Buffer.from(ADMIN_PASSWORD);
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
  }
  return false;
}

const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: IS_PROD,
  maxAge: COOKIE_MAX_AGE,
  path: '/',
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, try again later' },
});

router.post('/login', loginLimiter, async (req, res) => {
  const { password } = req.body || {};
  const ok = await verifyPassword(password);
  if (!ok) return res.status(401).json({ error: 'Invalid password' });
  const token = jwt.sign({ role: 'admin' }, effectiveSecret, { expiresIn: TOKEN_TTL });
  res.cookie(COOKIE_NAME, token, cookieOptions());
  res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  try {
    const token = req.cookies?.[COOKIE_NAME];
    if (!token) return res.json({ authed: false });
    jwt.verify(token, effectiveSecret);
    res.json({ authed: true });
  } catch { res.json({ authed: false }); }
});

function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.[COOKIE_NAME];
    if (!token) return res.status(401).json({ error: 'auth required' });
    jwt.verify(token, effectiveSecret);
    next();
  } catch { res.status(401).json({ error: 'auth required' }); }
}

function verifyTokenString(token) {
  try { jwt.verify(token, effectiveSecret); return true; } catch { return false; }
}

module.exports = router;
module.exports.requireAuth = requireAuth;
module.exports.verifyTokenString = verifyTokenString;
module.exports.COOKIE_NAME = COOKIE_NAME;

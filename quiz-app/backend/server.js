const express = require('express');
const http = require('http');
const path = require('path');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const pinoHttp = require('pino-http');
const pino = require('pino');
const { Server } = require('socket.io');

const { init, pool } = require('./db');
const { makeBroadcaster, snapshot } = require('./state');
const authRouter = require('./routes/auth');
const { verifyTokenString, COOKIE_NAME } = require('./routes/auth');

const BASE = (process.env.BASE_PATH || '').replace(/\/$/, '');
const PORT = parseInt(process.env.PORT || '3100', 10);
const IS_PROD = process.env.NODE_ENV === 'production';

const logger = pino({
  level: process.env.LOG_LEVEL || (IS_PROD ? 'info' : 'debug'),
});

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // behind nginx

app.use(pinoHttp({ logger, customLogLevel: (req, res, err) => {
  if (err || res.statusCode >= 500) return 'error';
  if (res.statusCode >= 400) return 'warn';
  return 'debug';
}}));
app.use(helmet({
  contentSecurityPolicy: false, // inline scripts in the current frontend
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'same-site' },
}));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

const server = http.createServer(app);
const io = new Server(server, {
  path: `${BASE}/socket.io`,
  serveClient: true,
  cors: IS_PROD ? false : { origin: true, credentials: true },
});

// Socket.IO namespaces: /host (authed) and /public (read-only)
const parseCookie = (raw, name) => {
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
};

io.of('/host').use((socket, next) => {
  const token = parseCookie(socket.handshake.headers.cookie, COOKIE_NAME);
  if (token && verifyTokenString(token)) return next();
  next(new Error('auth required'));
});
io.of('/host').on('connection', (socket) => {
  logger.debug({ id: socket.id }, 'host socket connected');
});
io.of('/public').on('connection', (socket) => {
  logger.debug({ id: socket.id }, 'public socket connected');
});

const broadcastState = makeBroadcaster(io, logger);
app.set('broadcastState', broadcastState);
app.set('io', io);

// ---- health ----
app.get(`${BASE}/healthz`, async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch (e) {
    res.status(503).json({ ok: false, error: e.message });
  }
});

// ---- static + uploads ----
app.use(`${BASE}`, express.static(path.join(__dirname, 'frontend'), {
  maxAge: IS_PROD ? '1h' : 0,
  index: false,
}));
app.use(`${BASE}/uploads`, express.static(process.env.UPLOAD_DIR || '/app/uploads', {
  maxAge: '1d',
  fallthrough: true,
}));

// ---- API ----
app.use(`${BASE}/api/auth`, authRouter);
app.use(`${BASE}/api/admin`, require('./routes/admin'));
app.use(`${BASE}/api/host`, require('./routes/host'));
app.use(`${BASE}/api/public`, require('./routes/public'));

// ---- HTML routes ----
const sendPage = (file) => (req, res) => res.sendFile(path.join(__dirname, 'frontend', file));
app.get(`${BASE}`, sendPage('index.html'));
app.get(`${BASE}/`, sendPage('index.html'));
app.get(`${BASE}/admin`, sendPage('admin.html'));
app.get(`${BASE}/host`, sendPage('host.html'));
app.get(`${BASE}/display`, sendPage('display.html'));
app.get(`${BASE}/scores`, sendPage('scores.html'));

// ---- 404 + error handler ----
app.use(`${BASE}/api`, (req, res) => res.status(404).json({ error: 'not found' }));
app.use((err, req, res, next) => {
  req.log?.error({ err: err.message, stack: err.stack }, 'request failed');
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: IS_PROD ? 'internal error' : err.message });
});

// ---- startup / shutdown ----
async function main() {
  await init();
  await new Promise((r) => server.listen(PORT, r));
  logger.info({ port: PORT, base: BASE }, 'quiz app listening');
}

function shutdown(signal) {
  logger.info({ signal }, 'shutting down');
  const forceExit = setTimeout(() => {
    logger.warn('force exit');
    process.exit(1);
  }, 10_000).unref();
  io.close(() => {
    server.close(() => {
      pool.end().finally(() => {
        clearTimeout(forceExit);
        process.exit(0);
      });
    });
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandledRejection'));
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaughtException');
  shutdown('uncaughtException');
});

main().catch((e) => {
  logger.fatal({ err: e.message }, 'startup failed');
  process.exit(1);
});

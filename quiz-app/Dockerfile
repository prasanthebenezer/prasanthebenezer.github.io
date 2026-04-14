# syntax=docker/dockerfile:1.6

# ---- deps stage: install prod deps only ----
FROM node:20-alpine AS deps
WORKDIR /app
COPY backend/package*.json ./
# Prefer npm ci if a lockfile is present; fall back to npm install otherwise.
RUN if [ -f package-lock.json ]; then \
      npm ci --omit=dev --no-audit --no-fund; \
    else \
      npm install --omit=dev --no-audit --no-fund; \
    fi

# ---- runtime stage ----
FROM node:20-alpine AS runtime
WORKDIR /app

# tini for proper PID 1 signal handling, wget for HEALTHCHECK
RUN apk add --no-cache tini wget \
 && addgroup -S app && adduser -S app -G app \
 && mkdir -p /app/uploads \
 && chown -R app:app /app

ENV NODE_ENV=production \
    PORT=3100 \
    NPM_CONFIG_LOGLEVEL=warn

COPY --from=deps --chown=app:app /app/node_modules ./node_modules
COPY --chown=app:app backend/ ./
COPY --chown=app:app frontend/ ./frontend/

USER app
EXPOSE 3100

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}${BASE_PATH:-}/healthz" || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]

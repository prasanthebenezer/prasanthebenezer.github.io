# CalTrack — Calibration Equipment Management System

A web-based calibration equipment management system with QR-coded tags. Scanning a QR code on equipment shows its calibration details publicly; viewing certificates requires a password. An admin panel allows full CRUD operations.

**Live demo**: `https://calibration.prasanthebenezer.com`

---

## Table of Contents

- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Directory Structure](#directory-structure)
- [Database Schema](#database-schema)
- [API Endpoints](#api-endpoints)
- [Authentication](#authentication)
- [Frontend Pages](#frontend-pages)
- [Docker Setup](#docker-setup)
- [Nginx Reverse Proxy](#nginx-reverse-proxy)
- [Deployment on a New Server](#deployment-on-a-new-server)
- [Configuration](#configuration)
- [Default Credentials](#default-credentials)

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                     Internet                        │
└──────────────┬──────────────────────┬───────────────┘
               │                      │
       calibration.domain.com    domain.com
               │                      │
┌──────────────▼──────────────────────▼───────────────┐
│                 Nginx (port 80/443)                 │
│         SSL termination + reverse proxy             │
│                                                     │
│  calibration.* ──► proxy_pass http://calibration:3000│
│  domain.com    ──► serves static portfolio files    │
└──────────────┬──────────────────────────────────────┘
               │ Docker network (web)
┌──────────────▼──────────────────────┐
│      Node.js / Express (port 3000) │
│                                     │
│  ┌───────────┐  ┌────────────────┐ │
│  │  SQLite   │  │ Certificate    │ │
│  │  Database │  │ PDFs           │ │
│  │ (volume)  │  │ (volume)       │ │
│  └───────────┘  └────────────────┘ │
└─────────────────────────────────────┘
```

- **Nginx** handles SSL, HTTP→HTTPS redirects, and proxies `calibration.*` requests to the Node.js container.
- **Node.js (Express)** serves both the API and the static frontend files.
- **SQLite** stores equipment records. The database file is persisted via a Docker volume.
- **Certificate PDFs** are stored on disk and served only through a password-protected API endpoint. Also persisted via a Docker volume.

---

## Tech Stack

| Layer    | Technology                        |
|----------|-----------------------------------|
| Backend  | Node.js 20, Express               |
| Database | SQLite via `better-sqlite3`        |
| Uploads  | `multer` (PDF file handling)       |
| Frontend | Vanilla HTML, CSS, JavaScript      |
| Fonts    | Google Fonts (Inter)               |
| Icons    | Font Awesome 6.4                   |
| QR Codes | qrcodejs (CDN)                     |
| Container| Docker (node:20-alpine)            |
| Proxy    | Nginx (nginx:alpine)               |
| SSL      | Let's Encrypt (certbot)            |

No build step, bundler, or framework required.

---

## Directory Structure

```
calibration/
├── Dockerfile                  Node.js app container
├── .dockerignore               Keeps node_modules etc. out of image
├── package.json                Dependencies: express, better-sqlite3, multer
├── server.js                   Express API + static file server
├── database/                   SQLite DB file (auto-created on first run)
│   └── calibration.db
├── certificates/               Uploaded/sample certificate PDFs
│   ├── CERT-2025-0451.pdf
│   ├── CERT-2025-0782.pdf
│   └── CERT-2025-1105.pdf
└── public/                     Frontend (served by Express)
    ├── index.html              Landing page — equipment grid + search
    ├── equipment.html          Detail page — single equipment view
    ├── admin.html              Admin panel — CRUD + QR generation
    ├── css/
    │   └── styles.css          All styles (light + dark theme)
    └── js/
        ├── config.js           Frontend config (base URL, company name)
        ├── app.js              Public page logic
        └── admin.js            Admin panel logic
```

---

## Database Schema

Single table — `equipment`:

| Column               | Type    | Constraint  | Description                        |
|----------------------|---------|-------------|------------------------------------|
| equipment_id         | TEXT    | PRIMARY KEY | Unique ID (e.g. EQUIP001)          |
| serial_number        | TEXT    | NOT NULL    | Manufacturer serial number          |
| name                 | TEXT    | NOT NULL    | Equipment name/description          |
| calibration_range    | TEXT    |             | Measurement range (e.g. 0-250 bar) |
| interval_months      | INTEGER |             | Calibration interval in months      |
| date_of_calibration  | TEXT    |             | Last calibration date (YYYY-MM-DD)  |
| calibration_due_date | TEXT    |             | Next due date (YYYY-MM-DD)          |
| certificate_number   | TEXT    |             | Links to certificate PDF file       |

On first startup with an empty database, 3 sample records are seeded automatically.

---

## API Endpoints

| Method | Path                           | Auth            | Description                     |
|--------|--------------------------------|-----------------|---------------------------------|
| GET    | `/api/equipment`               | None            | List all equipment              |
| GET    | `/api/equipment/:id`           | None            | Get single equipment by ID      |
| POST   | `/api/equipment`               | Admin password  | Add new equipment               |
| PUT    | `/api/equipment/:id`           | Admin password  | Update equipment                |
| DELETE | `/api/equipment/:id`           | Admin password  | Delete equipment + its cert PDF |
| POST   | `/api/verify-password`         | None            | Validate cert viewing password  |
| POST   | `/api/admin-login`             | None            | Validate admin password         |
| GET    | `/api/certificate/:certNumber` | Cert password   | Download certificate PDF        |
| POST   | `/api/upload-certificate`      | Admin password  | Upload certificate PDF          |

### Request/response examples

**List equipment:**
```bash
curl https://calibration.example.com/api/equipment
```

**Add equipment (admin):**
```bash
curl -X POST https://calibration.example.com/api/equipment \
  -H "Content-Type: application/json" \
  -H "x-admin-password: YOUR_ADMIN_PASSWORD" \
  -d '{
    "equipment_id": "EQUIP004",
    "serial_number": "SN-2025-0001",
    "name": "Pressure Gauge PG-401",
    "calibration_range": "0 - 100 bar",
    "interval_months": 12,
    "date_of_calibration": "2025-03-15",
    "calibration_due_date": "2026-03-15",
    "certificate_number": "CERT-2025-0004"
  }'
```

**Download certificate:**
```bash
curl -H "x-cert-password: YOUR_CERT_PASSWORD" \
  https://calibration.example.com/api/certificate/CERT-2025-0451 \
  -o certificate.pdf
```

---

## Authentication

Two separate passwords, set via environment variables:

| Variable            | Header            | Purpose                                  |
|---------------------|-------------------|------------------------------------------|
| `ADMIN_PASSWORD`    | `x-admin-password`| Required for add/edit/delete/upload       |
| `CERT_VIEW_PASSWORD`| `x-cert-password` | Required to download certificate PDFs     |

- Passwords are compared server-side in plain text (suitable for a demo; for production, consider hashing or using a proper auth system).
- Admin sessions are cached in `sessionStorage` (cleared on browser tab close).
- Certificate viewing auth is cached in `sessionStorage` to avoid re-entering for each download.

---

## Frontend Pages

### Landing Page (`index.html`)
- Equipment grid with cards showing ID, name, status badge, and due date
- Real-time search filtering by equipment ID, serial number, or name
- Status badges: **Valid** (green), **Due Soon** (orange, ≤30 days), **Expired** (red)
- Dark/light theme toggle (persisted via `localStorage`)

### Equipment Detail Page (`equipment.html?id=EQUIP001`)
- Full calibration details in a card layout
- Color-coded status badge
- "View Certificate" button opens a password modal
- On successful password entry, certificate PDF opens in a new tab

### Admin Panel (`admin.html`)
- Login gate with password prompt
- Sortable table of all equipment with Edit, QR, and Delete buttons per row
- Add/Edit modal with all calibration fields + certificate PDF upload
- QR code generation per equipment with:
  - QR code preview
  - Download as PNG
  - Print label (opens print-friendly window with QR + equipment ID)
- Delete with confirmation dialog

---

## Docker Setup

### Dockerfile

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY . .
RUN mkdir -p database certificates
EXPOSE 3000
CMD ["node", "server.js"]
```

### docker-compose.yml (calibration service)

```yaml
calibration:
  build: ./calibration
  container_name: calibration-app
  restart: unless-stopped
  environment:
    - ADMIN_PASSWORD=your_admin_password
    - CERT_VIEW_PASSWORD=your_cert_password
    - PORT=3000
  volumes:
    - calibration-data:/app/database
    - calibration-certs:/app/certificates
  networks:
    - web

volumes:
  calibration-data:
  calibration-certs:
```

**Docker volumes** ensure the database and uploaded certificates persist across container rebuilds and restarts.

---

## Nginx Reverse Proxy

Two server blocks are needed in the nginx config (alongside any existing site config):

```nginx
# HTTP → HTTPS redirect
server {
    listen 80;
    server_name calibration.yourdomain.com;

    location /.well-known/acme-challenge/ {
        root /usr/share/nginx/html;
    }

    location / {
        return 301 https://calibration.yourdomain.com$request_uri;
    }
}

# HTTPS reverse proxy
server {
    listen 443 ssl http2;
    server_name calibration.yourdomain.com;

    ssl_certificate /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    location / {
        proxy_pass http://calibration:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 10M;
    }
}
```

`proxy_pass http://calibration:3000` works because both the nginx and calibration containers share the same Docker network (`web`), and Docker DNS resolves the service name `calibration` to the container IP.

---

## Deployment on a New Server

### Prerequisites

- A Linux server (Ubuntu/Debian/RHEL/AlmaLinux) with:
  - Docker and Docker Compose installed
  - Ports 80 and 443 open
  - A domain or subdomain pointing to the server IP

### Step-by-step

**1. Copy the `calibration/` directory to the new server:**

```bash
scp -r calibration/ user@newserver:/opt/calibration
```

**2. Create a `docker-compose.yml` on the new server:**

```yaml
version: '3.8'

services:
  calibration:
    build: ./calibration
    container_name: calibration-app
    restart: unless-stopped
    environment:
      - ADMIN_PASSWORD=change_this_admin_password
      - CERT_VIEW_PASSWORD=change_this_cert_password
      - PORT=3000
    volumes:
      - calibration-data:/app/database
      - calibration-certs:/app/certificates
    ports:
      - "3000:3000"   # Direct access, or use nginx proxy
    networks:
      - web

networks:
  web:
    driver: bridge

volumes:
  calibration-data:
  calibration-certs:
```

**3. Update `calibration/public/js/config.js`:**

```js
const CONFIG = {
  API_BASE: '/api',
  BASE_URL: 'https://calibration.newdomain.com',  // Update this
  COMPANY_NAME: 'Your Company Name',               // Update this
  COMPANY_TAGLINE: 'Calibration Equipment Management',
};
```

**4. Build and start:**

```bash
cd /opt/calibration
docker compose up -d --build
```

**5. Set up DNS:**

Add an A record for your subdomain pointing to the new server's IP address.

| Type | Name        | Value          | TTL  |
|------|-------------|----------------|------|
| A    | calibration | YOUR_SERVER_IP | 3600 |

**6. Get SSL certificate:**

```bash
# Stop any service using port 80 first
certbot certonly --standalone \
  -d calibration.newdomain.com \
  --email your@email.com \
  --agree-tos --non-interactive
```

**7. Set up nginx:**

Install nginx on the host (or run it in a container), add the reverse proxy config from the [Nginx Reverse Proxy](#nginx-reverse-proxy) section above, updating:
- `server_name` to your domain
- `ssl_certificate` / `ssl_certificate_key` paths to your Let's Encrypt cert
- `proxy_pass` to `http://localhost:3000` (if nginx runs on host) or `http://calibration:3000` (if on the same Docker network)

**8. Verify:**

```bash
# Check container is running
docker ps

# Test API
curl https://calibration.newdomain.com/api/equipment

# Test in browser
# Visit https://calibration.newdomain.com
```

### Migrating existing data

To move data from one server to another:

```bash
# On the old server — export the Docker volumes
docker run --rm -v prasanthebenezergithubio_calibration-data:/data -v $(pwd):/backup alpine \
  tar czf /backup/cal-db-backup.tar.gz -C /data .

docker run --rm -v prasanthebenezergithubio_calibration-certs:/data -v $(pwd):/backup alpine \
  tar czf /backup/cal-certs-backup.tar.gz -C /data .

# Copy to new server
scp cal-db-backup.tar.gz cal-certs-backup.tar.gz user@newserver:/opt/calibration/

# On the new server — import into volumes (after first docker compose up)
docker run --rm -v calibration_calibration-data:/data -v $(pwd):/backup alpine \
  tar xzf /backup/cal-db-backup.tar.gz -C /data

docker run --rm -v calibration_calibration-certs:/data -v $(pwd):/backup alpine \
  tar xzf /backup/cal-certs-backup.tar.gz -C /data

# Restart to pick up restored data
docker compose restart calibration
```

---

## Configuration

All frontend configuration is in a single file — `public/js/config.js`:

```js
const CONFIG = {
  API_BASE: '/api',              // Relative — works on any domain, no change needed
  BASE_URL: 'https://...',       // Used for QR code URLs — update when changing domain
  COMPANY_NAME: 'CalTrack Demo', // Shown in nav, print labels
  COMPANY_TAGLINE: '...',        // Shown on landing page hero
};
```

Backend configuration is via environment variables in `docker-compose.yml`:

| Variable             | Default    | Description                    |
|----------------------|------------|--------------------------------|
| `ADMIN_PASSWORD`     | `admin123` | Password for admin operations  |
| `CERT_VIEW_PASSWORD` | `view123`  | Password to view certificates  |
| `PORT`               | `3000`     | Express server port            |

---

## Default Credentials

| Purpose              | Password   |
|----------------------|------------|
| Admin panel          | `admin123` |
| Certificate viewing  | `view123`  |

**Change these immediately in production** by updating the environment variables in `docker-compose.yml`.

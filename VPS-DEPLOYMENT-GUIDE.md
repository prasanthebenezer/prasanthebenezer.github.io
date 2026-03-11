# VPS Deployment Guide — prasanthebenezer.com

Complete step-by-step guide to deploy this portfolio website on a fresh VPS server
with Docker, Nginx, and free SSL certificates from Let's Encrypt.

---

## Prerequisites

- A VPS server (Ubuntu 22.04/24.04 or AlmaLinux/Rocky Linux recommended)
- Root or sudo access to the server
- A domain name with access to DNS settings
- SSH access to the server

---

## Step 1: Connect to Your VPS

```bash
ssh root@YOUR_SERVER_IP
```

If you have an SSH key:
```bash
ssh -i ~/.ssh/your_key root@YOUR_SERVER_IP
```

---

## Step 2: Update the System

**Ubuntu/Debian:**
```bash
apt update && apt upgrade -y
```

**AlmaLinux/Rocky/CentOS:**
```bash
dnf update -y
```

---

## Step 3: Install Docker & Docker Compose

### Ubuntu/Debian

```bash
# Install dependencies
apt install -y ca-certificates curl gnupg

# Add Docker GPG key
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

# Add Docker repository
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
```

### AlmaLinux/Rocky/CentOS

```bash
# Install dependencies
dnf install -y dnf-utils

# Add Docker repository
dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo

# Install Docker
dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
```

### Start Docker (all distros)

```bash
systemctl start docker
systemctl enable docker
```

### Verify installation

```bash
docker --version
docker compose version
```

---

## Step 4: Install Git

**Ubuntu/Debian:**
```bash
apt install -y git
```

**AlmaLinux/Rocky/CentOS:**
```bash
dnf install -y git
```

---

## Step 5: Clone the Repository

```bash
cd ~
git clone https://github.com/prasanthebenezer/prasanthebenezer.github.io.git
cd prasanthebenezer.github.io
```

---

## Step 6: Point Your Domain to the VPS

1. Log in to your domain registrar (Hostinger, Namecheap, GoDaddy, etc.)
2. Go to **DNS Management** for `prasanthebenezer.com`
3. Set (or update) the following **A records**:

| Type | Name | Value           | TTL  |
|------|------|-----------------|------|
| A    | @    | YOUR_SERVER_IP  | 3600 |
| A    | www  | YOUR_SERVER_IP  | 3600 |

4. Wait for DNS propagation (can take 5 minutes to 48 hours, usually under 30 minutes)

### Verify DNS is pointing to your new server

```bash
# Run this from any machine
ping prasanthebenezer.com
# Should show YOUR_SERVER_IP

# Or use dig
dig prasanthebenezer.com +short
```

---

## Step 7: Open Firewall Ports

Make sure ports 80 (HTTP) and 443 (HTTPS) are open.

### Using UFW (Ubuntu)

```bash
ufw allow 22/tcp    # SSH (don't lock yourself out!)
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS
ufw enable
ufw status
```

### Using firewalld (AlmaLinux/Rocky)

```bash
firewall-cmd --permanent --add-service=http
firewall-cmd --permanent --add-service=https
firewall-cmd --reload
firewall-cmd --list-all
```

### Hostinger VPS Firewall

If using Hostinger, also check:
1. Go to **hPanel** > **VPS** > **Firewall**
2. Ensure rules allow incoming TCP on ports **80** and **443**

---

## Step 8: Stop Any Conflicting Services

If the VPS came with a pre-installed web server, stop it first:

```bash
# Check if anything is using port 80
ss -tlnp | grep ':80'

# Stop OpenLiteSpeed (common on Hostinger VPS)
systemctl stop lsws 2>/dev/null
systemctl disable lsws 2>/dev/null

# Stop Apache
systemctl stop apache2 2>/dev/null || systemctl stop httpd 2>/dev/null
systemctl disable apache2 2>/dev/null || systemctl disable httpd 2>/dev/null

# Stop Nginx (if installed on host, not in Docker)
systemctl stop nginx 2>/dev/null
systemctl disable nginx 2>/dev/null
```

Verify port 80 is free:
```bash
ss -tlnp | grep ':80'
# Should return nothing
```

---

## Step 9: Get SSL Certificates with Let's Encrypt

### Install Certbot

**Ubuntu/Debian:**
```bash
apt install -y certbot
```

**AlmaLinux/Rocky/CentOS:**
```bash
dnf install -y certbot
```

### Obtain the SSL Certificate

Certbot needs port 80 free to complete the challenge.

```bash
certbot certonly --standalone \
  -d prasanthebenezer.com \
  -d www.prasanthebenezer.com \
  --email prasanth@youremail.com \
  --agree-tos \
  --non-interactive
```

Replace `prasanth@youremail.com` with your real email for renewal notifications.

### Verify the certificates were created

```bash
ls -la /etc/letsencrypt/live/prasanthebenezer.com/
```

You should see:
- `fullchain.pem` — the certificate + intermediate chain
- `privkey.pem` — the private key
- `cert.pem` — the certificate only
- `chain.pem` — the intermediate chain

### Copy certificates to the project directory

The docker-compose.yml mounts `./letsencrypt` into the container:

```bash
cd ~/prasanthebenezer.github.io
cp -rL /etc/letsencrypt ./letsencrypt
```

> **Note:** The `-L` flag follows symlinks, which is important because
> Let's Encrypt stores certs as symlinks.

---

## Step 10: Build and Launch the Docker Container

```bash
cd ~/prasanthebenezer.github.io

# Build and start the container
docker compose up -d --build
```

### Verify it's running

```bash
# Check container status
docker ps

# Expected output:
# CONTAINER ID  IMAGE          STATUS        PORTS                                     NAMES
# abc123...     ...portfolio   Up X mins     0.0.0.0:80->80/tcp, 0.0.0.0:443->443/tcp  prasanth-portfolio

# Test from the server itself
curl -I http://localhost
curl -I https://localhost --insecure
```

---

## Step 11: Test Your Website

From your local machine (not the server):

```bash
# Test HTTP (should redirect to HTTPS)
curl -I http://prasanthebenezer.com

# Test HTTPS
curl -I https://prasanthebenezer.com

# Test www redirect
curl -I https://www.prasanthebenezer.com
```

Expected responses:
- `http://` → 301 redirect to `https://`
- `https://www.` → 301 redirect to `https://prasanthebenezer.com`
- `https://prasanthebenezer.com` → 200 OK

Then open in your browser: **https://prasanthebenezer.com**

---

## Step 12: Set Up Automatic SSL Renewal

Let's Encrypt certificates expire every 90 days. Set up auto-renewal:

```bash
# Test renewal (dry run)
certbot renew --dry-run
```

### Create a renewal script

```bash
cat > /root/renew-ssl.sh << 'SCRIPT'
#!/bin/bash
# Renew SSL certificates and update Docker container

# Renew certificates
certbot renew --quiet

# Copy renewed certs to project directory
cp -rL /etc/letsencrypt /root/prasanthebenezer.github.io/letsencrypt

# Reload nginx inside the container to pick up new certs
docker exec prasanth-portfolio nginx -s reload
SCRIPT

chmod +x /root/renew-ssl.sh
```

### Add to crontab (runs twice daily, as recommended by Let's Encrypt)

```bash
crontab -e
```

Add this line:
```
0 0,12 * * * /root/renew-ssl.sh >> /var/log/ssl-renewal.log 2>&1
```

---

## Useful Commands

### Container management

```bash
# View logs
docker compose logs -f

# Restart the container
docker compose restart

# Stop the container
docker compose down

# Rebuild and restart (after code changes)
docker compose up -d --build
```

### Updating the website

```bash
cd ~/prasanthebenezer.github.io

# Pull latest changes from GitHub
git pull origin main

# Rebuild and restart
docker compose up -d --build
```

### Check SSL certificate expiry

```bash
echo | openssl s_client -connect prasanthebenezer.com:443 2>/dev/null | openssl x509 -noout -dates
```

---

## Troubleshooting

### "Connection Refused" on port 80/443

```bash
# Is the container running?
docker ps

# Is something else using the port?
ss -tlnp | grep -E ':80|:443'

# Is the firewall blocking it?
ufw status          # Ubuntu
firewall-cmd --list-all  # AlmaLinux/Rocky

# Check Hostinger panel firewall if applicable
```

### Container starts but crashes

```bash
# Check logs for errors
docker compose logs

# Common cause: SSL cert files missing
ls -la ./letsencrypt/live/prasanthebenezer.com/
```

### SSL certificate won't issue

```bash
# Make sure DNS is pointing to THIS server
dig prasanthebenezer.com +short

# Make sure port 80 is free for the ACME challenge
ss -tlnp | grep ':80'

# Try with verbose output
certbot certonly --standalone \
  -d prasanthebenezer.com \
  -d www.prasanthebenezer.com \
  --email prasanth@youremail.com \
  --agree-tos \
  -v
```

### Running without SSL first (HTTP only)

If you want to test before setting up SSL, temporarily use a simpler nginx config.
Create a file called `nginx-http-only.conf`:

```nginx
server {
    listen 80;
    server_name prasanthebenezer.com www.prasanthebenezer.com;
    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Then run:
```bash
# Backup original config
cp nginx.conf nginx-ssl.conf

# Use HTTP-only config
cp nginx-http-only.conf nginx.conf

# Update docker-compose to remove SSL volume mount
# (comment out the letsencrypt volume line)

# Build and run
docker compose up -d --build

# Test
curl -I http://prasanthebenezer.com
```

Once confirmed working, restore the SSL config and proceed with Step 9.

---

## Quick Reference — Full Deploy in One Go

For experienced users, here's the condensed version:

```bash
# On a fresh VPS as root:
apt update && apt upgrade -y
apt install -y docker.io docker-compose-plugin git certbot
systemctl enable --now docker

# Stop conflicting services
systemctl stop lsws apache2 nginx 2>/dev/null
systemctl disable lsws apache2 nginx 2>/dev/null

# Clone repo
cd ~ && git clone https://github.com/prasanthebenezer/prasanthebenezer.github.io.git
cd prasanthebenezer.github.io

# Get SSL cert (DNS must already point to this server)
certbot certonly --standalone \
  -d prasanthebenezer.com -d www.prasanthebenezer.com \
  --email prasanth@youremail.com --agree-tos --non-interactive

# Copy certs and launch
cp -rL /etc/letsencrypt ./letsencrypt
docker compose up -d --build

# Set up auto-renewal
echo '0 0,12 * * * root certbot renew --quiet && cp -rL /etc/letsencrypt /root/prasanthebenezer.github.io/letsencrypt && docker exec prasanth-portfolio nginx -s reload' >> /etc/crontab

echo "Done! Visit https://prasanthebenezer.com"
```

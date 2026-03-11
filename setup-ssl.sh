#!/bin/bash

# SSL Setup Script for prasanthebenezer.com
# Run this script to get Let's Encrypt certificates

echo "=== SSL Setup for prasanthebenezer.com ==="
echo ""

# Step 1: Stop OpenLiteSpeed
echo "Step 1: Stopping OpenLiteSpeed..."
systemctl stop lsws
systemctl disable lsws

# Step 2: Install certbot
echo "Step 2: Installing certbot..."
dnf install -y certbot

# Step 3: Create letsencrypt directory
echo "Step 3: Creating letsencrypt directory..."
mkdir -p ~/prasanthebenezer.github.io/letsencrypt

# Step 4: Get SSL certificate
echo "Step 4: Getting SSL certificate..."
echo "IMPORTANT: Make sure your DNS A record points to this server's IP!"
echo ""
read -p "Press Enter to continue once DNS is configured..."

certbot certonly --standalone \
  -d prasanthebenezer.com \
  -d www.prasanthebenezer.com \
  --email prasanthebenezer@gmail.com \
  --agree-tos \
  --non-interactive

# Step 5: Copy certificates to project directory
echo "Step 5: Copying certificates..."
cp -rL /etc/letsencrypt ~/prasanthebenezer.github.io/

# Step 6: Set up auto-renewal
echo "Step 6: Setting up auto-renewal..."
echo "0 0,12 * * * root certbot renew --quiet && cp -rL /etc/letsencrypt ~/prasanthebenezer.github.io/" >> /etc/crontab

# Step 7: Start Docker container
echo "Step 7: Starting Docker container..."
cd ~/prasanthebenezer.github.io
docker-compose down
docker-compose up -d --build

echo ""
echo "=== Setup Complete! ==="
echo "Your site should now be available at:"
echo "  https://prasanthebenezer.com"
echo ""
echo "Check status with: docker ps"
echo "View logs with: docker-compose logs -f"

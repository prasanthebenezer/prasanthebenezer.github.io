#!/bin/bash
# Certbot deploy hook: after a successful renewal, sync the fresh certs
# into the portfolio repo (read-only bind-mounted into the nginx container
# at /etc/letsencrypt) and reload nginx.
#
# Runtime: /etc/letsencrypt/renewal-hooks/deploy/sync-and-reload.sh -> this file.
set -euo pipefail

REPO=/root/prasanthebenezer.github.io

cp -rL /etc/letsencrypt/live "$REPO/letsencrypt/"
cp -rL /etc/letsencrypt/archive "$REPO/letsencrypt/"
cp -rL /etc/letsencrypt/renewal "$REPO/letsencrypt/"

docker exec prasanth-portfolio nginx -s reload

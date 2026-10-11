#!/bin/bash
# Upgrade the self-hosted n8n stack, then verify it is still served at
# https://n8n.prasanthebenezer.com via the portfolio nginx.
#
# get-n8n.sh --upgrade only edits the two version lines in .env and the sandbox
# image tags in compose.yml, so our proxy settings in /root/n8n/compose.yml
# (localhost-only port, N8N_HOST/WEBHOOK_URL, portfolio network) survive it.
# It finds the install via ./n8n relative to the cwd, so N8N_DIR is pinned here.
#
# Usage: n8n-upgrade.sh           upgrade, then verify
#        n8n-upgrade.sh --check   verify only
set -uo pipefail

N8N_DIR=/root/n8n
HOST=n8n.prasanthebenezer.com
PORTFOLIO_NET=prasanthebenezergithubio_default

if [[ "${1:-}" != "--check" ]]; then
  curl -fsSL https://get.n8n.io | N8N_DIR="$N8N_DIR" sh -s -- --upgrade || exit 1
  echo
fi

failed=0
check() {  # check <description> <command...>
  local desc=$1; shift
  if "$@" >/dev/null 2>&1; then
    echo "  [OK]    $desc"
  else
    echo "  [FAIL]  $desc"
    failed=1
  fi
}

container=$(docker compose -f "$N8N_DIR/compose.yml" ps -q n8n)

echo "Verifying n8n proxy setup:"
check "port 5678 bound to localhost only" \
  bash -c '! ss -tlnH "sport = :5678" | grep -v -q "127.0.0.1:5678"'
check "n8n container joined to $PORTFOLIO_NET" \
  bash -c "docker inspect -f '{{json .NetworkSettings.Networks}}' '$container' | grep -q '\"$PORTFOLIO_NET\"'"
check "N8N_HOST=$HOST in container" \
  bash -c "docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' '$container' | grep -qx 'N8N_HOST=$HOST'"
check "https://$HOST/healthz returns 200" \
  bash -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' -m 15 https://$HOST/healthz)\" = 200 ]"
check "editor websocket upgrades (101)" \
  bash -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' --http1.1 -m 5 \
    -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
    -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' 'https://$HOST/rest/push?pushRef=check')\" = 101 ]"

if (( failed )); then
  echo
  echo "Something drifted. Compare $N8N_DIR/compose.yml (n8n service: ports,"
  echo "environment, networks) against the proxy setup described in CLAUDE.md,"
  echo "then: docker compose -f $N8N_DIR/compose.yml up -d"
  exit 1
fi
echo "All good: https://$HOST"

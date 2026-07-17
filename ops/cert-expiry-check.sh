#!/bin/bash
# Cert expiry monitor: TLS-probes each hostname, alerts via ntfy.sh if any
# cert is close to expiry. Deliberately independent of certbot state so it
# catches silent renewal failures (the exact failure mode from Jun 2026).
#
# Runtime: /usr/local/bin/cert-expiry-check.sh -> this file (symlink).
# Scheduled by: /etc/systemd/system/cert-expiry-check.timer -> ops/systemd/.
# Secret: NTFY_TOPIC lives in /etc/cert-monitor.env (chmod 600, not in git).
set -uo pipefail

CONFIG=/etc/cert-monitor.env
if [[ -r "$CONFIG" ]]; then
  # shellcheck disable=SC1090
  source "$CONFIG"
fi
: "${NTFY_TOPIC:?NTFY_TOPIC not set (expected in $CONFIG)}"

HOSTS=(
  prasanthebenezer.com
  www.prasanthebenezer.com
  maintenance.prasanthebenezer.com
  calibration.prasanthebenezer.com
)

WARN_DAYS=20
CRIT_DAYS=7
NTFY_URL="https://ntfy.sh/${NTFY_TOPIC}"
HOSTNAME_FQDN="$(hostname -f 2>/dev/null || hostname)"

now_epoch=$(date +%s)
worst_days=999
worst_level="OK"
report=""

for host in "${HOSTS[@]}"; do
  not_after=$(echo | timeout 10 openssl s_client -connect "${host}:443" -servername "${host}" 2>/dev/null \
    | openssl x509 -noout -enddate 2>/dev/null \
    | sed 's/notAfter=//')

  if [[ -z "$not_after" ]]; then
    line="  [FAIL]  ${host}  — could not fetch cert"
    level="CRITICAL"
    days=-1
  else
    expiry_epoch=$(date -d "$not_after" +%s 2>/dev/null || echo 0)
    days=$(( (expiry_epoch - now_epoch) / 86400 ))
    if   (( days <= CRIT_DAYS )); then level="CRITICAL"
    elif (( days <= WARN_DAYS )); then level="WARN"
    else                               level="OK"
    fi
    line="  [${level}]  ${host}  — ${days} days left (expires ${not_after})"
  fi

  report+="${line}"$'\n'

  if [[ "$level" == "CRITICAL" ]] || { [[ "$level" == "WARN" ]] && [[ "$worst_level" != "CRITICAL" ]]; }; then
    worst_level="$level"
  fi
  if (( days < worst_days )); then worst_days=$days; fi
done

echo "$report"

if [[ "$worst_level" == "OK" ]]; then
  exit 0
fi

if [[ "$worst_level" == "CRITICAL" ]]; then
  priority="urgent"
  tags="rotating_light,lock"
else
  priority="high"
  tags="warning,lock"
fi

title="[${worst_level}] TLS cert on ${HOSTNAME_FQDN} — ${worst_days}d left"
body="${report}
Thresholds: WARN <= ${WARN_DAYS}d, CRIT <= ${CRIT_DAYS}d.
Certbot renews at 30d remaining, so WARN means a renewal cycle was missed.

Investigate on VPS:
  journalctl -u certbot-renew.service --since '7 days ago'
  certbot certificates
  systemctl status certbot-renew.timer"

curl -sS --max-time 15 \
  -H "Title: ${title}" \
  -H "Priority: ${priority}" \
  -H "Tags: ${tags}" \
  -d "${body}" \
  "${NTFY_URL}" >/dev/null

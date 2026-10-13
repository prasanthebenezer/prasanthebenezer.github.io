#!/bin/bash
# Back up everything on the VPS that a rebuild needs but git doesn't hold:
# secrets, TLS certs, VPN keys, n8n data, uploader links/files, and the
# n8n/ollama compose files. Restore steps are in REINSTALL.md.
#
# Runtime: /usr/local/bin/vps-backup -> this file (symlink).
#
# Usage: vps-backup    writes /root/backups/vps-backup-<date>.tgz (chmod 600)
#                      and then deletes the older vps-backup-*.tgz there
#
# Runs daily from systemd/vps-backup.timer.
#
# Deliberately left out: the Ollama models (ollama_ollama volume, several GB,
# re-pull with `ollama pull`), the Open WebUI volume, ClamAV signatures and
# container images. All are re-downloaded on a fresh install.
set -euo pipefail

OUT_DIR=/root/backups
OUT="$OUT_DIR/vps-backup-$(date -u +%Y%m%d-%H%M).tgz"
WORK=$(mktemp -d)
umask 077

# Host files and folders, stored at their absolute paths inside the archive.
HOST_PATHS=(
  /etc/contact-form.env
  /etc/cert-monitor.env
  /etc/vps-uploader
  /etc/letsencrypt
  /var/lib/vps-uploader/shares.db
  /var/lib/vps-uploader/quarantine/quarantine.log
  /srv/uploads
  /root/n8n
  /root/ollama/docker-compose.yml
  /root/.ssh/authorized_keys
)

# Docker volume -> container that writes to it.
declare -A VOLUMES=(
  [wg-easy_etc_wireguard]=wg-easy
  [n8n_n8n-data]=n8n-n8n-1
)

# Containers are paused (frozen for a few seconds, not restarted) while their
# data is copied, so SQLite databases are captured in a consistent state.
PAUSED=()
pause() {
  if docker ps -q --filter "name=^$1$" --filter status=running | grep -q .; then
    docker pause "$1" >/dev/null && PAUSED+=("$1")
  fi
}
cleanup() {
  for c in "${PAUSED[@]}"; do docker unpause "$c" >/dev/null 2>&1 || true; done
  rm -rf "$WORK"
}
trap cleanup EXIT

mkdir -p "$WORK/volumes"
for vol in "${!VOLUMES[@]}"; do
  pause "${VOLUMES[$vol]}"
  docker run --rm -v "$vol:/data:ro" -v "$WORK/volumes:/out" alpine \
    tar czf "/out/$vol.tgz" -C /data .
  echo "volume  $vol"
done

pause vps-uploader   # for shares.db
existing=()
for p in "${HOST_PATHS[@]}"; do
  if [[ -e $p ]]; then existing+=("${p#/}"); echo "files   $p"
  else echo "missing $p (skipped)"; fi
done
tar czf "$WORK/host-files.tgz" -C / "${existing[@]}"

cleanup_paused() { for c in "${PAUSED[@]}"; do docker unpause "$c" >/dev/null; done; PAUSED=(); }
cleanup_paused

cat > "$WORK/README.txt" <<EOF
VPS backup made $(date -u '+%Y-%m-%d %H:%M UTC') on $(hostname).
Contains passwords, private keys and TLS keys: keep it private, never put it in git.
Restore steps: REINSTALL.md in github.com/prasanthebenezer/prasanthebenezer.github.io

host-files.tgz       extract at / on the new VPS:  tar xzf host-files.tgz -C /
volumes/<name>.tgz   one per Docker volume, extract into that volume (see REINSTALL.md)
EOF

mkdir -p "$OUT_DIR"
tar czf "$OUT" -C "$WORK" README.txt host-files.tgz volumes
chmod 600 "$OUT"

# Only now that the new backup is complete, remove the older ones.
find "$OUT_DIR" -maxdepth 1 -name 'vps-backup-*.tgz' ! -path "$OUT" -print -delete | sed 's/^/removed /'
echo
echo "Backup: $OUT ($(du -h "$OUT" | cut -f1))"
echo "Download it from your PC (PowerShell) with:"
echo "  scp root@$(hostname -I | awk '{print $1}'):$OUT ."

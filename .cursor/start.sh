#!/usr/bin/env bash
# Per-boot reconciliation: start the Docker daemon, bring up the local Supabase
# stack, and (re)generate .env.local. Idempotent and returns once ready.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# --- Docker daemon -----------------------------------------------------------
# Re-assert nested-container settings (cheap; also covers non-snapshot boots).
sudo mkdir -p /etc/docker
echo '{"storage-driver":"fuse-overlayfs","features":{"containerd-snapshotter":false}}' | sudo tee /etc/docker/daemon.json >/dev/null
sudo update-alternatives --set iptables /usr/sbin/iptables-legacy >/dev/null 2>&1 || true
sudo update-alternatives --set ip6tables /usr/sbin/ip6tables-legacy >/dev/null 2>&1 || true

if ! sudo docker info >/dev/null 2>&1; then
  echo "[start] Starting dockerd..."
  # Detach so the daemon outlives this script.
  sudo nohup dockerd >/tmp/dockerd.log 2>&1 &
  for i in $(seq 1 60); do
    sudo docker info >/dev/null 2>&1 && break
    sleep 1
  done
fi
# Let the non-root user talk to the daemon without sudo (supabase CLI uses `docker`).
sudo chmod 666 /var/run/docker.sock || true

# --- Local Supabase stack ----------------------------------------------------
# A disk snapshot/build can bake stale Supabase container state (containers exist
# but are not actually running post-boot), which makes `supabase start` fail with
# "already running / container is not ready". Reset first, then start fresh so every
# boot converges to a clean, migrated DB. Images stay cached, so this is still fast.
echo "[start] Bringing up local Supabase (reset stale state, then start)..."
supabase stop --no-backup >/dev/null 2>&1 || true
sb_ok=0
for attempt in 1 2 3; do
  if supabase start; then sb_ok=1; break; fi
  echo "[start] supabase start attempt ${attempt} failed; resetting and retrying..."
  supabase stop --no-backup >/dev/null 2>&1 || true
  sleep 5
done
if [ "$sb_ok" != "1" ]; then
  echo "[start] ERROR: local Supabase failed to start" >&2
  exit 1
fi

# --- App environment file ----------------------------------------------------
echo "[start] Writing .env.local from live Supabase status..."
bash "$REPO_ROOT/.cursor/gen-env-local.sh"

echo "[start] Ready. App env wired to local Supabase at http://127.0.0.1:54321"

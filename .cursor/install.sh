#!/usr/bin/env bash
# One-time, idempotent setup that bakes into the environment snapshot/build.
# Durable, source-derived work belongs here; per-boot runtime lives in start.sh.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)" # Repo root regardless of cwd
cd "$REPO_ROOT"

echo "[install] Installing Node dependencies..."
npm install # Uses the repo's package-lock.json

echo "[install] Ensuring Docker + fuse-overlayfs (local Supabase runs in containers)..."
if ! command -v dockerd >/dev/null 2>&1; then
  sudo apt-get update -y
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io fuse-overlayfs uidmap || true
fi

echo "[install] Ensuring Supabase CLI..."
if ! command -v supabase >/dev/null 2>&1; then
  ARCH="$(dpkg --print-architecture)" # amd64 / arm64
  curl -fsSL "https://github.com/supabase/cli/releases/latest/download/supabase_linux_${ARCH}.tar.gz" -o /tmp/supabase.tar.gz
  tar -xzf /tmp/supabase.tar.gz -C /tmp
  sudo mv /tmp/supabase /usr/local/bin/supabase
fi

echo "[install] Configuring Docker for this nested-container VM (disk-persistent)..."
# overlay2 mounts fail inside this nested container; fuse-overlayfs works. Disable the
# containerd snapshotter so the classic fuse-overlayfs graphdriver is used.
sudo mkdir -p /etc/docker
echo '{"storage-driver":"fuse-overlayfs","features":{"containerd-snapshotter":false}}' | sudo tee /etc/docker/daemon.json >/dev/null
# Docker programs bridge FORWARD rules via iptables. The host's active firewall backend
# is iptables-legacy (FORWARD policy DROP); the nft backend is empty, so container-to-
# container traffic is dropped unless Docker uses the legacy backend.
sudo update-alternatives --set iptables /usr/sbin/iptables-legacy || true
sudo update-alternatives --set ip6tables /usr/sbin/ip6tables-legacy || true

echo "[install] Pre-pulling Supabase images and validating migrations (bakes into snapshot)..."
# Bring the full stack up once so images are cached on disk and migrations are proven,
# then leave it running for the snapshot. start.sh reconciles it on every boot.
bash "$REPO_ROOT/.cursor/start.sh"

echo "[install] Done."

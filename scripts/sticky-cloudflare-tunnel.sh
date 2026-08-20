#!/usr/bin/env bash
# Quick tunnel that survives Cursor agent shell abort (own process group).
# Each run replaces any previous sticky (and agent-tied) quick tunnel.
# Usage: scripts/sticky-cloudflare-tunnel.sh [port]
# State: /tmp/thinktable-cloudflared.{pid,url,log}

set -euo pipefail

PORT="${1:-3031}"
PIDFILE="/tmp/thinktable-cloudflared.pid"
URLFILE="/tmp/thinktable-cloudflared.url"
LOGFILE="/tmp/thinktable-cloudflared.log"
MATCH='cloudflared tunnel --url http://localhost:'

stop_cloudflared() {
  # Prior sticky — kill whole process group (start_new_session → PGID == PID).
  if [[ -f "$PIDFILE" ]]; then
    OLD_PID="$(cat "$PIDFILE" 2>/dev/null || true)"
    if [[ -n "${OLD_PID}" ]]; then
      kill -TERM -- "-${OLD_PID}" 2>/dev/null || kill -TERM "$OLD_PID" 2>/dev/null || true
    fi
  fi
  # Any other quick tunnels (stale sticky or agent-tied).
  pkill -TERM -f "$MATCH" 2>/dev/null || true

  # Wait until gone (up to ~5s), then force.
  for _ in $(seq 1 10); do
    pgrep -f "$MATCH" >/dev/null 2>&1 || break
    sleep 0.5
  done
  if pgrep -f "$MATCH" >/dev/null 2>&1; then
    pkill -KILL -f "$MATCH" 2>/dev/null || true
    sleep 0.3
  fi

  rm -f "$PIDFILE" "$URLFILE"
}

stop_cloudflared

: >"$LOGFILE"

# Detach into a new session so Cursor SIGTERM on the agent shell cannot kill it.
python3 - "$PORT" "$PIDFILE" "$URLFILE" "$LOGFILE" <<'PY'
import re
import subprocess
import sys
import time
from pathlib import Path

port, pidfile, urlfile, logfile = sys.argv[1:5]
log = open(logfile, "a", buffering=1)
proc = subprocess.Popen(
    ["cloudflared", "tunnel", "--url", f"http://localhost:{port}"],
    stdout=log,
    stderr=subprocess.STDOUT,
    start_new_session=True,  # new process group — survives agent shell cleanup
)
Path(pidfile).write_text(str(proc.pid))

for _ in range(60):
    time.sleep(0.5)
    text = Path(logfile).read_text(errors="replace")
    match = re.search(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com", text)
    if match:
        url = match.group(0)
        Path(urlfile).write_text(url + "\n")
        print(url)
        break
else:
    sys.exit("sticky tunnel: no trycloudflare URL in log after 30s")
PY

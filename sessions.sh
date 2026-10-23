#!/usr/bin/env bash
set -euo pipefail

# ── Metadata ──────────────────────────────────────────────────────────────────
SCRIPT_NAME="sessions"
SCRIPT_VERSION="1.0.0"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="${ROOT}/logs"
RUN_DIR="${ROOT}/.run"
PID_FILE="${RUN_DIR}/server.pid"
SERVER_LOG="${LOG_DIR}/server.log"
LOG_FILE="${LOG_DIR}/${SCRIPT_NAME}_$(date +%Y%m%d_%H%M%S).log"

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'
CYAN='\033[0;36m'; MAGENTA='\033[0;35m'; BOLD='\033[1m'; NC='\033[0m'

# ── Logging ───────────────────────────────────────────────────────────────────
mkdir -p "$LOG_DIR" "$RUN_DIR"
_w()   { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"; }
log()  { echo -e "${CYAN}[INFO]  $*${NC}";  _w "[INFO]  $*"; }
ok()   { echo -e "${GREEN}[OK]    $*${NC}";  _w "[OK]    $*"; }
warn() { echo -e "${YELLOW}[WARN]  $*${NC}" >&2; _w "[WARN]  $*"; }
err()  { echo -e "${RED}[ERROR] $*${NC}" >&2; _w "[ERROR] $*"; }
step() { echo -e "${MAGENTA}${BOLD}[STEP]  $*${NC}"; _w "[STEP]  $*"; }

cleanup() {
    local code=$?
    [[ $code -ne 0 && $code -ne 3 ]] && err "Exited with code $code. Check log: $LOG_FILE"
    return 0
}
trap cleanup EXIT

# ── Usage ─────────────────────────────────────────────────────────────────────
usage() {
    echo -e "${BOLD}Usage:${NC} $0 <start|stop|restart|status> [OPTIONS]"
    echo ""
    echo -e "${BOLD}Options:${NC}"
    echo "  -d, --detach          Run in the background (start/restart); terminal is released"
    echo "  -p, --port N          Port to listen on (default: 4780)"
    echo "      --dir PATH        Extra Claude config dir to include (repeatable)"
    echo "  -h, --help            Show this help"
    echo ""
    echo -e "${BOLD}Examples:${NC}"
    echo "  $0 start -d           # background"
    echo "  $0 start              # foreground, Ctrl+C stops it"
    echo "  $0 stop"
    echo "  $0 restart -d -p 4781"
    exit "${1:-0}"
}

# ── Argument parsing ──────────────────────────────────────────────────────────
CMD=""; DETACH=false; PORT=4780; EXTRA_ARGS=()
[[ $# -eq 0 ]] && usage 2
while [[ $# -gt 0 ]]; do
    case "$1" in
        start|stop|restart|status) CMD="$1"; shift ;;
        -d|--detach) DETACH=true; shift ;;
        -p|--port)   [[ $# -ge 2 ]] || { err "--port needs a value"; usage 2; }; PORT="$2"; shift 2 ;;
        --dir)       [[ $# -ge 2 ]] || { err "--dir needs a value"; usage 2; }; EXTRA_ARGS+=(--dir "$2"); shift 2 ;;
        -h|--help)   usage 0 ;;
        *) err "Unknown option: $1"; usage 2 ;;
    esac
done
[[ -n "$CMD" ]] || { err "A command is required"; usage 2; }
[[ "$PORT" =~ ^[0-9]+$ ]] || { err "Port must be a number: $PORT"; exit 2; }

# ── Helpers ───────────────────────────────────────────────────────────────────
NODE_BIN="$(command -v node || true)"

# PID of our server: from the pid file if alive, else whoever listens on the port with server.js.
find_pid() {
    local pid=""
    if [[ -f "$PID_FILE" ]]; then
        pid="$(cat "$PID_FILE" 2>/dev/null || true)"
        if [[ -n "$pid" ]] && ps -p "$pid" -o command= 2>/dev/null | grep -q "server.js"; then echo "$pid"; return 0; fi
        rm -f "$PID_FILE"
    fi
    for pid in $(lsof -ti "tcp:${PORT}" -sTCP:LISTEN 2>/dev/null || true); do
        if ps -p "$pid" -o command= 2>/dev/null | grep -q "server.js"; then echo "$pid"; return 0; fi
    done
    return 1
}

do_status() {
    local pid
    if pid="$(find_pid)"; then
        ok "Running (pid $pid) → http://localhost:${PORT}"
        return 0
    fi
    warn "Not running"
    return 3
}

do_stop() {
    local pid i
    step "Stopping server..."
    if ! pid="$(find_pid)"; then warn "Not running, nothing to stop"; return 0; fi
    kill "$pid" 2>/dev/null || true
    for i in $(seq 1 20); do
        kill -0 "$pid" 2>/dev/null || { rm -f "$PID_FILE"; ok "Stopped (pid $pid)"; return 0; }
        sleep 0.5
    done
    warn "Did not exit after 10s, sending SIGKILL"
    kill -9 "$pid" 2>/dev/null || true
    rm -f "$PID_FILE"
    ok "Killed (pid $pid)"
}

do_start() {
    local pid i
    step "Starting server on port ${PORT}..."
    [[ -n "$NODE_BIN" ]] || { err "node not found on PATH"; exit 1; }
    if pid="$(find_pid)"; then warn "Already running (pid $pid) → http://localhost:${PORT}"; return 0; fi
    if lsof -ti "tcp:${PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
        err "Port ${PORT} is used by another process. Use -p to pick a different port."; exit 1
    fi
    cd "$ROOT"
    if $DETACH; then
        nohup "$NODE_BIN" server.js --port "$PORT" ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"} >> "$SERVER_LOG" 2>&1 < /dev/null &
        pid=$!
        disown "$pid" 2>/dev/null || true
        echo "$pid" > "$PID_FILE"
        for i in $(seq 1 20); do
            if curl -fs -m 2 "http://localhost:${PORT}/api/status" >/dev/null 2>&1; then
                ok "Running in background (pid $pid) → http://localhost:${PORT}"
                log "Server log: $SERVER_LOG"
                return 0
            fi
            kill -0 "$pid" 2>/dev/null || { err "Server exited during startup. See $SERVER_LOG"; rm -f "$PID_FILE"; exit 1; }
            sleep 0.5
        done
        err "Server did not answer within 10s. See $SERVER_LOG"; exit 1
    fi
    log "Foreground mode, press Ctrl+C to stop → http://localhost:${PORT}"
    echo $$ > "$PID_FILE"          # exec keeps the same pid
    trap - EXIT
    exec "$NODE_BIN" server.js --port "$PORT" ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}
}

# ── Main ──────────────────────────────────────────────────────────────────────
echo -e "\n${BOLD}${MAGENTA}=== ${SCRIPT_NAME} v${SCRIPT_VERSION} ===${NC}\n"
case "$CMD" in
    start)   do_start ;;
    stop)    do_stop ;;
    restart) do_stop; do_start ;;
    status)  do_status || exit $? ;;
esac

#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_ROOT="${CREWAI_API_E2E_ROOT:-/tmp/crewai-api-e2e}"
STATE_DIR="${STATE_ROOT}/state"
WORK_DIR="${STATE_ROOT}/workspace"
BIN_PATH="${STATE_ROOT}/crewai-daemon"
JSONQ_BIN="${STATE_ROOT}/jsonq"
PID_FILE="${STATE_ROOT}/server.pid"
LOG_FILE="${STATE_ROOT}/server.log"
PORT="${CREWAI_API_E2E_PORT:-18766}"
BASE_URL="http://127.0.0.1:${PORT}"

step() {
  printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$*"
}

fail() {
  echo "error: $*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "missing command: $1"
}

server_pid() {
  [[ -f "${PID_FILE}" ]] && cat "${PID_FILE}"
}

is_server_running() {
  local pid
  pid="$(server_pid || true)"
  [[ -n "${pid}" ]] && kill -0 "${pid}" >/dev/null 2>&1
}

wait_for_health() {
  local retries="${1:-60}"
  local i
  for ((i=1; i<=retries; i++)); do
    if curl -fsS "${BASE_URL}/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  fail "server health check timeout"
}

wait_for_chat_idle() {
  local chat_id="$1"
  local retries="${2:-300}"
  local out_file="${3:-${STATE_ROOT}/chat.latest.json}"
  local i status
  for ((i=1; i<=retries; i++)); do
    api_get "/api/chat/sessions/${chat_id}" "${out_file}"
    status="$(json_get "${out_file}" "stream.status")"
    if [[ "${status}" == "idle" ]]; then
      return 0
    fi
    sleep 1
  done
  fail "chat ${chat_id} did not become idle"
}

api_get() {
  curl -fsS "${BASE_URL}$1" > "$2"
}

api_delete() {
  curl -fsS -X DELETE "${BASE_URL}$1" > "$2"
}

api_post() {
  curl -fsS -X POST "${BASE_URL}$1" \
    -H 'content-type: application/json' \
    -d "$2" > "$3"
}

api_put() {
  curl -fsS -X PUT "${BASE_URL}$1" \
    -H 'content-type: application/json' \
    -d "$2" > "$3"
}

json_get() {
  "${JSONQ_BIN}" -file "$1" -path "$2"
}

json_len() {
  "${JSONQ_BIN}" -file "$1" -path "$2" -len
}

json_line_get() {
  "${JSONQ_BIN}" -file "$1" -line-contains "$2" -path "$3"
}

json_time_to_unix() {
  "${JSONQ_BIN}" -value "$1" -unix-time
}

assert_eq() {
  local actual="$1"
  local expected="$2"
  local message="$3"
  [[ "${actual}" == "${expected}" ]] || fail "${message}: expected ${expected}, got ${actual}"
}

assert_nonempty() {
  [[ -n "$1" ]] || fail "$2"
}

assert_file_exists() {
  [[ -f "$1" ]] || fail "expected file to exist: $1"
}

assert_file_missing() {
  [[ ! -e "$1" ]] || fail "expected path to be absent: $1"
}

assert_dir_exists() {
  [[ -d "$1" ]] || fail "expected directory to exist: $1"
}

assert_contains() {
  grep -qF "$2" "$1" || fail "$3"
}

assert_not_contains() {
  if grep -qF "$2" "$1"; then
    fail "$3"
  fi
}

assert_dir_entries_exact() {
  local dir="$1"
  shift
  local actual expected
  actual="$(ls -1A "${dir}" | sort | tr '\n' ' ' | sed 's/ $//')"
  expected="$(printf '%s\n' "$@" | sort | tr '\n' ' ' | sed 's/ $//')"
  [[ "${actual}" == "${expected}" ]] || fail "unexpected entries in ${dir}: expected [${expected}], got [${actual}]"
}

build_binaries() {
  require_cmd curl
  require_cmd go

  step "Build crewai-daemon and jsonq"
  (
    cd "${ROOT_DIR}/daemon"
    go build -o "${BIN_PATH}" ./cmd/crewai-daemon
    go build -o "${JSONQ_BIN}" ./test-utils/jsonq
  )
}

start_server() {
  mkdir -p "${STATE_ROOT}"
  step "Start crewai-daemon"
  CREWAI_STATE_DIR="${STATE_DIR}" \
  PORT="${PORT}" \
  nohup "${BIN_PATH}" >"${LOG_FILE}" 2>&1 < /dev/null &
  local pid=$!
  disown || true
  echo "${pid}" > "${PID_FILE}"
  wait_for_health 60
}

destroy_server() {
  if is_server_running; then
    step "Stop crewai-daemon"
    kill "$(server_pid)" >/dev/null 2>&1 || true
    sleep 1
  fi
  rm -f "${PID_FILE}"
}

reset_state() {
  step "Reset application state"
  destroy_server || true
  rm -rf "${STATE_ROOT}"
  mkdir -p "${STATE_DIR}" "${WORK_DIR}"
  printf 'API_E2E_SIGNAL\n' > "${WORK_DIR}/.crewai-e2e-signal.txt"

  assert_file_missing "${STATE_DIR}/runtimes.json"
  assert_file_missing "${STATE_DIR}/agents"
  assert_file_missing "${STATE_DIR}/skills"
  assert_file_missing "${STATE_DIR}/projects"
  assert_file_missing "${STATE_DIR}/chats"
}

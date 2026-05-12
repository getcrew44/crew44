#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATE_ROOT="${CREWAI_UI_E2E_ROOT:-/tmp/crewai-ui-e2e}"
VITE_BIN="${ROOT_DIR}/node_modules/.bin/vite"
STATE_DIR="${STATE_ROOT}/state"
WORK_DIR="${STATE_ROOT}/workspace"
BIN_PATH="${STATE_ROOT}/crewai-daemon"
JSONQ_BIN="${STATE_ROOT}/jsonq"
PID_FILE="${STATE_ROOT}/server.pid"
VITE_PID_FILE="${STATE_ROOT}/vite.pid"
LOG_FILE="${STATE_ROOT}/server.log"
VITE_LOG_FILE="${STATE_ROOT}/vite.log"
PORT="${CREWAI_UI_E2E_PORT:-18767}"
FRONTEND_PORT="${CREWAI_UI_E2E_FRONTEND_PORT:-3977}"
BASE_URL="http://127.0.0.1:${PORT}"
RENDERER_URL="http://127.0.0.1:${FRONTEND_PORT}"

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

vite_pid() {
  [[ -f "${VITE_PID_FILE}" ]] && cat "${VITE_PID_FILE}"
}

is_pid_running() {
  local pid="$1"
  [[ -n "${pid}" ]] && kill -0 "${pid}" >/dev/null 2>&1
}

is_server_running() {
  is_pid_running "$(server_pid || true)"
}

is_vite_running() {
  is_pid_running "$(vite_pid || true)"
}

wait_for_url() {
  local url="$1"
  local retries="${2:-80}"
  local i
  for ((i=1; i<=retries; i++)); do
    if curl -fsS "${url}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done
  fail "timeout waiting for ${url}"
}

api_get() {
  curl -fsS "${BASE_URL}$1" > "$2"
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

build_binaries() {
  require_cmd curl
  require_cmd go
  require_cmd npm

  step "Build crewai-daemon and jsonq"
  (
    cd "${ROOT_DIR}/daemon"
    go build -o "${BIN_PATH}" ./cmd/crewai-daemon
    go build -o "${JSONQ_BIN}" ./test-utils/jsonq
  )
}

seed_runtime_state() {
  mkdir -p "${STATE_DIR}" "${WORK_DIR}"
  printf 'UI_E2E_SIGNAL\n' > "${WORK_DIR}/.crewai-ui-e2e-signal.txt"
}

start_server() {
  step "Start isolated backend"
  CREWAI_STATE_DIR="${STATE_DIR}" \
  PORT="${PORT}" \
  nohup "${BIN_PATH}" >"${LOG_FILE}" 2>&1 < /dev/null &
  local pid=$!
  disown || true
  echo "${pid}" > "${PID_FILE}"
  wait_for_url "${BASE_URL}/health" 80
}

seed_backend_resources() {
  step "Seed UI-visible resources"
  api_post "/api/runtimes/rescan" '{}' "${STATE_ROOT}/runtimes-rescan.json"
  api_get "/api/runtimes" "${STATE_ROOT}/runtimes.json"
  local runtime_count
  runtime_count="$(json_len "${STATE_ROOT}/runtimes.json" "items")"
  [[ "${runtime_count}" == "2" ]] || fail "expected codex and claude runtimes, got ${runtime_count}"

  api_get "/api/runtimes/codex" "${STATE_ROOT}/runtime-codex.json"
  api_get "/api/runtimes/claude" "${STATE_ROOT}/runtime-claude.json"
  [[ "$(json_get "${STATE_ROOT}/runtime-codex.json" "status")" == "available" ]] || fail "codex runtime is not available"
  [[ "$(json_get "${STATE_ROOT}/runtime-claude.json" "status")" == "available" ]] || fail "claude runtime is not available"

  api_get "/api/agents" "${STATE_ROOT}/agents.json"
  local agent_id
  agent_id="$(json_get "${STATE_ROOT}/agents.json" "items[0].id")"
  [[ -n "${agent_id}" ]] || fail "default agent was not bootstrapped"
  [[ "$(json_get "${STATE_ROOT}/agents.json" "items[0].runtime_id")" == "codex" ]] || fail "default agent should use codex runtime"

  api_post "/api/agents" \
    '{"name":"Claude UI E2E","instruction":"You are a concise UI e2e reviewer. Reply exactly as requested.","runtime_id":"claude","model":"claude-sonnet-4-6"}' \
    "${STATE_ROOT}/agent-claude.json"
  local claude_agent_id
  claude_agent_id="$(json_get "${STATE_ROOT}/agent-claude.json" "id")"
  [[ -n "${claude_agent_id}" ]] || fail "claude agent was not created"

  api_post "/api/skills" '{"name":"UI E2E Skill"}' "${STATE_ROOT}/skill.json"
  local skill_id
  skill_id="$(json_get "${STATE_ROOT}/skill.json" "id")"
  api_put "/api/agents/${agent_id}/skills" "{\"skill_ids\":[\"${skill_id}\"]}" "${STATE_ROOT}/agent-codex-skills.json"

  api_post "/api/projects" \
    "{\"name\":\"UI E2E Workspace\",\"workdir\":\"${WORK_DIR}\",\"main_agent_id\":\"${agent_id}\"}" \
    "${STATE_ROOT}/project.json"
  local project_id
  project_id="$(json_get "${STATE_ROOT}/project.json" "id")"
  api_post "/api/chat/sessions" \
    "{\"project_id\":\"${project_id}\",\"title\":\"UI E2E Chat\",\"main_agent_id\":\"${agent_id}\"}" \
    "${STATE_ROOT}/chat.json"
}

start_frontend() {
  [[ -d "${ROOT_DIR}/node_modules/electron" ]] || fail "missing Electron dependencies; run npm install"

  if is_vite_running; then
    return
  fi

  step "Start Vite renderer"
  (
    cd "${ROOT_DIR}"
    CREWAI_BACKEND_URL="${BASE_URL}" \
    nohup "${VITE_BIN}" --host 127.0.0.1 --port "${FRONTEND_PORT}" >"${VITE_LOG_FILE}" 2>&1 < /dev/null &
    echo "$!" > "${VITE_PID_FILE}"
    disown || true
  )
  wait_for_url "${RENDERER_URL}" 80
}

open_electron() {
  step "Open Electron UI"
  (
    cd "${ROOT_DIR}"
    CREWAI_RENDERER_URL="${RENDERER_URL}" \
    CREWAI_BACKEND_URL="${BASE_URL}" \
    node electron/scripts/run.cjs
  )
}

destroy() {
  if is_vite_running; then
    step "Stop Vite renderer"
    kill "$(vite_pid)" >/dev/null 2>&1 || true
  fi
  if is_server_running; then
    step "Stop isolated backend"
    kill "$(server_pid)" >/dev/null 2>&1 || true
  fi
  rm -f "${PID_FILE}" "${VITE_PID_FILE}"
}

reset_state() {
  step "Reset UI e2e state"
  destroy || true
  rm -rf "${STATE_ROOT}"
  mkdir -p "${STATE_ROOT}"
  seed_runtime_state
}

setup() {
  reset_state
  build_binaries
  start_server
  seed_backend_resources
  start_frontend
}

usage() {
  cat <<USAGE
Usage: $0 <reset|setup|open|destroy|all>

Commands:
  reset    remove isolated UI e2e state and stop local services
  setup    reset state, build backend binaries, seed data, start backend + Vite
  open     open Electron against the prepared UI e2e services
  destroy  stop the local UI e2e backend and Vite renderer
  all      setup + open Electron
USAGE
}

main() {
  local cmd="${1:-}"
  case "${cmd}" in
    reset) reset_state ;;
    setup) setup ;;
    open) open_electron ;;
    destroy) destroy ;;
    all) setup; open_electron ;;
    *) usage; exit 1 ;;
  esac
}

main "$@"

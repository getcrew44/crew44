#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_ROOT="${CREWAI_API_E2E_ROOT:-/tmp/crewai-api-e2e}"
STATE_DIR="${STATE_ROOT}/state"
RUNTIME_SCAN_DIR="${STATE_ROOT}/runtime-manifests"
BIN_PATH="${STATE_ROOT}/crewai-server"
PID_FILE="${STATE_ROOT}/server.pid"
LOG_FILE="${STATE_ROOT}/server.log"
PORT="${CREWAI_API_E2E_PORT:-18766}"
BASE_URL="http://127.0.0.1:${PORT}"

step() {
  printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$*"
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing command: $1" >&2
    exit 1
  }
}

extract_id() {
  sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -n1
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
  echo "server health check timeout" >&2
  return 1
}

wait_for_chat_idle() {
  local chat_id="$1"
  local retries="${2:-120}"
  local i body
  for ((i=1; i<=retries; i++)); do
    body="$(curl -fsS "${BASE_URL}/api/chat/sessions/${chat_id}")"
    if echo "${body}" | grep -q '"stream":{"status":"idle"'; then
      printf '%s' "${body}" > "${STATE_ROOT}/chat.latest.json"
      return 0
    fi
    sleep 0.1
  done
  echo "chat ${chat_id} did not become idle" >&2
  return 1
}

write_runtime_manifest() {
  cat > "${RUNTIME_SCAN_DIR}/runtime-mock.crewai-runtime.json" <<'JSON'
{"id":"runtime-mock","provider":"mock","name":"Mock Runtime","binary_path":"builtin://mock","version":"test"}
JSON
}

setup() {
  require_cmd curl
  require_cmd go

  destroy || true
  rm -rf "${STATE_ROOT}"
  mkdir -p "${STATE_DIR}" "${RUNTIME_SCAN_DIR}"

  step "Write runtime manifest"
  write_runtime_manifest

  step "Build crewai-server"
  (
    cd "${ROOT_DIR}"
    go build -o "${BIN_PATH}" ./cmd/crewai-server
  )

  step "Start crewai-server"
  CREWAI_STATE_DIR="${STATE_DIR}" \
  CREWAI_RUNTIME_SCAN_DIR="${RUNTIME_SCAN_DIR}" \
  PORT="${PORT}" \
  nohup "${BIN_PATH}" >"${LOG_FILE}" 2>&1 < /dev/null &
  local pid=$!
  disown || true
  echo "${pid}" > "${PID_FILE}"

  wait_for_health 60

  step "Rescan runtimes"
  curl -fsS -X POST "${BASE_URL}/api/runtimes/rescan" > "${STATE_ROOT}/runtimes.json"
}

run_flow() {
  if ! is_server_running; then
    setup
  fi

  step "Create skill"
  curl -fsS -X POST "${BASE_URL}/api/skills" \
    -H 'content-type: application/json' \
    -d '{"name":"Core Skill"}' > "${STATE_ROOT}/skill.json"
  local skill_id
  skill_id="$(extract_id < "${STATE_ROOT}/skill.json")"

  step "Create agents"
  curl -fsS -X POST "${BASE_URL}/api/agents" \
    -H 'content-type: application/json' \
    -d '{"name":"Aria","instruction":"Be helpful","runtime_id":"runtime-mock","model":"mock-1"}' > "${STATE_ROOT}/agent-a.json"
  curl -fsS -X POST "${BASE_URL}/api/agents" \
    -H 'content-type: application/json' \
    -d '{"name":"Bex","instruction":"Take handoffs","runtime_id":"runtime-mock","model":"mock-1"}' > "${STATE_ROOT}/agent-b.json"

  local agent_a_id agent_b_id
  agent_a_id="$(extract_id < "${STATE_ROOT}/agent-a.json")"
  agent_b_id="$(extract_id < "${STATE_ROOT}/agent-b.json")"

  step "Attach skill to agent A"
  curl -fsS -X PUT "${BASE_URL}/api/agents/${agent_a_id}/skills" \
    -H 'content-type: application/json' \
    -d "{\"skill_ids\":[\"${skill_id}\"]}" > /dev/null

  step "Create project and chat"
  curl -fsS -X POST "${BASE_URL}/api/projects" \
    -H 'content-type: application/json' \
    -d "{\"name\":\"API E2E\",\"workdir\":\"/tmp/crewai-api-e2e-project\",\"main_agent_id\":\"${agent_a_id}\"}" > "${STATE_ROOT}/project.json"
  local project_id
  project_id="$(extract_id < "${STATE_ROOT}/project.json")"

  curl -fsS -X POST "${BASE_URL}/api/chat/sessions" \
    -H 'content-type: application/json' \
    -d "{\"project_id\":\"${project_id}\",\"title\":\"API E2E Chat\",\"main_agent_id\":\"${agent_a_id}\"}" > "${STATE_ROOT}/chat.json"
  local chat_id
  chat_id="$(extract_id < "${STATE_ROOT}/chat.json")"

  step "Send first message and wait for idle"
  curl -fsS -X POST "${BASE_URL}/api/chat/sessions/${chat_id}/messages" \
    -H 'content-type: application/json' \
    -d "{\"content\":\"first pass\",\"target_agent_id\":\"${agent_a_id}\"}" > /dev/null
  wait_for_chat_idle "${chat_id}"

  step "Send tool + handoff message"
  curl -fsS -X POST "${BASE_URL}/api/chat/sessions/${chat_id}/messages" \
    -H 'content-type: application/json' \
    -d "{\"content\":\"/slow /tool /handoff:${agent_b_id} second pass\",\"target_agent_id\":\"${agent_a_id}\"}" > /dev/null

  step "Capture SSE replay and follow"
  curl -fsS -N "${BASE_URL}/api/chat/sessions/${chat_id}/events?after=0&follow=1" > "${STATE_ROOT}/events.sse"

  step "Verify chat state and summary"
  curl -fsS "${BASE_URL}/api/chat/sessions/${chat_id}" > "${STATE_ROOT}/chat-after-handoff.json"
  local summary_path="${STATE_DIR}/chats/chat-${chat_id}/summary.md"
  cp "${summary_path}" "${STATE_ROOT}/summary.md"

  grep -q 'event: chat.event' "${STATE_ROOT}/events.sse" || { echo "missing chat.event in sse output" >&2; exit 1; }
  grep -q '"type":"tool_call"' "${STATE_ROOT}/events.sse" || { echo "missing tool_call event in sse output" >&2; exit 1; }
  grep -q 'event: done' "${STATE_ROOT}/events.sse" || { echo "missing done event in sse output" >&2; exit 1; }
  grep -q "\"current_agent_id\":\"${agent_b_id}\"" "${STATE_ROOT}/chat-after-handoff.json" || { echo "handoff did not move current_agent_id to agent B" >&2; exit 1; }
  ! grep -q '<CREWAI_HANDOFF>' "${STATE_ROOT}/summary.md" || { echo "summary should not contain raw handoff marker" >&2; exit 1; }

  step "Exercise missing-runtime conflict"
  rm -f "${RUNTIME_SCAN_DIR}/runtime-mock.crewai-runtime.json"
  curl -fsS -X POST "${BASE_URL}/api/runtimes/rescan" > "${STATE_ROOT}/runtimes-after-remove.json"

  local status
  status="$(
    curl -sS -o "${STATE_ROOT}/missing-runtime-response.json" -w '%{http_code}' \
      -X POST "${BASE_URL}/api/chat/sessions/${chat_id}/messages" \
      -H 'content-type: application/json' \
      -d "{\"content\":\"should fail\",\"target_agent_id\":\"${agent_a_id}\"}"
  )"
  [[ "${status}" == "409" ]] || { echo "expected 409 after runtime removal, got ${status}" >&2; exit 1; }

  step "API e2e completed"
  echo "artifacts: ${STATE_ROOT}"
}

destroy() {
  if is_server_running; then
    step "Stop crewai-server"
    kill "$(server_pid)" >/dev/null 2>&1 || true
    sleep 1
  fi
  rm -f "${PID_FILE}"
}

usage() {
  cat <<USAGE
Usage: $0 <setup|run|destroy|all>

Commands:
  setup    build server, prepare isolated state, start server, rescan runtimes
  run      execute the backend-only API e2e flow
  destroy  stop the local test server
  all      setup + run
USAGE
}

main() {
  local cmd="${1:-}"
  case "${cmd}" in
    setup) setup ;;
    run) run_flow ;;
    destroy) destroy ;;
    all) setup; run_flow ;;
    *) usage; exit 1 ;;
  esac
}

main "$@"

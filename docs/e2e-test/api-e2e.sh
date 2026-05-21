#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/api-e2e-lib.sh"

PROJECT_ID=""
MAIN_AGENT_ID=""
WORKER_AGENT_ID=""
CLAUDE_AGENT_ID=""
SKILL_ID=""
CHAT_RESUME_ID=""
CHAT_HANDOFF_ID=""
CODEX_SESSION_1=""
CODEX_SESSION_2=""
CLAUDE_SESSION_ID=""

setup() {
  reset_state
  build_binaries
  start_server

  step "Rescan runtimes"
  api_post "/api/runtimes/rescan" '{}' "${STATE_ROOT}/runtimes-rescan.json"
}

phase_runtime_inventory() {
  step "Verify runtime inventory"
  api_get "/api/runtimes" "${STATE_ROOT}/runtimes-list.json"
  assert_eq "$(json_len "${STATE_ROOT}/runtimes-list.json" "items")" "2" "runtime count"

  api_get "/api/runtimes/codex" "${STATE_ROOT}/runtime-codex.json"
  api_get "/api/runtimes/claude" "${STATE_ROOT}/runtime-claude.json"

  assert_eq "$(json_get "${STATE_ROOT}/runtime-codex.json" "provider")" "codex" "codex provider"
  assert_eq "$(json_get "${STATE_ROOT}/runtime-codex.json" "status")" "available" "codex status"
  assert_nonempty "$(json_get "${STATE_ROOT}/runtime-codex.json" "binary_path")" "codex binary path should not be empty"
  assert_eq "$(json_get "${STATE_ROOT}/runtime-claude.json" "provider")" "claude" "claude provider"
  assert_eq "$(json_get "${STATE_ROOT}/runtime-claude.json" "status")" "available" "claude status"
  assert_nonempty "$(json_get "${STATE_ROOT}/runtime-claude.json" "binary_path")" "claude binary path should not be empty"

  assert_file_exists "${STATE_DIR}/runtimes.json"
  assert_file_missing "${STATE_DIR}/agents"
  assert_file_missing "${STATE_DIR}/skills"
  assert_file_missing "${STATE_DIR}/projects"
  assert_file_missing "${STATE_DIR}/chats"
}

phase_project_registration() {
  step "Create project before agents and verify persistence"
  api_post "/api/projects" \
    "{\"name\":\"Workspace Project\",\"workdir\":\"${WORK_DIR}\",\"main_agent_id\":\"\"}" \
    "${STATE_ROOT}/project-create.json"
  PROJECT_ID="$(json_get "${STATE_ROOT}/project-create.json" "id")"

  local project_dir="${STATE_DIR}/projects/proj-${PROJECT_ID}"
  assert_file_exists "${STATE_DIR}/projects/registry.jsonl"
  assert_dir_exists "${project_dir}"
  assert_dir_entries_exact "${project_dir}" "chats.jsonl" "project.json"
  assert_file_missing "${STATE_DIR}/chats"

  api_get "/api/projects" "${STATE_ROOT}/projects-list.json"
  assert_eq "$(json_len "${STATE_ROOT}/projects-list.json" "items")" "1" "project list count"
  assert_eq "$(json_get "${STATE_ROOT}/projects-list.json" "items[0].id")" "${PROJECT_ID}" "project list id"
  assert_eq "$(json_get "${STATE_ROOT}/projects-list.json" "items[0].name")" "Workspace Project" "project list name"
  assert_eq "$(json_get "${STATE_ROOT}/projects-list.json" "items[0].workdir")" "${WORK_DIR}" "project list workdir"
  assert_eq "$(json_get "${STATE_ROOT}/projects-list.json" "items[0].main_agent_id")" "" "project list main agent before wiring"

  api_get "/api/projects/${PROJECT_ID}" "${STATE_ROOT}/project-get.json"
  assert_eq "$(json_get "${STATE_ROOT}/project-get.json" "id")" "${PROJECT_ID}" "project get id"
  assert_eq "$(json_get "${STATE_ROOT}/project-get.json" "main_agent_id")" "" "project get main agent before wiring"
}

phase_agent_and_skill_resources() {
  step "Create main agent and verify persistence"
  api_post "/api/agents" \
    '{"name":"Codex Main","instruction":"You are a precise coding assistant. Use tools when you need filesystem facts.","runtime_id":"codex","model":"gpt-5.5"}' \
    "${STATE_ROOT}/agent-main-create.json"
  MAIN_AGENT_ID="$(json_get "${STATE_ROOT}/agent-main-create.json" "id")"

  local agent_dir="${STATE_DIR}/agents/agent-${MAIN_AGENT_ID}"
  assert_dir_exists "${agent_dir}"
  assert_dir_entries_exact "${agent_dir}" "config.json"

  api_get "/api/agents" "${STATE_ROOT}/agents-list-main.json"
  assert_eq "$(json_len "${STATE_ROOT}/agents-list-main.json" "items")" "1" "agent list count after main agent create"
  assert_eq "$(json_get "${STATE_ROOT}/agents-list-main.json" "items[0].id")" "${MAIN_AGENT_ID}" "agent list id after main create"
  assert_eq "$(json_get "${STATE_ROOT}/agents-list-main.json" "items[0].runtime_id")" "codex" "main agent runtime"

  api_get "/api/agents/${MAIN_AGENT_ID}" "${STATE_ROOT}/agent-main-get.json"
  assert_eq "$(json_get "${STATE_ROOT}/agent-main-get.json" "name")" "Codex Main" "agent get name"

  step "Create skill, mutate files, and attach it to the agent"
  api_post "/api/skills" '{"name":"Core Skill"}' "${STATE_ROOT}/skill-create.json"
  SKILL_ID="$(json_get "${STATE_ROOT}/skill-create.json" "id")"

  local skill_dir="${STATE_DIR}/skills/skill-${SKILL_ID}"
  assert_file_exists "${STATE_DIR}/skills/registry.json"
  assert_dir_exists "${skill_dir}"
  assert_dir_entries_exact "${skill_dir}" "SKILL.md"

  api_get "/api/skills" "${STATE_ROOT}/skills-list.json"
  assert_eq "$(json_len "${STATE_ROOT}/skills-list.json" "items")" "1" "skill list count"
  assert_eq "$(json_get "${STATE_ROOT}/skills-list.json" "items[0].id")" "${SKILL_ID}" "skill list id"

  api_get "/api/skills/${SKILL_ID}" "${STATE_ROOT}/skill-get.json"
  assert_eq "$(json_get "${STATE_ROOT}/skill-get.json" "path")" "${skill_dir}" "skill path"

  api_put "/api/skills/${SKILL_ID}" '{"name":"Core Skill Updated"}' "${STATE_ROOT}/skill-update.json"
  assert_eq "$(json_get "${STATE_ROOT}/skill-update.json" "name")" "Core Skill Updated" "skill updated name"

  api_put "/api/skills/${SKILL_ID}/files" '{"file_id":"notes.md","content":"skill-notes\n"}' "${STATE_ROOT}/skill-file-put.json"
  assert_file_exists "${skill_dir}/notes.md"
  assert_contains "${skill_dir}/notes.md" "skill-notes" "notes.md content mismatch"

  api_get "/api/skills/${SKILL_ID}/files" "${STATE_ROOT}/skill-files-list.json"
  assert_eq "$(json_len "${STATE_ROOT}/skill-files-list.json" "items")" "2" "skill file count after adding notes"

  api_delete "/api/skills/${SKILL_ID}/files/notes.md" "${STATE_ROOT}/skill-file-delete.json"
  assert_file_missing "${skill_dir}/notes.md"
  api_get "/api/skills/${SKILL_ID}/files" "${STATE_ROOT}/skill-files-list-after-delete.json"
  assert_eq "$(json_len "${STATE_ROOT}/skill-files-list-after-delete.json" "items")" "1" "skill file count after deleting notes"

  api_put "/api/agents/${MAIN_AGENT_ID}/skills" "{\"skill_ids\":[\"${SKILL_ID}\"]}" "${STATE_ROOT}/agent-main-skills.json"
  assert_eq "$(json_get "${STATE_ROOT}/agent-main-skills.json" "skill_ids[0]")" "${SKILL_ID}" "agent skill binding"

  api_put "/api/projects/${PROJECT_ID}" \
    "{\"name\":\"Workspace Project Ready\",\"workdir\":\"${WORK_DIR}\",\"main_agent_id\":\"${MAIN_AGENT_ID}\"}" \
    "${STATE_ROOT}/project-update.json"
  assert_eq "$(json_get "${STATE_ROOT}/project-update.json" "main_agent_id")" "${MAIN_AGENT_ID}" "project main agent after wiring"
  assert_eq "$(json_get "${STATE_ROOT}/project-update.json" "name")" "Workspace Project Ready" "project updated name"
}

phase_additional_agents() {
  step "Create worker and Claude agents"
  api_post "/api/agents" \
    '{"name":"Codex Worker","instruction":"You are a focused worker. When the summary asks for filesystem changes, use tools and do the work.","runtime_id":"codex","model":"gpt-5.5"}' \
    "${STATE_ROOT}/agent-worker-create.json"
  WORKER_AGENT_ID="$(json_get "${STATE_ROOT}/agent-worker-create.json" "id")"

  api_post "/api/agents" \
    '{"name":"Claude Reviewer","instruction":"You are a careful reviewer. Use tools when you need filesystem facts.","runtime_id":"claude","model":"claude-sonnet-4-6"}' \
    "${STATE_ROOT}/agent-claude-create.json"
  CLAUDE_AGENT_ID="$(json_get "${STATE_ROOT}/agent-claude-create.json" "id")"

  api_get "/api/agents" "${STATE_ROOT}/agents-list-all.json"
  assert_eq "$(json_len "${STATE_ROOT}/agents-list-all.json" "items")" "3" "agent list count after adding worker and claude"

  api_get "/api/agents/${WORKER_AGENT_ID}" "${STATE_ROOT}/agent-worker-get.json"
  api_get "/api/agents/${CLAUDE_AGENT_ID}" "${STATE_ROOT}/agent-claude-get.json"
  assert_eq "$(json_get "${STATE_ROOT}/agent-worker-get.json" "runtime_id")" "codex" "worker agent runtime"
  assert_eq "$(json_get "${STATE_ROOT}/agent-claude-get.json" "runtime_id")" "claude" "claude agent runtime"
}

phase_chat_resources() {
  step "Create chat resource and verify list/get endpoints"
  api_post "/api/chat/sessions" \
    "{\"project_id\":\"${PROJECT_ID}\",\"title\":\"Resume Chat\",\"main_agent_id\":\"${MAIN_AGENT_ID}\"}" \
    "${STATE_ROOT}/chat-resume-create.json"
  CHAT_RESUME_ID="$(json_get "${STATE_ROOT}/chat-resume-create.json" "id")"

  local chat_dir="${STATE_DIR}/chats/chat-${CHAT_RESUME_ID}"
  assert_dir_exists "${chat_dir}"
  assert_dir_entries_exact "${chat_dir}" "events.jsonl" "summary.md"

  api_get "/api/projects/${PROJECT_ID}/chats" "${STATE_ROOT}/project-chats-list-1.json"
  assert_eq "$(json_len "${STATE_ROOT}/project-chats-list-1.json" "items")" "1" "project chats count after first chat"

  api_get "/api/chat/sessions?project_id=${PROJECT_ID}" "${STATE_ROOT}/chat-list-project.json"
  assert_eq "$(json_len "${STATE_ROOT}/chat-list-project.json" "items")" "1" "chat list count with project filter"
  assert_eq "$(json_get "${STATE_ROOT}/chat-list-project.json" "items[0].id")" "${CHAT_RESUME_ID}" "project filtered chat id"

  api_get "/api/chat/sessions" "${STATE_ROOT}/chat-list-global-1.json"
  assert_eq "$(json_len "${STATE_ROOT}/chat-list-global-1.json" "items")" "1" "global chat list count"
  assert_eq "$(json_get "${STATE_ROOT}/chat-list-global-1.json" "items[0].id")" "${CHAT_RESUME_ID}" "global chat list id"

  api_get "/api/chat/sessions/${CHAT_RESUME_ID}" "${STATE_ROOT}/chat-resume-get.json"
  assert_eq "$(json_get "${STATE_ROOT}/chat-resume-get.json" "main_agent_id")" "${MAIN_AGENT_ID}" "chat main agent"
  assert_eq "$(json_get "${STATE_ROOT}/chat-resume-get.json" "current_agent_id")" "${MAIN_AGENT_ID}" "chat current agent at creation"
  assert_eq "$(json_get "${STATE_ROOT}/chat-resume-get.json" "stream.status")" "idle" "chat stream status at creation"

  api_put "/api/chat/sessions/${CHAT_RESUME_ID}" '{"title":"Resume Chat Updated","status":"active"}' "${STATE_ROOT}/chat-resume-update.json"
  assert_eq "$(json_get "${STATE_ROOT}/chat-resume-update.json" "title")" "Resume Chat Updated" "chat updated title"
}

phase_codex_resume() {
  step "Run Codex twice and verify session resume"
  api_post "/api/chat/sessions/${CHAT_RESUME_ID}/messages" \
    "{\"content\":\"Read the file .crew44-e2e-signal.txt from disk using your tools, then reply with the exact file contents and nothing else.\",\"target_agent_id\":\"${MAIN_AGENT_ID}\"}" \
    "${STATE_ROOT}/chat-resume-post-1.json"
  wait_for_chat_idle "${CHAT_RESUME_ID}" 300 "${STATE_ROOT}/chat-resume-after-1.json"
  CODEX_SESSION_1="$(json_get "${STATE_ROOT}/chat-resume-after-1.json" "last_runtime_session.session_id")"
  assert_nonempty "${CODEX_SESSION_1}" "first Codex session id should not be empty"

  api_get "/api/chat/sessions/${CHAT_RESUME_ID}/events?after=0" "${STATE_ROOT}/chat-resume-events-1.json"
  assert_contains "${STATE_DIR}/chats/chat-${CHAT_RESUME_ID}/events.jsonl" '"type":"tool_call"' "first Codex turn should persist a tool_call event"
  assert_contains "${STATE_DIR}/chats/chat-${CHAT_RESUME_ID}/events.jsonl" 'API_E2E_SIGNAL' "first Codex turn should echo sentinel content"

  api_post "/api/chat/sessions/${CHAT_RESUME_ID}/messages" \
    "{\"content\":\"Reply with exact text SECOND_OK and nothing else.\",\"target_agent_id\":\"${MAIN_AGENT_ID}\"}" \
    "${STATE_ROOT}/chat-resume-post-2.json"
  wait_for_chat_idle "${CHAT_RESUME_ID}" 300 "${STATE_ROOT}/chat-resume-after-2.json"
  CODEX_SESSION_2="$(json_get "${STATE_ROOT}/chat-resume-after-2.json" "last_runtime_session.session_id")"
  assert_eq "${CODEX_SESSION_2}" "${CODEX_SESSION_1}" "Codex session resume id"
}

phase_claude_stream() {
  step "Run Claude turn and verify SSE replay/follow"
  api_post "/api/chat/sessions/${CHAT_RESUME_ID}/messages" \
    "{\"content\":\"Read the file .crew44-e2e-signal.txt from disk using your tools, then reply with exact text CLAUDE_OK and nothing else.\",\"target_agent_id\":\"${CLAUDE_AGENT_ID}\"}" \
    "${STATE_ROOT}/chat-claude-post.json"
  curl -fsS -N "${BASE_URL}/api/chat/sessions/${CHAT_RESUME_ID}/events?after=0&follow=1" > "${STATE_ROOT}/chat-claude-events.sse"
  wait_for_chat_idle "${CHAT_RESUME_ID}" 300 "${STATE_ROOT}/chat-claude-after.json"
  CLAUDE_SESSION_ID="$(json_get "${STATE_ROOT}/chat-claude-after.json" "last_runtime_session.session_id")"
  api_get "/api/chat/sessions/${CHAT_RESUME_ID}/events?after=0" "${STATE_ROOT}/chat-resume-events-final.json"

  assert_contains "${STATE_ROOT}/chat-claude-events.sse" 'event: chat.event' "missing chat.event in Claude SSE output"
  assert_contains "${STATE_ROOT}/chat-claude-events.sse" '"type":"tool_call"' "missing tool_call in Claude SSE output"
  assert_contains "${STATE_ROOT}/chat-claude-events.sse" 'CLAUDE_OK' "Claude reply missing from SSE output"
  assert_contains "${STATE_ROOT}/chat-claude-events.sse" 'event: done' "missing done event in Claude SSE output"
  assert_eq "$(json_get "${STATE_ROOT}/chat-claude-after.json" "current_agent_id")" "${CLAUDE_AGENT_ID}" "chat current agent after Claude turn"
  assert_nonempty "${CLAUDE_SESSION_ID}" "Claude session id should not be empty"

  cp "${STATE_DIR}/chats/chat-${CHAT_RESUME_ID}/summary.md" "${STATE_ROOT}/chat-resume-summary.md"
  assert_contains "${STATE_ROOT}/chat-resume-summary.md" 'User: Read the file .crew44-e2e-signal.txt' "summary should include earlier Codex user request"
  assert_contains "${STATE_ROOT}/chat-resume-summary.md" 'Assistant('"${MAIN_AGENT_ID}"'): SECOND_OK' "summary should include the last Codex assistant reply before Claude switch"
}

phase_handoff() {
  step "Create handoff chat and verify downstream file write"
  api_post "/api/chat/sessions" \
    "{\"project_id\":\"${PROJECT_ID}\",\"title\":\"Handoff Chat\",\"main_agent_id\":\"${MAIN_AGENT_ID}\"}" \
    "${STATE_ROOT}/chat-handoff-create.json"
  CHAT_HANDOFF_ID="$(json_get "${STATE_ROOT}/chat-handoff-create.json" "id")"

  api_get "/api/chat/sessions" "${STATE_ROOT}/chat-list-global-2.json"
  assert_eq "$(json_len "${STATE_ROOT}/chat-list-global-2.json" "items")" "2" "global chat list count after handoff chat create"

  local handoff_file="${WORK_DIR}/.crew44-handoff-result.txt"
  rm -f "${handoff_file}"
  api_post "/api/chat/sessions/${CHAT_HANDOFF_ID}/messages" \
    "{\"content\":\"Do not write any files yourself. Reply with exactly two lines. First line: Read .crew44-e2e-signal.txt and then write the file .crew44-handoff-result.txt with exact content HANDOFF_OK. Second line: ^<CREW44_HANDOFF>${WORKER_AGENT_ID}</CREW44_HANDOFF>\",\"target_agent_id\":\"${MAIN_AGENT_ID}\"}" \
    "${STATE_ROOT}/chat-handoff-post.json"
  wait_for_chat_idle "${CHAT_HANDOFF_ID}" 300 "${STATE_ROOT}/chat-handoff-after.json"

  local handoff_events="${STATE_DIR}/chats/chat-${CHAT_HANDOFF_ID}/events.jsonl"
  local handoff_summary="${STATE_DIR}/chats/chat-${CHAT_HANDOFF_ID}/summary.md"
  local handoff_marker_json="\\u003cCREW44_HANDOFF\\u003e${WORKER_AGENT_ID}\\u003c/CREW44_HANDOFF\\u003e"
  assert_file_exists "${handoff_file}"
  assert_contains "${handoff_file}" 'HANDOFF_OK' "handoff worker output file content mismatch"
  assert_eq "$(json_get "${STATE_ROOT}/chat-handoff-after.json" "current_agent_id")" "${WORKER_AGENT_ID}" "handoff chat current agent"
  assert_contains "${handoff_summary}" '.crew44-handoff-result.txt' "handoff summary should keep worker instruction"
  assert_not_contains "${handoff_summary}" '<CREW44_HANDOFF>' "handoff summary should strip marker"

  local handoff_ts handoff_unix file_ctime
  handoff_ts="$(json_line_get "${handoff_events}" "${handoff_marker_json}" "ts")"
  assert_nonempty "${handoff_ts}" "handoff marker missing from persisted events"
  handoff_unix="$(json_time_to_unix "${handoff_ts}")"
  file_ctime="$(stat -f %c "${handoff_file}")"
  [[ "${file_ctime}" -gt "${handoff_unix}" ]] || fail "handoff file ctime should be after handoff marker ts: file=${file_ctime}, handoff=${handoff_unix}"
}

phase_restart_persistence() {
  step "Restart backend and verify persisted state reloads cleanly"
  destroy_server
  start_server

  api_get "/api/runtimes" "${STATE_ROOT}/restart-runtimes.json"
  api_get "/api/projects" "${STATE_ROOT}/restart-projects.json"
  api_get "/api/agents" "${STATE_ROOT}/restart-agents.json"
  api_get "/api/skills" "${STATE_ROOT}/restart-skills.json"
  api_get "/api/chat/sessions" "${STATE_ROOT}/restart-chats.json"
  api_get "/api/chat/sessions?project_id=${PROJECT_ID}" "${STATE_ROOT}/restart-chats-project.json"
  api_get "/api/chat/sessions/${CHAT_RESUME_ID}" "${STATE_ROOT}/restart-chat-resume.json"
  api_get "/api/chat/sessions/${CHAT_HANDOFF_ID}" "${STATE_ROOT}/restart-chat-handoff.json"
  api_get "/api/chat/sessions/${CHAT_RESUME_ID}/events?after=0" "${STATE_ROOT}/restart-chat-resume-events.json"
  api_get "/api/chat/sessions/${CHAT_HANDOFF_ID}/events?after=0" "${STATE_ROOT}/restart-chat-handoff-events.json"

  assert_eq "$(json_len "${STATE_ROOT}/restart-projects.json" "items")" "1" "project count after restart"
  assert_eq "$(json_get "${STATE_ROOT}/restart-projects.json" "items[0].id")" "${PROJECT_ID}" "project id after restart"
  assert_eq "$(json_len "${STATE_ROOT}/restart-agents.json" "items")" "3" "agent count after restart"
  assert_eq "$(json_len "${STATE_ROOT}/restart-skills.json" "items")" "1" "skill count after restart"
  assert_eq "$(json_len "${STATE_ROOT}/restart-chats.json" "items")" "2" "global chat count after restart"
  assert_eq "$(json_len "${STATE_ROOT}/restart-chats-project.json" "items")" "2" "project chat count after restart"
  assert_eq "$(json_get "${STATE_ROOT}/restart-chat-resume.json" "current_agent_id")" "${CLAUDE_AGENT_ID}" "resume chat current agent after restart"
  assert_eq "$(json_get "${STATE_ROOT}/restart-chat-handoff.json" "current_agent_id")" "${WORKER_AGENT_ID}" "handoff chat current agent after restart"
  assert_eq "$(json_get "${STATE_ROOT}/restart-chat-resume.json" "last_runtime_session.session_id")" "${CLAUDE_SESSION_ID}" "resume chat session id after restart"
  assert_eq "$(json_len "${STATE_ROOT}/restart-chat-resume-events.json" "events")" "$(json_len "${STATE_ROOT}/chat-resume-events-final.json" "events")" "restart should preserve resume chat event count"
  assert_nonempty "$(json_line_get "${STATE_DIR}/chats/chat-${CHAT_HANDOFF_ID}/events.jsonl" "\\u003cCREW44_HANDOFF\\u003e${WORKER_AGENT_ID}\\u003c/CREW44_HANDOFF\\u003e" "ts")" "handoff marker should still exist after restart"
}

run_flow() {
  if ! is_server_running; then
    setup
  fi

  phase_runtime_inventory
  phase_project_registration
  phase_agent_and_skill_resources
  phase_additional_agents
  phase_chat_resources
  phase_codex_resume
  phase_claude_stream
  phase_handoff
  phase_restart_persistence

  step "API e2e completed"
  echo "artifacts: ${STATE_ROOT}"
}

usage() {
  cat <<USAGE
Usage: $0 <reset|setup|run|restart|destroy|all>

Commands:
  reset    remove isolated state and stop the local test server
  setup    reset state, build binaries, start server, rescan runtimes
  run      execute the backend-only API e2e flow
  restart  restart the local backend without resetting persisted state
  destroy  stop the local test server
  all      setup + run
USAGE
}

main() {
  local cmd="${1:-}"
  case "${cmd}" in
    reset) reset_state ;;
    setup) setup ;;
    run) run_flow ;;
    restart) destroy_server; start_server ;;
    destroy) destroy_server ;;
    all) setup; run_flow ;;
    *) usage; exit 1 ;;
  esac
}

main "$@"

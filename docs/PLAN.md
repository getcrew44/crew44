# CrewAI 本地版存储与 API 方案

## Summary
- 采用单个本地 Go 进程，同时承担 `HTTP server + runtime 执行器 + chat SSE fanout`。
- 外部产品概念只有 `projects / agents / skills / runtimes / chats`；不暴露 task/subtask。`turn` 只作为 chat 内部运行单元存在，用于串联一次用户消息对应的一次响应链路。
- chat 使用目录式存储：`chat.json + events.jsonl + summary.md`。`events.jsonl` 是唯一时间线真相源；SSE 基于它做回放和 follow。
- 用户消息有独立 `target_agent_id`；mention 仅作 mention，不承担 handoff。agent 若要 handoff，通过消息中的特殊标记 `^<CREWAI_HANDOFF>agent_uuid</CREWAI_HANDOFF>` 触发“当前 turn 结束后自动排队下一次响应”。
- 不记录 token 级 delta，也不推 token 级 SSE；`message/thinking` 只按完整块推送。mention 序列化完全对齐 multica markdown mention 方案。

## Storage
- `~/.crewai/runtimes.json`
  - 当前 runtime inventory 快照，不是 jsonl。
  - 每项至少包含：`id`、`provider`、`name`、`status`、`binary_path`、`version`、`detected_at`、`metadata`。
  - 扫描消失但仍被 agent 引用的 runtime 保留，标记 `status=missing`；未被引用的可直接从快照移除。
- `~/.crewai/agents/agent-<uuid>/config.json`
  - 包含：`id`、`name`、`instruction`、`runtime_id`、`model`、`skill_ids`、`archived_at`、`created_at`、`updated_at`。
- `~/.crewai/skills/registry.json`
  - 维护 skill 索引：`id`、`name`、`path`、`updated_at`、`archived_at`。
- `~/.crewai/skills/skill-<uuid>/`
  - 采用标准 skill 目录结构，直接放 `SKILL.md` 和附属文件。
  - 不记录 `imported_from_runtime_id`，也没有 local-skills/runtime-skills 概念。
- `~/.crewai/projects/registry.jsonl`
  - 记录 project 基本索引：`id`、`name`、`workdir`、`archived_at`。
- `~/.crewai/projects/proj-<uuid>/project.json`
  - 包含：`id`、`name`、`workdir`、`main_agent_id`、`created_at`、`updated_at`、`archived_at`。
- `~/.crewai/projects/proj-<uuid>/chats.jsonl`
  - 只做 project 侧 chat 索引，记录：`chat_id`、`title`、`status`、`current_agent_id`、`updated_at`、`archived_at`。
- `~/.crewai/chats/chat-<uuid>/chat.json`
  - 合并 meta + state，包含：`id`、`project_id`、`title`、`main_agent_id`、`current_agent_id`、`participant_agent_ids`、`status`、`active_turn_id`、`last_runtime_session { agent_id, session_id, updated_at }`、`stream { status, agent_id, started_at, cancel_requested, last_error }`、`created_at`、`updated_at`、`archived_at`。
- `~/.crewai/chats/chat-<uuid>/events.jsonl`
  - append-only 事件流，事件类型仅保留：`message`、`thinking`、`tool_call`、`tool_call_result`。
  - 每条事件至少包含：`seq`、`type`、`ts`、`turn_id`、`actor_agent_id` 以及该类型自己的 payload。
  - 不必冗余 `chat_id`，因为文件路径已限定 chat；保留 `turn_id` 是必要的，用于区分一次响应链路、恢复流状态、处理 handoff 后的下一次自动响应。
- `~/.crewai/chats/chat-<uuid>/summary.md`
  - 不增量维护。
  - 仅在“下一次响应 agent 与 `last_runtime_session.agent_id` 不一致”时，于启动新响应前现算覆盖。
  - summary 保留 user message 和最终 assistant message；去掉 thinking、tool_call、tool_call_result，以及最后一次 tool_call 之前的中间 assistant message。

## Public APIs / Interfaces
- Projects
  - `GET /api/projects`
  - `POST /api/projects`
  - `GET /api/projects/{id}`
  - `PUT /api/projects/{id}`
  - `DELETE /api/projects/{id}`
  - `GET /api/projects/{id}/chats`
- Agents
  - `GET /api/agents`
  - `POST /api/agents`
  - `GET /api/agents/{id}`
  - `PUT /api/agents/{id}`
  - `POST /api/agents/{id}/archive`
  - `POST /api/agents/{id}/restore`
  - `PUT /api/agents/{id}/skills`
  - `PUT /api/agents/{id}` 中允许更新 `runtime_id`、`model`、`instruction`、`name`；skills 不单独做 remove 接口，`PUT /skills` 走整组替换。
- Skills
  - `GET /api/skills`
  - `POST /api/skills`
  - `GET /api/skills/{id}`
  - `PUT /api/skills/{id}`
  - `DELETE /api/skills/{id}`
  - `GET /api/skills/{id}/files`
  - `PUT /api/skills/{id}/files`
  - `DELETE /api/skills/{id}/files/{fileId}`
- Runtimes
  - `GET /api/runtimes`
  - `POST /api/runtimes/rescan`
  - `GET /api/runtimes/{id}`
  - `POST /api/runtimes/{id}/update`
  - 不提供 `models`、`local-skills` 相关 API。
- Chats
  - `POST /api/chat/sessions`
    - 创建 chat，初始 `current_agent_id = main_agent_id`。
  - `GET /api/chat/sessions?project_id={id}`
  - `GET /api/chat/sessions/{id}`
  - `PUT /api/chat/sessions/{id}`
    - 用于改标题、归档状态等轻量 metadata。
  - `DELETE /api/chat/sessions/{id}`
  - `POST /api/chat/sessions/{id}/messages`
    - body 至少包含：`content`、`target_agent_id`。
    - `target_agent_id` 默认由前端决定：主 agent 或“最后一个回复的 agent”。
    - 若当前 chat 正在流式响应，则返回冲突错误，不允许并发未完成响应。
  - `GET /api/chat/sessions/{id}/events?after={seq}&follow=1`
    - `follow=0` 返回从 `after` 之后的 JSON 事件列表。
    - `follow=1` 或 `Accept: text/event-stream` 返回 SSE；先补发 `after` 之后历史，再进入 follow。
  - `POST /api/chat/sessions/{id}/cancel`
    - 取消该 chat 当前未完成响应，不暴露 turn/task 概念。

## Chat / Streaming Behavior
- 消息 mention 格式完全对齐 multica：使用 markdown mention 形式，例如 `[@Aria](mention://agent/<uuid>)`。
- 用户发送消息时：
  - 后端先把原始消息正文按原样落盘为 `message` 事件。
  - 另外在该次内部 turn 上记录 `target_agent_id`，由 runtime 执行时使用；mention 不改变 `target_agent_id`。
- 响应前的 session 选择：
  - 若 `target_agent_id == last_runtime_session.agent_id` 且 session 仍可 resume，则直接复用底层 runtime session。
  - 若 agent 变化，则先重建 `summary.md`，再用“新 agent instruction + summary.md 路径 + 所有可用 agents 列表”启动新 runtime session。
- handoff 规则：
  - agent 输出中若出现 `^<CREWAI_HANDOFF>agent_uuid</CREWAI_HANDOFF>`，服务端在本次响应完成后检查目标 agent 是否有效且可用。
  - 有效则自动排队下一次内部响应，并把 `current_agent_id` 切到该 agent。
  - 该标记不进入 summary；原始消息正文可保留，或在持久化 `message` 事件时额外保存 `handoff_to_agent_id` metadata 供 UI/后端使用。
- SSE 事件传输层只需要：
  - `chat.event`：承载四类业务事件
  - `done`：当前流式响应结束
  - `error`：当前流式响应失败
  - `keepalive`：可选
- 业务事件不做 token 级流式：
  - `message` / `thinking` 只按完整块推送
  - `tool_call` / `tool_call_result` 按一次调用一条事件推送

## Skill Injection / Runtime Integration
- skill 存储采用标准目录结构，并保持与 multica 文件型 skill 的组织方式一致。
- runtime 注入逻辑默认目标：
  - 对支持文件型 skills 的 provider，按 provider 约定把当前 agent 绑定 skills 注入到隔离运行目录中。
  - 初版实现优先复用 multica 已有的文件注入思路；provider 之间的细粒度差异可以标记 TODO，但接口和存储先按标准 skill 目录固定下来。
- 不实现 runtime 内置 skills 列举、导入、展示、管理。

## Test Plan
- Storage
  - 新建 project/agent/skill/chat 后，索引文件与实体文件一致。
  - chat 目录下 `chat.json`、`events.jsonl`、`summary.md` 的创建/覆盖时机正确。
- Runtime
  - rescan 后新 runtime 出现、旧 runtime 丢失、被引用 runtime 标 `missing`、未引用 runtime 被移除。
  - agent 绑定 `missing` runtime 时，发消息返回冲突错误。
- Chat
  - 同一 chat 同时只能有一个未完成响应；并发第二次发送被拒绝。
  - `target_agent_id` 与正文 mention 解耦；正文里 mention 其他 agent 不改变发送对象。
  - 复用同一 agent 时直接 resume `last_runtime_session`。
  - 切换 agent 时重建 `summary.md`，并启动全新 runtime session。
  - agent 输出 handoff 标记后，本次响应结束自动触发下一次响应，并更新 `current_agent_id`。
  - `events?after=` JSON replay 正确；`events?follow=1` 先补历史再流式 follow。
- Summary
  - thinking/tool/tool_result 不进入 summary。
  - 最后一次 tool_call 之前的中间 assistant message 不进入 summary。
  - 无 tool_call 的普通 assistant 最终回复会进入 summary。
- Mention
  - `[@Label](mention://agent/<uuid>)` 能正确解析并保真存储。
  - 复制/重载/summary 过程中 mention 文本不丢失、不误改为发送对象。

## Assumptions / Defaults
- `events.jsonl` 不记录 `chat_id`，但记录 `turn_id`。
- 外部 API 不暴露 turn 资源；turn 只作为内部执行/事件关联字段存在。
- runtime inventory 用 `runtimes.json` 快照，不保留单独历史日志。
- 初版不做 token 级流式，也不做 `messages` 精简视图接口。
- skill 注入到 runtime 的 provider 细节以“能对齐 multica 的先对齐，对不齐的标 TODO”作为默认策略。

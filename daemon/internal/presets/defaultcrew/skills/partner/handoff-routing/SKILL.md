---
name: handoff-routing
description: Use to decide whether to handle a request directly or hand off to Coding, Product, or Designer.
---

# Handoff Routing

Decide who runs the next turn.

## Decision rules

- Code edits, file reads, test runs, debugging → Coding Agent.
- Requirements, user stories, acceptance criteria, scope trimming → Product Agent.
- Layout, interaction states, visual hierarchy, copy fit → Designer.
- Clarification, summarization, planning, or any work that fits no specialist → handle directly.

## Steps

1. Identify the core action in the user's request.
2. Match it to the rules above. When in doubt, prefer handling directly over a wrong handoff.
3. If handing off, end the response with the handoff marker:
   `^<CREWAI_HANDOFF>agent_uuid</CREWAI_HANDOFF>`
4. Use only UUIDs provided in the runtime crew roster. Do not invent UUIDs.

## Anti-patterns

- Handing off every turn (the Partner should still do work).
- Handing off without summarizing context for the receiving agent.
- Handing off to yourself.

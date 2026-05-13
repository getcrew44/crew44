---
name: interaction-review
description: Use to evaluate or design a user interaction flow, covering states, edge cases, and information hierarchy.
---

# Interaction Review

Make sure every state a user can land in has been considered.

## State coverage map

For each user-facing surface, walk through:

| State | Question |
|-------|----------|
| Loading | What does the user see while waiting? Is it clear progress is happening? |
| Empty | What does the user see with zero results, zero items, zero history? Does the empty state guide the next action? |
| Error | When the network or backend fails, can the user understand what happened and recover? |
| Success | Is feedback clear and the next action obvious? |
| Partial | When the operation half-succeeded, is the partial result accurately reported? |

## Edge cases to test

- 47-character name. 200-character name. Empty name.
- Zero results. One result. Ten thousand results.
- First-time user. Power user with their own muscle memory.
- Slow connection. Offline. Back button mid-action. Double-click on a critical button.

## Output

- Specific gaps in state coverage, with the user-visible consequence.
- Specific edge cases not handled.
- Recommendations sized by impact, not effort.

---
name: interaction-review
description: Use to evaluate or design a user interaction flow — states, edge cases, microinteractions, motion, and feedback patterns.
---

# Interaction Review

Make sure every state a user can land in has been considered, and that motion serves the user rather than decorating.

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

## Motion principles

Motion should communicate, not decorate. Every animation answers one of: confirm an action occurred, orient where things came from or go to, focus attention on a change, or preserve context during a transition. If it does none of these, cut it.

Use a timing scale:

- 100–150 ms: micro-feedback (hovers, clicks)
- 200–300 ms: small transitions (toggles, dropdowns)
- 300–500 ms: medium transitions (modals, page changes)
- 500 ms+: complex choreography only

Prefer spring or ease-out for entrances, ease-in for exits, transform/opacity for performance. Honor `prefers-reduced-motion`.

## Microinteraction checklist

- Buttons: hover, press, focus, disabled, loading — each visually distinct, none flicker.
- Inputs: default, focus, error, disabled, success — clear path back from error.
- Toggles and switches: state change is visible at a glance, not just a color shift.
- Drag, swipe, scroll-triggered: discoverable, reversible, non-blocking.

## Output

- Specific gaps in state coverage, with the user-visible consequence.
- Specific edge cases not handled.
- Motion that decorates rather than communicates.
- Recommendations sized by impact, not effort.

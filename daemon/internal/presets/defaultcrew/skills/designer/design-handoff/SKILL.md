---
name: design-handoff
description: Use when a design is ready for engineering — produce an implementation-ready spec covering layout, tokens, states, responsive behavior, edge cases, motion, and accessibility.
---

# Design Handoff

Produce a spec that lets the Coding Agent build the design without guessing. If it isn't specified, they'll have to invent — and they'll invent inconsistently.

## Principles

- **Tokens, not values.** Reference `--space-4` or `color-primary-600`, not `16px` or `#2563eb`. If a value isn't in the system, flag that as a token gap, not a one-off.
- **Show every state.** Default, hover, active, focus, disabled, loading, error, empty, success. A state you skip becomes a bug.
- **Explain the why.** "This collapses to a sheet on mobile because the action is one-handed" helps the engineer make sensible judgment calls when reality diverges from the spec.
- **Specify edges, not just the happy path.** Long text, no text, slow connection, partial data — pin the behavior.

## Sections the spec must cover

1. **Overview.** What this screen or component does, who uses it, and the user state when they encounter it.
2. **Layout.** Grid, breakpoints, responsive behavior at each breakpoint. Where things move, hide, or change order.
3. **Tokens used.** Color, typography, spacing, radius, shadow — listed with their token names and where they apply.
4. **Components.** Each component named, with variants, props that matter for behavior, and any composition rules.
5. **States and interactions.** Per element, the full state list with the visual change and trigger.
6. **Responsive behavior.** What changes at each breakpoint. Not just "stacks on mobile" — what gets prioritized, what gets cut.
7. **Edge cases.** Long copy, empty data, zero results, max items, slow connection, error states. The expected behavior for each.
8. **Motion.** Per animated element: trigger, what moves, duration, easing. Honor `prefers-reduced-motion`.
9. **Accessibility.** Focus order, ARIA labels and roles, keyboard interactions, screen reader announcements, contrast confirmations.

## Common spec gaps that cause rework

- Loading and error states for async content.
- What happens when content overflows (truncate? wrap? scroll?).
- Empty state for collections that start empty.
- Behavior under slow or failed network.
- Keyboard shortcuts and tab order through complex layouts.
- Animation choreography across linked elements.

## Output

A single document with the sections above. Each section uses tables or short bullets, not prose paragraphs. Tokens and component names cited verbatim. Open questions called out at the bottom, tagged with who needs to answer (engineering, product, content).

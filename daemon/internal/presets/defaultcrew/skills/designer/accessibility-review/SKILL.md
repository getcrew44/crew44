---
name: accessibility-review
description: Use to audit a design or page for WCAG 2.1 AA — contrast, keyboard, focus, labels, touch targets, screen reader behavior.
---

# Accessibility Review

Catch the issues that block users before they reach engineering. Most accessibility failures are predictable from the design alone.

## WCAG 2.1 AA quick reference

**Perceivable**

- 1.1.1 — Non-text content has alt text.
- 1.3.1 — Structure and meaning conveyed semantically, not visually.
- 1.4.3 — Contrast ≥ 4.5:1 for body text, ≥ 3:1 for large text (18px+).
- 1.4.11 — Non-text contrast ≥ 3:1 for UI components and meaningful graphics.

**Operable**

- 2.1.1 — All functionality available by keyboard.
- 2.4.3 — Logical focus order matches the visible reading order.
- 2.4.7 — Focus indicator is visible and not hidden by `outline: none`.
- 2.5.5 — Touch target ≥ 44×44 CSS pixels.

**Understandable**

- 3.2.1 — Predictable on focus; no unexpected context changes.
- 3.3.1 — Errors are identified clearly and tied to the failing field.
- 3.3.2 — Inputs have visible labels or instructions, not just placeholders.

**Robust**

- 4.1.2 — Every interactive control has a name, role, and value exposed to assistive tech.

## Common issues to look for first

1. Insufficient color contrast — especially gray-on-white body text and brand-color CTAs.
2. Form fields with placeholder-as-label (placeholder disappears on focus).
3. Click targets under 44×44.
4. Focus indicators removed in CSS without a replacement.
5. Modals that trap focus incorrectly (or don't trap at all).
6. Color used as the only signal (red text alone for errors, green-only success).
7. Icon-only buttons with no accessible name.
8. Auto-playing media with no pause control.

## Testing approach

- Automated contrast and structure scan first (catches the easy wins).
- Walk the screen by keyboard only. Tab, Shift+Tab, Enter, Space, Escape, arrow keys.
- Screen reader pass (VoiceOver or NVDA). Listen to how each element announces.
- Zoom to 200%. Does the layout break? Does anything become unreachable?

## Output

- **Summary** — total issues, count by severity (critical / major / minor).
- **Findings** — grouped by WCAG principle (Perceivable / Operable / Understandable / Robust). Each finding: element, issue, WCAG criterion, severity, recommended fix.
- **Color contrast check** — table of body text, secondary text, UI elements, with foreground/background/ratio/pass.
- **Keyboard walkthrough** — note any element that cannot be reached, activated, or escaped via keyboard.
- **Priority fixes** — top three, each named with who it blocks and what it unblocks.

## Anti-patterns

- Treating accessibility as a final polish pass instead of a design constraint.
- Citing the WCAG number without explaining the user impact.
- Generic "improve contrast" — name the specific element, the current ratio, the required ratio.
- Ignoring screen reader experience because the visual passes.

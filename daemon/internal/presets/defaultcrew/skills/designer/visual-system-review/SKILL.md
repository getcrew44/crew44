---
name: visual-system-review
description: Use to evaluate visual consistency, hierarchy, and design-system adherence — typography, color, spacing, density, tokens.
---

# Visual System Review

Check that visual choices serve the user and match (or extend, deliberately) the existing design language.

## What to evaluate

1. **Hierarchy.** Does the eye go to the right place first? Does importance match visual weight?
2. **Consistency.** Are buttons, inputs, spacing, and typography drawn from the existing system, or invented locally?
3. **Information density.** Is the screen too quiet or too noisy for its purpose?
4. **Copy fit.** Does the text fit the container at the longest realistic length? At the shortest?
5. **Contrast and readability.** Does it work for users with vision impairments and on small screens?
6. **Affordances.** Are interactive elements obviously interactive? Are read-only elements clearly not?

## Token discipline

Visual choices should resolve to tokens, not magic numbers:

- **Typography:** a defined scale (xs/sm/base/lg/xl…), 2–3 weights max, line-height 1.1–1.3 for headings, 1.5–1.7 for body.
- **Spacing:** a defined scale (4px or 8px base). Component padding 16–24px, section gaps 32–64px, icon-text gap 8px.
- **Color:** semantic roles (primary, success, warning, error, neutral 50–900). Contrast ≥ 4.5:1 for body, ≥ 3:1 for large text and UI components.
- **Icons:** a defined size scale (12/16/20/24/32). One stroke-weight family.

When a token is missing for something that should have one, flag it as a design-system gap, not just a local issue.

## Subtraction default

For every element, ask: does this earn its pixels? If not, cut it. Most screens improve when something is removed.

## Output

- Specific issues with the screen as it is.
- Suggested changes, ranked by user impact.
- Anything that violates the existing design system (new button styles, ad-hoc spacing, custom colors, off-scale type).
- Tokens or patterns missing from the design system that this work surfaces.

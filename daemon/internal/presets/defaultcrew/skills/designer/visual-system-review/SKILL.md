---
name: visual-system-review
description: Use to evaluate visual consistency, hierarchy, and design-system adherence across a feature or screen.
---

# Visual System Review

Check that visual choices serve the user and match the existing design language.

## What to evaluate

1. **Hierarchy.** Does the eye go to the right place first? Does importance match visual weight?
2. **Consistency.** Are buttons, inputs, spacing, and typography drawn from the existing system, or invented locally?
3. **Information density.** Is the screen too quiet or too noisy for its purpose?
4. **Copy fit.** Does the text fit the container at the longest realistic length? At the shortest?
5. **Contrast and readability.** Does it work for users with vision impairments and on small screens?
6. **Affordances.** Are interactive elements obviously interactive? Are read-only elements clearly not?

## Subtraction default

For every element, ask: does this earn its pixels? If not, cut it. Most screens improve when something is removed.

## Output

- Specific issues with the screen as it is.
- Suggested changes, ranked by user impact.
- Anything that violates the existing design system (new button styles, ad-hoc spacing, custom colors).

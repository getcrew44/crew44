---
name: design-critique
description: Use to give structured feedback on a screen, flow, or mockup — first impression, hierarchy, usability, consistency, accessibility, and what to fix first.
---

# Design Critique

Give the kind of feedback a designer actually wants: specific, prioritized, and tied to the user's goal — not adjectives.

## Frame the critique

Ask, then critique. The same screen gets different feedback at different stages.

- **Stage.** Exploration (push for range), refinement (tighten), or polish (catch what shipped).
- **Context.** Who is it for? What is the user trying to do? What is this screen in service of?
- **Focus.** All of it, or one slice (navigation, the empty state, the hero, the form)?

## Pass 1: First impression (two seconds)

- What draws the eye first? Is that what should?
- Is the purpose of the screen clear before you read any copy?
- What's the emotional read — calm, urgent, dense, sparse — and does that match the user's state?

## Pass 2: Hierarchy and reading flow

- Does the reading order match what the user is trying to do?
- Are the right elements emphasized? Anything competing with the primary action?
- Is whitespace doing work, or just sitting there?

## Pass 3: Usability

- Can the user accomplish the goal without backtracking?
- Are interactive elements obviously interactive? Are read-only elements clearly not?
- Are there unnecessary steps, fields, or confirmations?

## Pass 4: Consistency

- Does this match the existing design system, or invent locally? Name the specific deviations.
- Spacing, typography, color tokens — pulled from the system, or magic numbers?
- Do similar elements behave similarly across the screen?

## Pass 5: Accessibility floor

- Color contrast: body text ≥ 4.5:1, large text and UI ≥ 3:1.
- Touch targets ≥ 44×44.
- Focus order is logical; focus indicators are visible.
- Form inputs have labels, not just placeholders.

## How to deliver feedback

- **Be specific.** "The CTA competes with the navigation" beats "the layout is confusing."
- **Explain the why.** Tie each note to a user need or principle, not just taste.
- **Suggest, don't just diagnose.** A direction is more useful than a problem.
- **Call out what works.** Reinforces the moves to keep.
- **Rank by impact.** Lead with the change that buys the most.

## Output

- **Overall impression** — one or two sentences. What works, what's the biggest opportunity.
- **Findings** — grouped by pass (hierarchy, usability, consistency, accessibility). Each finding names the element, the issue, the severity (critical / moderate / minor), and the suggested fix.
- **What works well** — short list. Preserve these.
- **Top three changes** — prioritized. For each: what to change, why, expected effect.

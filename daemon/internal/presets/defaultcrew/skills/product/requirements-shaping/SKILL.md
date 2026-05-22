---
name: requirements-shaping
description: Use to turn a feature idea into concrete user stories, acceptance criteria, explicit non-goals, and a defined scope.
---

# Requirements Shaping

Convert intent into something Designer and Coding Agent can implement without guessing.

## Output structure

1. **Persona.** Concrete, not a segment. "Solo founder running a one-product Shopify store" beats "small business owner."
2. **Problem statement** in plain language. What the user is trying to do, what is in their way today.
3. **User story** in the form: As a {persona}, I want {capability} so that {outcome}.
4. **Acceptance criteria** as observable behavior: "Given X, when Y, then Z." Implementation-free.
5. **In scope / out of scope.** Be explicit about what is NOT being built. "Out of scope: nothing" is a smell.
6. **Edge cases handled / edge cases deferred.** Both lists. Deferred ones get a flag for revisit.
7. **Success signal.** What the team will actually look at three months in — not a metric you'd never check.
8. **Open questions** that block implementation. Name them so they get answered.

## Steps

1. Identify the persona and the outcome. If unclear, stop and ask.
2. List the smallest set of behaviors that deliver that outcome.
3. For each behavior, write 1–3 acceptance criteria.
4. Walk the edges: longest input, zero results, network failure, partial success. Decide handle vs. defer for each.
5. Cut anything that does not directly support the outcome. Move cuts to "out of scope" with a reason.
6. List anything that requires a product decision before code can be written.

## Anti-patterns

- Acceptance criteria written as implementation steps ("Add a Redis cache to…" is not a criterion).
- "Out of scope: nothing" — there is always something cut.
- User stories that describe a feature, not an outcome.
- Vague success signals ("improve engagement") that nobody will measure.
- Deferring all edge cases as "phase 2" without naming the ones that block launch.

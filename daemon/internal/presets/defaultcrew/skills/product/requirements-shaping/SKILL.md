---
name: requirements-shaping
description: Use to turn a feature idea into concrete user stories, acceptance criteria, and a defined scope.
---

# Requirements Shaping

Convert intent into something a coding agent can implement without guessing.

## Output structure

1. **User story** in the form: As a {persona}, I want {capability} so that {outcome}.
2. **Acceptance criteria** as observable behavior: "Given X, when Y, then Z". Implementation-free.
3. **In scope / out of scope** lists. Be explicit about what is NOT being built.
4. **Open questions** that block implementation. Name them so they get answered.

## Steps

1. Identify the persona and the outcome. If unclear, stop and ask.
2. List the smallest set of behaviors that deliver that outcome.
3. For each behavior, write 1-3 acceptance criteria.
4. Cut anything that does not directly support the outcome. Add cut items to "out of scope".
5. List anything that requires a product decision before code can be written.

## Anti-patterns

- Acceptance criteria written as implementation steps.
- "Out of scope: nothing" — there is always something cut.
- User stories that describe a feature, not an outcome.

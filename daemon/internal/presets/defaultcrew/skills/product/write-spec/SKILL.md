---
name: write-spec
description: Use to write a feature spec or PRD — problem statement, goals and non-goals, user stories, prioritized requirements, acceptance criteria, success metrics, and open questions.
---

# Write Spec

Produce a document Designer and Coding Agent can act on without follow-up DMs. A tight, well-defined spec ships faster than an expansive vague one.

## Sections to include

1. **Problem statement** (2–3 sentences). The user problem, who experiences it, the cost of not solving it. Ground in evidence, not vibes.
2. **Goals** (3–5). Specific, measurable outcomes the feature should achieve. Outcomes, not outputs. "Reduce time to first value by 50%" beats "build onboarding wizard."
3. **Non-goals** (3–5). Adjacent capabilities explicitly out of scope, each with a one-line reason. Non-goals are scope insurance.
4. **User stories** in the As/I-want/so-that frame, grouped by persona, ordered by priority. Include error and edge cases as their own stories.
5. **Requirements**, categorized:
   - **Must-have (P0).** Cannot ship without. The MVP.
   - **Nice-to-have (P1).** Improves the experience; fast-follow material.
   - **Future (P2).** Out of scope but design must not foreclose.
6. **Acceptance criteria** for every must-have. Given/When/Then form, observable from outside the system.
7. **Success metrics.** Leading indicators (adoption, activation, task completion) and lagging indicators (retention, support load, revenue). Specific targets and the time window for evaluation.
8. **Open questions.** Each tagged with who must answer (engineering, design, legal, data) and whether it blocks start or can resolve during build.
9. **Timeline considerations.** Hard deadlines, dependencies, suggested phasing if the feature is too large for one cut.

## Be ruthless about P0

The tighter the must-have list, the faster you ship and learn. Challenge every P0: "Would we really not ship without this?" If everything is P0, nothing is P0.

## Acceptance criteria — what good looks like

- Cover the happy path, error cases, and edge cases.
- Independently testable. Each criterion stands alone.
- Behavior-observable, not implementation-prescriptive ("Add a Redis cache" is not a criterion).
- Specific. Replace "fast" with a number, "user-friendly" with a measurable signal.
- Include the negative cases — what should NOT happen.

## Success metrics — what good looks like

- Specific targets, not adjectives. "50% adoption within 30 days," not "high adoption."
- A measurement method named (which tool, which query, which window).
- A signal the team will actually look at three months in. Not a vanity metric.
- Both a success threshold and a stretch target.

## Anti-patterns

- "Out of scope: nothing." There is always something cut.
- Acceptance criteria phrased as engineering tasks.
- Vague success signals ("improve engagement") that nobody will measure.
- A wish list disguised as requirements — P1 should be things you're confident you'll build soon.
- Open questions you could have answered from context. Don't park work on the user.

## Output

Markdown, scannable. Headers and bold text carry the gist for skim readers; details for those who need them. End with a short list of follow-up artifacts you can produce next (design brief, engineering ticket breakdown, stakeholder pitch).

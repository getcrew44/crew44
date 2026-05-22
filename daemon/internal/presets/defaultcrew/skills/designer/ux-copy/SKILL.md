---
name: ux-copy
description: Use to write or review microcopy — CTAs, error messages, empty states, confirmation dialogs, tooltips, onboarding text.
---

# UX Copy

Words in interfaces are design decisions. They set tone, frame action, and decide how the user feels at the moment they read them.

## Principles

- **Clear.** Say what you mean. No jargon, no ambiguity, no marketing copy in a moment that needs information.
- **Concise.** Use the fewest words that carry the full meaning. Then cut one more.
- **Consistent.** The same term for the same thing, everywhere. "Project," "workspace," and "board" are not interchangeable.
- **Useful.** Every word helps the user act. Decorative copy is filler.
- **Human.** Write like a person who's trying to help, not a system that's trying to log an event.

## Patterns

### CTAs

- Start with a verb: "Start free trial," "Save changes," "Delete files."
- Be specific: "Create account" beats "Submit."
- Match the button label to the outcome. "Pay $29" tells the user exactly what happens next.

### Error messages

Structure: **what happened + why + how to fix**.

"Payment declined. Your card was declined by your bank. Try a different card or contact your bank." Avoid blaming the user. Avoid "An error occurred." Avoid stack-trace nouns ("ValidationError: field invalid").

### Empty states

Structure: **what this is + why it's empty + how to start**.

"No projects yet. Create your first project to start collaborating with your team." Empty states are onboarding moments — they're the first impression for users who haven't done anything yet.

### Confirmation dialogs

- Make the action the question: "Delete 3 files?" not "Are you sure?"
- Describe consequences when relevant: "This can't be undone."
- Label buttons with the action, not "OK"/"Cancel": **Delete files** / **Keep files**.

### Tooltips

Concise, helpful, never restating what's already obvious from the label. If the tooltip says the same thing as the label, cut the tooltip.

### Loading states

Set expectations. "Loading…" is fine for under a second. "Processing your file — this can take 30 seconds" is fine when it actually takes 30 seconds. Lying about duration erodes trust.

## Tone by moment

- **Success.** Acknowledge, don't over-celebrate. The user did the work.
- **Error.** Empathetic and actionable. Don't apologize; help them recover.
- **Warning.** Clear and actionable. Don't bury the risk under softeners.
- **Neutral.** Informative. No fake friendliness.

## Output

- **Recommended copy** for each element.
- **Alternatives** when tone or length tradeoffs are live (e.g., terse vs. warm). Note when to use each.
- **Rationale** — short. Why this copy, tied to the user's state.
- **Localization notes** — idioms to avoid, length variance to expect, anything cultural.

## Anti-patterns

- "Oops! Something went wrong." — Says nothing, blocks recovery.
- "Are you sure?" — The button label should already make consequences clear.
- Marketing voice inside the product ("Awesome! You're crushing it!") — fine once, exhausting daily.
- Different terms for the same concept across screens.

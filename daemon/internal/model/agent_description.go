package model

import (
	"regexp"
	"strings"
	"unicode"
)

// agentDescriptionMaxLen caps the rendered description length. Long descriptions
// dilute the routing signal in the system prompt and create unwieldy UI cards.
const agentDescriptionMaxLen = 240

// EffectiveAgentDescription returns the description to display or inject for
// the agent. It prefers an author-supplied Description; when empty, it derives
// one from the instruction's role + responsibility clauses.
//
// Callers that need a stored value should write the result back to
// AgentConfig.Description; callers that only render can call this without
// mutating state.
func EffectiveAgentDescription(agent AgentConfig) string {
	if d := strings.TrimSpace(agent.Description); d != "" {
		return collapseSpaces(truncateRune(d, agentDescriptionMaxLen))
	}
	return DeriveAgentDescription(agent.Instruction)
}

// DeriveAgentDescription distills an agent instruction into a short "role +
// responsibility" summary. The crew's preset instructions follow a "You are
// X… Your job is to Y…" pattern; this function extracts the role and the
// responsibility separately so the derived description names both concepts
// explicitly. Instructions that don't match the pattern fall back to their
// first non-empty paragraph.
//
// Returns "" for empty input.
func DeriveAgentDescription(instruction string) string {
	instruction = strings.TrimSpace(instruction)
	if instruction == "" {
		return ""
	}
	role := extractAgentRole(instruction)
	responsibility := extractAgentResponsibility(instruction)
	summary := composeRoleAndResponsibility(role, responsibility)
	if summary == "" {
		summary = firstNonEmptyParagraph(instruction)
	}
	summary = collapseSpaces(summary)
	return truncateRune(summary, agentDescriptionMaxLen)
}

// roleRE matches the role declaration ("You are an expert engineer.",
// "You are the Partner: the default conversation partner.") on a line of its
// own. The optional article (an/a/the) is consumed so it does not leak into
// the captured noun phrase.
var roleRE = regexp.MustCompile(`(?mi)^You are (?:an? |the )?(.+?)\.`)

// responsibilityRE matches the responsibility declaration ("Your job is to …",
// and the "responsibility" / "role" synonyms). The captured group keeps the
// infinitive predicate without the leading "to", which the composer re-adds
// so the output reads grammatically after the "Responsibility:" label.
var responsibilityRE = regexp.MustCompile(`(?mi)^Your (?:job|responsibility|role) is to (.+?)\.`)

// extractAgentRole returns the noun phrase that follows "You are …" at the
// start of a line. If the phrase contains a colon (e.g. "the Partner: the
// default conversation partner and orchestrator"), only the part after the
// colon is kept so the description names the role rather than the agent.
func extractAgentRole(instruction string) string {
	m := roleRE.FindStringSubmatch(instruction)
	if len(m) < 2 {
		return ""
	}
	role := strings.TrimSpace(m[1])
	if i := strings.Index(role, ":"); i >= 0 {
		role = strings.TrimSpace(role[i+1:])
	}
	return role
}

// extractAgentResponsibility returns the infinitive predicate that follows
// "Your job is to …" (or its "responsibility"/"role" synonyms).
func extractAgentResponsibility(instruction string) string {
	m := responsibilityRE.FindStringSubmatch(instruction)
	if len(m) < 2 {
		return ""
	}
	return strings.TrimSpace(m[1])
}

// composeRoleAndResponsibility formats the extracted clauses into a single
// "Role: X. Responsibility: to Y." sentence pair. Either side may be empty;
// the helper returns "" only when both are.
func composeRoleAndResponsibility(role, responsibility string) string {
	var parts []string
	if role != "" {
		parts = append(parts, "Role: "+role+".")
	}
	if responsibility != "" {
		parts = append(parts, "Responsibility: to "+responsibility+".")
	}
	return strings.Join(parts, " ")
}

func firstNonEmptyParagraph(instruction string) string {
	for _, p := range strings.Split(instruction, "\n\n") {
		if t := strings.TrimSpace(p); t != "" {
			return t
		}
	}
	return ""
}

func collapseSpaces(s string) string {
	return strings.Join(strings.Fields(s), " ")
}

// truncateRune trims a string to at most max runes, appending "…" when cut.
func truncateRune(s string, max int) string {
	runes := []rune(s)
	if len(runes) <= max {
		return s
	}
	cut := strings.TrimRightFunc(string(runes[:max]), unicode.IsSpace)
	return cut + "…"
}

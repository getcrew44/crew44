package optimizer

import (
	"errors"
	"regexp"
	"strings"
)

// safeIDPattern is the allowlist for LLM-emitted strings used in filesystem paths.
// UUIDs, slugs, and timestamp-ish strings all pass; path separators and `..` do not.
var safeIDPattern = regexp.MustCompile(`^[a-zA-Z0-9._-]+$`)

const safeIDMaxLen = 128

var errUnsafeID = errors.New("optimizer: id contains unsafe characters")

// safeID validates an identifier that will be joined into a filesystem path.
// LLM output and edited-preview fields flow through accept handlers into
// os.WriteFile / filepath.Join; without this guard a crafted `..` segment
// escapes the optimizer/applied or projects/proj-<id> sandbox.
func safeID(s string) (string, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return "", errors.New("optimizer: id is empty")
	}
	if len(s) > safeIDMaxLen {
		return "", errUnsafeID
	}
	if s == "." || s == ".." || strings.Contains(s, "..") {
		return "", errUnsafeID
	}
	if !safeIDPattern.MatchString(s) {
		return "", errUnsafeID
	}
	return s, nil
}

// Per-suggestion length caps. Anything over these limits is truncated rather
// than rejecting the whole suggestion, since one bad item shouldn't kill the
// scan (see ingestSuggestions doc).
const (
	maxTitleLen     = 240
	maxImpactLen    = 480
	maxBodyLen      = 4096
	maxMemoryText   = 1024
	maxPreviewLines = 256
	maxPreviewLine  = 512
	maxEvidenceLen  = 64
	maxEvidenceItem = 240
)

// clamp shortens s to at most max bytes with a "..." marker. Marker is ASCII
// (3 bytes) so callers can rely on len(clamp(s, n)) <= n exactly. Bounded
// fields are user-visible; truncation is preferable to drop.
func clamp(s string, max int) string {
	if len(s) <= max {
		return s
	}
	if max <= 3 {
		return s[:max]
	}
	return s[:max-3] + "..."
}

// clampLines bounds both the slice length and per-line length so a single
// runaway suggestion can't blow up the system prompt or applied markdown.
func clampLines(lines []string) []string {
	if len(lines) > maxPreviewLines {
		lines = lines[:maxPreviewLines]
	}
	out := make([]string, len(lines))
	for i, ln := range lines {
		out[i] = clamp(ln, maxPreviewLine)
	}
	return out
}

func clampEvidence(items []string) []string {
	if len(items) > maxEvidenceLen {
		items = items[:maxEvidenceLen]
	}
	out := make([]string, len(items))
	for i, it := range items {
		out[i] = clamp(it, maxEvidenceItem)
	}
	return out
}

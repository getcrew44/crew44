package schema

import (
	"path"
	"strings"
)

// MatchPayloadGlob reports whether a slash-separated, repo-root-relative
// path matches a gitignore-style pattern from a Payload.Include or
// Payload.Exclude entry.
//
// Supported syntax:
//   - `**` matches zero or more path segments (including across `/`).
//   - `*` matches any sequence of characters within a single path segment.
//   - `?` matches any single non-`/` character.
//   - Literal text matches literally.
//
// Patterns are always anchored to the repo root. A trailing `/**` makes
// the pattern match the directory itself plus everything below it.
// Negation (`!`) and gitignore's "match anywhere" implicit behavior are
// intentionally not supported in v1.1; see ResolvePayload + ensureSafeGlob.
func MatchPayloadGlob(pattern, candidate string) bool {
	pattern = strings.TrimPrefix(pattern, "./")
	candidate = strings.TrimPrefix(candidate, "./")
	if pattern == candidate {
		return true
	}
	// Convenience: "foo/**" should also match the bare "foo" directory
	// itself so an Include of "upstream/**" lets the extractor preserve
	// an empty upstream dir if one ever surfaced. The "/**" suffix and
	// the literal segment match are otherwise independent.
	if strings.HasSuffix(pattern, "/**") {
		prefix := strings.TrimSuffix(pattern, "/**")
		if candidate == prefix || strings.HasPrefix(candidate, prefix+"/") {
			return true
		}
	}
	return globMatchSegments(splitGlobSegments(pattern), splitGlobSegments(candidate))
}

func splitGlobSegments(p string) []string {
	if p == "" {
		return nil
	}
	return strings.Split(p, "/")
}

// globMatchSegments is the segment-level engine: walks the pattern
// segments against the candidate segments, expanding `**` to a
// variable-length wildcard. Each non-`**` segment is matched with
// path.Match so `*`, `?`, and character classes work the way callers
// expect from filepath.Match.
func globMatchSegments(pattern, candidate []string) bool {
	for i := 0; i < len(pattern); i++ {
		seg := pattern[i]
		if seg == "**" {
			// Skip consecutive **s.
			for i+1 < len(pattern) && pattern[i+1] == "**" {
				i++
			}
			if i == len(pattern)-1 {
				return true
			}
			rest := pattern[i+1:]
			for j := 0; j <= len(candidate); j++ {
				if globMatchSegments(rest, candidate[j:]) {
					return true
				}
			}
			return false
		}
		if len(candidate) == 0 {
			return false
		}
		ok, err := path.Match(seg, candidate[0])
		if err != nil || !ok {
			return false
		}
		candidate = candidate[1:]
	}
	return len(candidate) == 0
}

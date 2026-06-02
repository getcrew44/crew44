package recruit

import "github.com/getcrew44/crew44/daemon/recruit/schema"

// includes returns true when at least one pattern matches candidate. An
// empty patterns list matches nothing; callers supply a default include
// set when the manifest omits Payload. The matcher itself is the public
// schema.MatchPayloadGlob so the installer and the importer share one
// gitignore-style glob implementation.
func includes(patterns []string, candidate string) bool {
	for _, p := range patterns {
		if schema.MatchPayloadGlob(p, candidate) {
			return true
		}
	}
	return false
}

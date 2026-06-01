package schema

import "errors"

// Sentinels returned by the manifest validation and repo-parse helpers.
// The daemon re-exports these (see internal/recruit) so the RPC layer can
// map failures to user-facing toasts without string-matching, and the
// importer surfaces them when a generated manifest would be rejected.
var (
	ErrManifestInvalid = errors.New("recruit: invalid manifest")
	ErrUnsafePath      = errors.New("recruit: unsafe path in manifest")
	ErrRepoURLInvalid  = errors.New("recruit: invalid repo url")
)

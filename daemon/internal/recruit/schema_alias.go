package recruit

import "github.com/getcrew44/crew44/daemon/recruit/schema"

// The Crew44 agent-package format lives in the public recruit/schema
// package so out-of-tree tooling (the recruit-packager repo) can import
// it without depending on the daemon runtime. These aliases re-export the
// contract under the recruit package so existing daemon call sites
// (recruit.Manifest, recruit.ErrManifestInvalid, recruit.ResolvePayload, …)
// keep working against a single source of truth.
type (
	Manifest        = schema.Manifest
	SkillDecl       = schema.SkillDecl
	UpstreamMeta    = schema.UpstreamMeta
	PayloadSpec     = schema.PayloadSpec
	ResolvedPayload = schema.ResolvedPayload
)

const (
	UpstreamPathDefault       = schema.UpstreamPathDefault
	EntrypointFile            = schema.EntrypointFile
	SourceTypeNative          = schema.SourceTypeNative
	SourceTypeUpstreamWrapper = schema.SourceTypeUpstreamWrapper
)

// Manifest/path validation sentinels are defined in the schema package;
// re-export the same values so errors.Is keeps matching across both.
var (
	ErrManifestInvalid = schema.ErrManifestInvalid
	ErrUnsafePath      = schema.ErrUnsafePath
	ErrRepoURLInvalid  = schema.ErrRepoURLInvalid
)

// ResolvePayload returns the include/exclude globs the installer applies
// for a manifest. Thin pass-through to schema.ResolvePayload.
func ResolvePayload(m *Manifest) ResolvedPayload { return schema.ResolvePayload(m) }

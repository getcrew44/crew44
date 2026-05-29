package recruit

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"path"
	"strings"
	"sync"
	"time"
)

// Defaults for the production wire-up. Tests override RawBase to point at
// an httptest server.
const (
	DefaultRawBase      = "https://raw.githubusercontent.com"
	DefaultRegistryRepo = "getcrew44/agent-registry"
	DefaultRegistryFile = "agents.json"
	DefaultRegistryRef  = "HEAD"
	DefaultCacheTTL     = 10 * time.Minute
)

// Cap manifest and agent body sizes so a malicious entry can't exhaust
// memory. AGENT.md is the only large file we read; 2MB is generous for
// markdown prose.
const (
	maxJSONBytes = 256 * 1024
	maxBodyBytes = 2 * 1024 * 1024
)

// Sentinels returned by the client so the RPC layer can map errors to
// user-facing toasts without string-matching.
var (
	ErrTagNotFound     = errors.New("recruit: release tag not found")
	ErrManifestInvalid = errors.New("recruit: invalid manifest")
	ErrRegistryInvalid = errors.New("recruit: invalid registry")
	ErrUnsafePath      = errors.New("recruit: unsafe path in manifest")
	ErrVersionMismatch = errors.New("recruit: tag manifest version disagrees with requested version")
	ErrRepoURLInvalid  = errors.New("recruit: invalid repo url")
)

// Config is the externally-tunable knobs for Client. All fields are
// optional; zero-value Config uses production defaults.
type Config struct {
	HTTPClient   *http.Client
	RawBase      string
	CodeloadBase string
	RegistryRepo string
	RegistryFile string
	RegistryRef  string
	CacheTTL     time.Duration
}

// Client fetches the registry and per-repo manifests/files from raw
// GitHub URLs. It caches the parsed registry in memory; per-repo reads
// are not cached because they're already gated on a user click.
type Client struct {
	http         *http.Client
	rawBase      string
	codeloadBase string
	registryRepo string
	registryFile string
	registryRef  string
	cacheTTL     time.Duration

	mu       sync.Mutex
	cached   *RegistryEnvelope
	cachedAt time.Time
}

func NewClient(cfg Config) *Client {
	c := &Client{
		http:         cfg.HTTPClient,
		rawBase:      cfg.RawBase,
		codeloadBase: cfg.CodeloadBase,
		registryRepo: cfg.RegistryRepo,
		registryFile: cfg.RegistryFile,
		registryRef:  cfg.RegistryRef,
		cacheTTL:     cfg.CacheTTL,
	}
	if c.http == nil {
		c.http = &http.Client{Timeout: 15 * time.Second}
	}
	if c.rawBase == "" {
		c.rawBase = DefaultRawBase
	}
	if c.registryRepo == "" {
		c.registryRepo = DefaultRegistryRepo
	}
	if c.registryFile == "" {
		c.registryFile = DefaultRegistryFile
	}
	if c.registryRef == "" {
		c.registryRef = DefaultRegistryRef
	}
	if c.cacheTTL == 0 {
		c.cacheTTL = DefaultCacheTTL
	}
	return c
}

// FetchRegistry returns the parsed agents.json. Within the cache TTL it
// returns the in-memory copy. On a fetch error, if a previously-cached
// copy exists, it is returned with no error (stale-on-error fallback).
func (c *Client) FetchRegistry(ctx context.Context) (*RegistryEnvelope, error) {
	c.mu.Lock()
	if c.cached != nil && time.Since(c.cachedAt) < c.cacheTTL {
		out := c.cached
		c.mu.Unlock()
		return out, nil
	}
	c.mu.Unlock()

	url := fmt.Sprintf(
		"%s/%s/%s/%s",
		strings.TrimRight(c.rawBase, "/"),
		c.registryRepo,
		c.registryRef,
		c.registryFile,
	)
	body, err := c.getBytes(ctx, url, maxJSONBytes)
	if err != nil {
		c.mu.Lock()
		stale := c.cached
		c.mu.Unlock()
		if stale != nil {
			return stale, nil
		}
		return nil, err
	}

	var env RegistryEnvelope
	if err := json.Unmarshal(body, &env); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrRegistryInvalid, err)
	}

	// Drop malformed rows rather than fail the whole list. A single
	// broken entry from a community contributor must not blank out
	// the Recruit surface for every user.
	kept := env.Agents[:0]
	for _, entry := range env.Agents {
		if !validRegistryEntry(&entry) {
			log.Printf("recruit: dropping malformed registry entry id=%q name=%q repo=%q",
				entry.ID, entry.Name, entry.RepoURL)
			continue
		}
		kept = append(kept, entry)
	}
	env.Agents = kept

	c.mu.Lock()
	c.cached = &env
	c.cachedAt = time.Now()
	c.mu.Unlock()
	return &env, nil
}

// InvalidateRegistry drops the cached registry, forcing the next call to
// re-fetch. Used by tests; not currently exposed via RPC.
func (c *Client) InvalidateRegistry() {
	c.mu.Lock()
	c.cached = nil
	c.cachedAt = time.Time{}
	c.mu.Unlock()
}

// FetchManifest reads crew44-agent.json from the repo's default branch
// (ref = HEAD). Used to learn the latest published version before
// install pins to a tag.
func (c *Client) FetchManifest(ctx context.Context, repoURL string) (Manifest, repoCoord, error) {
	coord, err := parseGitHubRepo(repoURL)
	if err != nil {
		return Manifest{}, coord, err
	}
	url := rawFileURL(c.rawBase, coord, DefaultRegistryRef, "crew44-agent.json")
	body, err := c.getBytes(ctx, url, maxJSONBytes)
	if err != nil {
		return Manifest{}, coord, err
	}
	var m Manifest
	if err := json.Unmarshal(body, &m); err != nil {
		return Manifest{}, coord, fmt.Errorf("%w: %v", ErrManifestInvalid, err)
	}
	if err := validateManifest(&m); err != nil {
		return Manifest{}, coord, err
	}
	return m, coord, nil
}

// FetchAtRef reads a file from a pinned ref (tag). Used during install
// after manifest version has been resolved to a real tag. Returns
// ErrTagNotFound if the underlying GET 404s, so callers can produce the
// "author hasn't published release vX" error.
func (c *Client) FetchAtRef(ctx context.Context, coord repoCoord, ref, filePath string) (string, error) {
	url := rawFileURL(c.rawBase, coord, ref, filePath)
	body, err := c.getBytes(ctx, url, maxBodyBytes)
	if err != nil {
		return "", err
	}
	return string(body), nil
}

// ResolveTag picks the first candidate ref (vX or X) whose
// crew44-agent.json exists AND declares a matching version, so a
// force-pushed tag carrying a divergent manifest is rejected rather
// than silently installed. Returns ErrTagNotFound when no candidate
// ref exists, and ErrVersionMismatch when a ref exists but its
// manifest version disagrees with the requested version.
func (c *Client) ResolveTag(ctx context.Context, coord repoCoord, version string) (string, Manifest, error) {
	candidates := candidateRefs(version)
	if len(candidates) == 0 {
		return "", Manifest{}, fmt.Errorf("%w: empty version", ErrManifestInvalid)
	}
	var lastErr error
	var mismatch *versionMismatchInfo
	for _, ref := range candidates {
		body, err := c.getBytes(ctx, rawFileURL(c.rawBase, coord, ref, "crew44-agent.json"), maxJSONBytes)
		if err != nil {
			lastErr = err
			continue
		}
		var m Manifest
		if err := json.Unmarshal(body, &m); err != nil {
			return "", Manifest{}, fmt.Errorf("%w: %v", ErrManifestInvalid, err)
		}
		if err := validateManifest(&m); err != nil {
			return "", Manifest{}, err
		}
		if !versionMatches(m.Version, version) {
			// Record the first mismatch but keep trying — the other
			// candidate ref might be correct.
			if mismatch == nil {
				mismatch = &versionMismatchInfo{ref: ref, gotVersion: m.Version}
			}
			continue
		}
		return ref, m, nil
	}
	if mismatch != nil {
		return "", Manifest{}, fmt.Errorf("%w: tag %s declares version %q, expected %q",
			ErrVersionMismatch, mismatch.ref, mismatch.gotVersion, version)
	}
	if errors.Is(lastErr, ErrTagNotFound) {
		return "", Manifest{}, ErrTagNotFound
	}
	return "", Manifest{}, ErrTagNotFound
}

type versionMismatchInfo struct {
	ref        string
	gotVersion string
}

// versionMatches compares two version strings allowing the same
// v-prefix tolerance the tag resolver uses elsewhere. "1.2.0",
// "v1.2.0", and " v1.2.0 " are all considered equivalent.
func versionMatches(a, b string) bool {
	return strings.TrimPrefix(strings.TrimSpace(a), "v") == strings.TrimPrefix(strings.TrimSpace(b), "v")
}

// getBytes performs a single GET and reads up to limit bytes. 404 is
// surfaced as ErrTagNotFound so the install path can format a clear
// "release not published" message; everything else returns a wrapped
// error with the URL for diagnostics.
func (c *Client) getBytes(ctx context.Context, url string, limit int64) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("recruit: fetch %s: %w", url, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return nil, ErrTagNotFound
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("recruit: fetch %s: status %d", url, resp.StatusCode)
	}
	return io.ReadAll(io.LimitReader(resp.Body, limit+1))
}

// manifestSchemaPrefix gates which schema_version values the install
// path accepts. Anything outside the v1 family is rejected so an author
// experimenting with a v2 layout can't accidentally install on a daemon
// that doesn't understand the new fields.
const manifestSchemaPrefix = "crew44.agent.v1"

// validateManifest enforces the required fields and rejects unsafe skill
// paths. Done at parse time so the install path can assume a well-formed
// manifest.
func validateManifest(m *Manifest) error {
	if strings.TrimSpace(m.SchemaVersion) == "" {
		return fmt.Errorf("%w: missing schema_version", ErrManifestInvalid)
	}
	if m.SchemaVersion != manifestSchemaPrefix {
		return fmt.Errorf("%w: unsupported schema_version %q", ErrManifestInvalid, m.SchemaVersion)
	}
	if strings.TrimSpace(m.Name) == "" {
		return fmt.Errorf("%w: missing name", ErrManifestInvalid)
	}
	if strings.TrimSpace(m.Version) == "" {
		return fmt.Errorf("%w: missing version", ErrManifestInvalid)
	}
	if strings.TrimSpace(m.Description) == "" {
		return fmt.Errorf("%w: missing description", ErrManifestInvalid)
	}
	for i, sd := range m.Skills {
		if strings.TrimSpace(sd.Name) == "" {
			return fmt.Errorf("%w: skill %d missing name", ErrManifestInvalid, i)
		}
		if err := ensureSafePath(sd.Path); err != nil {
			return err
		}
		if !strings.HasSuffix(sd.Path, "SKILL.md") {
			return fmt.Errorf("%w: skill %d path must end with SKILL.md (got %q)", ErrManifestInvalid, i, sd.Path)
		}
	}
	if m.SourceType == SourceTypeUpstreamWrapper {
		if m.Upstream == nil || strings.TrimSpace(m.Upstream.RepoURL) == "" {
			return fmt.Errorf("%w: source_type=%q requires upstream.repo_url", ErrManifestInvalid, m.SourceType)
		}
	}
	if m.Upstream != nil && strings.TrimSpace(m.Upstream.Path) != "" {
		if err := ensureSafePath(m.Upstream.Path); err != nil {
			return err
		}
	}
	if m.Payload != nil {
		for _, p := range m.Payload.Include {
			if err := ensureSafeGlob(p); err != nil {
				return err
			}
		}
		for _, p := range m.Payload.Exclude {
			if err := ensureSafeGlob(p); err != nil {
				return err
			}
		}
	}
	return nil
}

// ensureSafeGlob applies the same anti-traversal checks as ensureSafePath
// but tolerates the gitignore-style glob characters (`*`, `**`, `?`) the
// manifest payload spec accepts.
func ensureSafeGlob(p string) error {
	if strings.TrimSpace(p) == "" {
		return fmt.Errorf("%w: empty payload glob", ErrManifestInvalid)
	}
	if strings.HasPrefix(p, "/") {
		return fmt.Errorf("%w: %s", ErrUnsafePath, p)
	}
	if strings.HasPrefix(p, "!") {
		return fmt.Errorf("%w: gitignore-negation globs are not supported in v1.1 (%q)", ErrManifestInvalid, p)
	}
	// path.Clean would collapse `**`, so reject `..` segments by walking
	// the path manually.
	for _, seg := range strings.Split(p, "/") {
		if seg == ".." {
			return fmt.Errorf("%w: %s", ErrUnsafePath, p)
		}
	}
	return nil
}

// ResolvedPayload is what the install flow uses after manifest parsing:
// a concrete list of include/exclude globs that already account for the
// "no payload block ⇒ sensible default" fallback described in the plan.
type ResolvedPayload struct {
	Include []string
	Exclude []string
}

// ResolvePayload returns the include/exclude globs the installer should
// apply for this manifest. When the manifest omits a Payload block, the
// default is AGENT.md, crew44-agent.json, every declared skills[].path,
// and — when an upstream block is present — `{upstream.path}/**`. The
// default applies to both native and wrapper repos; an explicit Payload
// block in the manifest is used as-is.
func ResolvePayload(m *Manifest) ResolvedPayload {
	if m.Payload != nil && (len(m.Payload.Include) > 0 || len(m.Payload.Exclude) > 0) {
		out := ResolvedPayload{
			Include: append([]string(nil), m.Payload.Include...),
			Exclude: append([]string(nil), m.Payload.Exclude...),
		}
		if len(out.Include) == 0 {
			out.Include = defaultIncludes(m)
		}
		return out
	}
	return ResolvedPayload{Include: defaultIncludes(m)}
}

func defaultIncludes(m *Manifest) []string {
	out := []string{"AGENT.md", "crew44-agent.json"}
	for _, s := range m.Skills {
		out = append(out, s.Path)
	}
	if m.Upstream != nil {
		p := strings.TrimSpace(m.Upstream.Path)
		if p == "" {
			p = UpstreamPathDefault
		}
		out = append(out, p+"/**")
	}
	return out
}

// validRegistryEntry returns true when the row has all the fields the
// UI and install path actually need. Malformed rows are dropped from
// the list with a log; a single bad entry shouldn't take down the
// whole Recruit surface.
func validRegistryEntry(e *RegistryEntry) bool {
	return strings.TrimSpace(e.ID) != "" &&
		strings.TrimSpace(e.Name) != "" &&
		strings.TrimSpace(e.Description) != "" &&
		strings.TrimSpace(e.RepoURL) != ""
}

// ValidateManifestForImporter is the exported entry point the importer
// uses to confirm a generated manifest passes the same checks the
// installer applies on the user side. Kept separate from validateManifest
// only because the latter is unexported by design; the rules are
// identical so a published wrapper repo cannot trip the installer with
// a manifest the importer accepted.
func ValidateManifestForImporter(m *Manifest) error {
	return validateManifest(m)
}

// MatchPayloadGlobForImporter exposes the gitignore-style glob matcher
// to the importer so it can report which files the install would copy
// without duplicating the matching logic.
func MatchPayloadGlobForImporter(pattern, candidate string) bool {
	return matchPayloadGlob(pattern, candidate)
}

// ensureSafePath rejects absolute paths and any path that escapes the
// repo root via "..". Empty path is allowed (treated as "no SKILL.md")
// but the manifest validator separately requires non-empty for declared
// skills; this is the second line of defense.
func ensureSafePath(p string) error {
	if p == "" {
		return fmt.Errorf("%w: empty skill path", ErrManifestInvalid)
	}
	if strings.HasPrefix(p, "/") {
		return fmt.Errorf("%w: %s", ErrUnsafePath, p)
	}
	cleaned := path.Clean(p)
	if cleaned == ".." || strings.HasPrefix(cleaned, "../") {
		return fmt.Errorf("%w: %s", ErrUnsafePath, p)
	}
	return nil
}

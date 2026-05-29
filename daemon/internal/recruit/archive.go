package recruit

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// Payload size and file count limits from the plan. These are upper
// bounds, not configurable downward yet — the install path aborts when
// any limit is exceeded so neither the cache nor the agent dir can
// accumulate partial state.
const (
	MaxArchiveDownloadBytes  = 50 * 1024 * 1024
	MaxExtractedPayloadBytes = 200 * 1024 * 1024
	MaxPayloadFileCount      = 5000
	// MaxPerFileTextBytes caps individual text/reference files at 1 MB.
	// Files declared as skills in the manifest that exceed this limit
	// are a hard install failure; other oversize text files surface the
	// same error so authors notice before publishing.
	MaxPerFileTextBytes = 1 * 1024 * 1024
	// binarySniffBytes is the prefix size used by isBinaryContent to
	// classify a tar entry. Matches the heuristic git uses internally:
	// any null byte in the first ~8KB → binary.
	binarySniffBytes = 8 * 1024
)

// DefaultCodeloadBase is the production GitHub tarball endpoint. Tests
// override Config.CodeloadBase to point at an httptest server.
const DefaultCodeloadBase = "https://codeload.github.com"

// Sentinel errors emitted by the archive code path. Surfaced through
// the app layer's mapRecruitError mapping so the RPC boundary still
// produces a clear bad-request for caller-visible failures.
var (
	ErrArchiveTooLarge      = errors.New("recruit: archive exceeds size limit")
	ErrPayloadTooLarge      = errors.New("recruit: extracted payload exceeds size limit")
	ErrPayloadFileTooLarge  = errors.New("recruit: payload file exceeds per-file size limit")
	ErrPayloadTooManyFiles  = errors.New("recruit: extracted payload exceeds file count limit")
	ErrPayloadMissingFile   = errors.New("recruit: required payload file missing")
	ErrArchiveTraversal     = errors.New("recruit: archive entry escapes repo root")
	ErrArchiveSymlinkEscape = errors.New("recruit: archive symlink escapes repo root")
	ErrArchiveUnsupported   = errors.New("recruit: archive contains unsupported entry type")
)

// FetchArchive downloads the GitHub tarball for the given tag, writing
// it to a cache file under cacheBase keyed by (owner, repo, tag). On a
// cache hit it returns the cached path without contacting the network.
// Returns ErrTagNotFound when the tag does not exist upstream.
func (c *Client) FetchArchive(ctx context.Context, coord repoCoord, tag, cacheBase string) (string, error) {
	cachePath := archiveCachePath(cacheBase, coord, tag)
	if info, err := os.Stat(cachePath); err == nil && info.Size() > 0 {
		return cachePath, nil
	}
	if err := os.MkdirAll(filepath.Dir(cachePath), 0o755); err != nil {
		return "", err
	}

	base := c.codeloadBase
	if base == "" {
		base = DefaultCodeloadBase
	}
	url := fmt.Sprintf("%s/%s/%s/tar.gz/%s",
		strings.TrimRight(base, "/"),
		coord.Owner,
		coord.Repo,
		tag,
	)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("recruit: fetch %s: %w", url, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return "", ErrTagNotFound
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("recruit: fetch %s: status %d", url, resp.StatusCode)
	}

	tmp, err := os.CreateTemp(filepath.Dir(cachePath), "archive-*.tar.gz.partial")
	if err != nil {
		return "", err
	}
	defer func() {
		tmp.Close()
		os.Remove(tmp.Name())
	}()
	written, err := io.Copy(tmp, io.LimitReader(resp.Body, MaxArchiveDownloadBytes+1))
	if err != nil {
		return "", err
	}
	if written > MaxArchiveDownloadBytes {
		return "", fmt.Errorf("%w: %d bytes downloaded (limit %d)", ErrArchiveTooLarge, written, MaxArchiveDownloadBytes)
	}
	if err := tmp.Close(); err != nil {
		return "", err
	}
	if err := os.Rename(tmp.Name(), cachePath); err != nil {
		return "", err
	}
	return cachePath, nil
}

// archiveCachePath returns the deterministic on-disk location for a
// cached tarball. The owner/repo segment is hashed so an evil repo
// name (e.g. with `..`) cannot inject path components into the cache
// tree, even though parseGitHubRepo already filters those out at the
// URL stage.
func archiveCachePath(base string, coord repoCoord, tag string) string {
	sum := sha256.Sum256([]byte(coord.Owner + "/" + coord.Repo))
	hashed := hex.EncodeToString(sum[:8])
	safeTag := strings.ReplaceAll(tag, string(filepath.Separator), "_")
	return filepath.Join(base, hashed, safeTag, "archive.tar.gz")
}

// ExtractFilteredPayload reads a GitHub-style tarball at archivePath,
// strips the single wrapper directory the GitHub codeload produces,
// applies the supplied include/exclude globs, and copies the surviving
// files into destDir. Symlinks, hard links, devices, and other entry
// types are rejected so an attacker cannot smuggle out-of-tree state.
// Returns the list of repo-root-relative paths actually written so the
// installer can validate required files exist before atomic rotation.
func ExtractFilteredPayload(archivePath, destDir string, resolved ResolvedPayload) ([]string, error) {
	f, err := os.Open(archivePath)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return nil, fmt.Errorf("recruit: open gzip: %w", err)
	}
	defer gz.Close()
	tr := tar.NewReader(gz)

	var totalBytes int64
	var fileCount int
	wrapper := ""
	written := make([]string, 0, 64)
	createdDirs := map[string]bool{}

	for {
		hdr, err := tr.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("recruit: read tar: %w", err)
		}
		name := filepath.ToSlash(filepath.Clean(hdr.Name))
		if name == "." || name == "" {
			continue
		}
		if strings.HasPrefix(name, "/") || hasParentSegment(name) {
			return nil, fmt.Errorf("%w: %s", ErrArchiveTraversal, hdr.Name)
		}

		// First non-empty segment becomes the wrapper directory; the
		// installer evaluates patterns against the repo-root-relative
		// remainder. The codeload tarball always wraps in a single
		// directory like "{repo}-{shortsha}/" so this is deterministic.
		segs := strings.SplitN(name, "/", 2)
		if wrapper == "" {
			wrapper = segs[0]
		}
		if segs[0] != wrapper {
			// Two different top-level directories means the tarball
			// was hand-rolled — refuse it rather than guess.
			return nil, fmt.Errorf("%w: multiple top-level directories (%s, %s)", ErrArchiveTraversal, wrapper, segs[0])
		}
		relative := ""
		if len(segs) > 1 {
			relative = segs[1]
		}
		if relative == "" {
			// The wrapper dir entry itself; nothing to write.
			continue
		}

		switch hdr.Typeflag {
		case tar.TypeReg, tar.TypeRegA, tar.TypeDir:
		case tar.TypeSymlink, tar.TypeLink:
			// Reject all link types unconditionally to avoid both
			// out-of-tree escapes and circular reads inside the
			// agent source dir.
			return nil, fmt.Errorf("%w: %s -> %s", ErrArchiveSymlinkEscape, hdr.Name, hdr.Linkname)
		default:
			return nil, fmt.Errorf("%w: %s (type=%d)", ErrArchiveUnsupported, hdr.Name, hdr.Typeflag)
		}

		if hdr.Typeflag == tar.TypeDir {
			// Directories are materialized lazily when a kept file
			// needs them. Skipping here keeps empty upstream dirs out
			// of the installed payload but doesn't drop files.
			continue
		}

		if !includes(resolved.Include, relative) {
			continue
		}
		if includes(resolved.Exclude, relative) {
			continue
		}

		if hdr.Size < 0 {
			return nil, fmt.Errorf("%w: %s declares negative size", ErrArchiveUnsupported, hdr.Name)
		}

		// Read the entry into memory up to one byte past the per-file
		// text cap. Binary files are classified by null byte and
		// skipped; text files larger than the cap are an error so the
		// author notices before publishing instead of silently dropping
		// the file. Reading once also lets the size check distinguish
		// between "header lied" and "legitimate cap exceeded".
		content, err := io.ReadAll(io.LimitReader(tr, int64(MaxPerFileTextBytes)+1))
		if err != nil {
			return nil, err
		}
		if isBinaryContent(content) {
			// Skipping a binary is silent: the installer's required-file
			// check later will surface a missing SKILL.md or AGENT.md
			// even if the author accidentally marked one of them
			// binary (e.g., wrong encoding).
			continue
		}
		if int64(len(content)) > MaxPerFileTextBytes {
			return nil, fmt.Errorf("%w: %s exceeds %d byte text limit", ErrPayloadFileTooLarge, relative, MaxPerFileTextBytes)
		}

		fileCount++
		if fileCount > MaxPayloadFileCount {
			return nil, fmt.Errorf("%w: %d files (limit %d)", ErrPayloadTooManyFiles, fileCount, MaxPayloadFileCount)
		}
		totalBytes += int64(len(content))
		if totalBytes > MaxExtractedPayloadBytes {
			return nil, fmt.Errorf("%w: %d bytes (limit %d)", ErrPayloadTooLarge, totalBytes, MaxExtractedPayloadBytes)
		}

		target, err := safeJoin(destDir, relative)
		if err != nil {
			return nil, err
		}
		if err := ensureParentDirs(target, destDir, createdDirs); err != nil {
			return nil, err
		}
		if err := os.WriteFile(target, content, 0o644); err != nil {
			return nil, err
		}
		written = append(written, relative)
	}
	if wrapper == "" {
		return nil, fmt.Errorf("recruit: archive is empty")
	}
	return written, nil
}

// safeJoin produces destDir/relative while refusing any path that would
// resolve outside destDir. The relative input has already been cleaned
// at the tar header parse step; this is the second line of defense for
// symlink-free archives that still try to encode `..` after a redirect.
func safeJoin(destDir, relative string) (string, error) {
	target := filepath.Join(destDir, filepath.FromSlash(relative))
	cleaned, err := filepath.Abs(target)
	if err != nil {
		return "", err
	}
	rootAbs, err := filepath.Abs(destDir)
	if err != nil {
		return "", err
	}
	if cleaned != rootAbs && !strings.HasPrefix(cleaned, rootAbs+string(filepath.Separator)) {
		return "", fmt.Errorf("%w: %s", ErrArchiveTraversal, relative)
	}
	return cleaned, nil
}

// hasParentSegment reports whether a slash-separated path contains a
// `..` *segment*. Rejecting only segment-equal `..` lets through
// legitimate filenames like `docs/v1..notes.md` while still blocking
// any escape from the wrapper directory.
func hasParentSegment(name string) bool {
	for _, seg := range strings.Split(name, "/") {
		if seg == ".." {
			return true
		}
	}
	return false
}

// isBinaryContent uses the same null-byte sniff git uses internally
// to flag binary files. Inspects up to binarySniffBytes of the
// buffered content; longer files are still classified from the
// prefix so the caller doesn't have to read past the per-file cap.
func isBinaryContent(content []byte) bool {
	if len(content) > binarySniffBytes {
		content = content[:binarySniffBytes]
	}
	for _, b := range content {
		if b == 0 {
			return true
		}
	}
	return false
}

func ensureParentDirs(target, destDir string, created map[string]bool) error {
	dir := filepath.Dir(target)
	if dir == "" || dir == "." {
		return nil
	}
	if created[dir] {
		return nil
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	created[dir] = true
	return nil
}

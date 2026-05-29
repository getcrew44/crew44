package recruit

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// tarEntry is one file to encode into the synthetic GitHub tarball used
// by these tests. The codeload format wraps every entry under a single
// top-level directory named {repo}-{shortsha}/, which ExtractFilteredPayload
// strips before applying include/exclude.
type tarEntry struct {
	name     string
	body     string
	typeflag byte
	linkname string
}

func buildTarball(t *testing.T, wrapper string, entries []tarEntry) []byte {
	t.Helper()
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	// Always emit the wrapper directory entry first to mimic codeload.
	if err := tw.WriteHeader(&tar.Header{Name: wrapper + "/", Typeflag: tar.TypeDir, Mode: 0o755}); err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		typeflag := e.typeflag
		if typeflag == 0 {
			typeflag = tar.TypeReg
		}
		hdr := &tar.Header{
			Name:     wrapper + "/" + e.name,
			Mode:     0o644,
			Size:     int64(len(e.body)),
			Typeflag: typeflag,
			Linkname: e.linkname,
		}
		if typeflag == tar.TypeDir {
			hdr.Size = 0
			hdr.Mode = 0o755
		}
		if err := tw.WriteHeader(hdr); err != nil {
			t.Fatal(err)
		}
		if typeflag == tar.TypeReg && len(e.body) > 0 {
			if _, err := tw.Write([]byte(e.body)); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestFetchArchiveCachesAndServesFromCache(t *testing.T) {
	tarBytes := buildTarball(t, "agent-abc1234", []tarEntry{
		{name: "AGENT.md", body: "# Patch\n"},
		{name: "crew44-agent.json", body: `{"schema_version":"crew44.agent.v1","name":"Patch","version":"1.0.0","description":"d"}`},
	})
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if !strings.Contains(r.URL.Path, "/hex/patch-agent/tar.gz/v1.0.0") {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Write(tarBytes)
	}))
	defer srv.Close()
	c := NewClient(Config{CodeloadBase: srv.URL})
	cacheDir := t.TempDir()
	coord := repoCoord{Owner: "hex", Repo: "patch-agent"}

	first, err := c.FetchArchive(context.Background(), coord, "v1.0.0", cacheDir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(first); err != nil {
		t.Fatal(err)
	}
	second, err := c.FetchArchive(context.Background(), coord, "v1.0.0", cacheDir)
	if err != nil {
		t.Fatal(err)
	}
	if first != second {
		t.Fatalf("cache path changed: %s vs %s", first, second)
	}
	if calls != 1 {
		t.Fatalf("cache miss: upstream hits=%d", calls)
	}
}

func TestFetchArchiveTagNotFound(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()
	c := NewClient(Config{CodeloadBase: srv.URL})
	_, err := c.FetchArchive(context.Background(), repoCoord{Owner: "x", Repo: "y"}, "v9.9.9", t.TempDir())
	if !errors.Is(err, ErrTagNotFound) {
		t.Fatalf("expected ErrTagNotFound, got %v", err)
	}
}

func TestExtractFilteredPayloadAppliesIncludeExclude(t *testing.T) {
	entries := []tarEntry{
		{name: "AGENT.md", body: "# A\n"},
		{name: "crew44-agent.json", body: "{}"},
		{name: "skills/foo/SKILL.md", body: "# foo\n"},
		{name: "skills/foo/.DS_Store", body: "junk"},
		{name: "docs/intro.md", body: "doc"},
		{name: "node_modules/dep/index.js", body: "dep"},
	}
	tarBytes := buildTarball(t, "patch-abc1234", entries)
	archivePath := filepath.Join(t.TempDir(), "a.tar.gz")
	if err := os.WriteFile(archivePath, tarBytes, 0o644); err != nil {
		t.Fatal(err)
	}
	dest := t.TempDir()

	written, err := ExtractFilteredPayload(archivePath, dest, ResolvedPayload{
		Include: []string{"AGENT.md", "crew44-agent.json", "skills/**", "docs/**"},
		Exclude: []string{"**/.DS_Store", "**/node_modules/**"},
	})
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]bool{}
	for _, p := range written {
		got[p] = true
	}
	wantPresent := []string{"AGENT.md", "crew44-agent.json", "skills/foo/SKILL.md", "docs/intro.md"}
	for _, p := range wantPresent {
		if !got[p] {
			t.Errorf("missing %s in extracted payload", p)
		}
		if _, err := os.Stat(filepath.Join(dest, p)); err != nil {
			t.Errorf("file not on disk: %s: %v", p, err)
		}
	}
	wantAbsent := []string{"skills/foo/.DS_Store", "node_modules/dep/index.js"}
	for _, p := range wantAbsent {
		if got[p] {
			t.Errorf("%s should have been filtered out", p)
		}
		if _, err := os.Stat(filepath.Join(dest, p)); err == nil {
			t.Errorf("file should not exist on disk: %s", p)
		}
	}
}

func TestExtractFilteredPayloadRejectsSymlinkEscape(t *testing.T) {
	entries := []tarEntry{
		{name: "AGENT.md", body: "# A\n"},
		{name: "escape", typeflag: tar.TypeSymlink, linkname: "../../../etc/passwd"},
	}
	tarBytes := buildTarball(t, "x-12345678", entries)
	archivePath := filepath.Join(t.TempDir(), "a.tar.gz")
	os.WriteFile(archivePath, tarBytes, 0o644)
	_, err := ExtractFilteredPayload(archivePath, t.TempDir(), ResolvedPayload{Include: []string{"**"}})
	if !errors.Is(err, ErrArchiveSymlinkEscape) {
		t.Fatalf("expected ErrArchiveSymlinkEscape, got %v", err)
	}
}

func TestExtractFilteredPayloadRejectsTraversal(t *testing.T) {
	// A hand-rolled tar that smuggles a `..` segment past the wrapper.
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	tw.WriteHeader(&tar.Header{Name: "wrapper/", Typeflag: tar.TypeDir, Mode: 0o755})
	tw.WriteHeader(&tar.Header{Name: "wrapper/../escape", Typeflag: tar.TypeReg, Mode: 0o644, Size: 1})
	tw.Write([]byte("x"))
	tw.Close()
	gz.Close()
	archivePath := filepath.Join(t.TempDir(), "a.tar.gz")
	os.WriteFile(archivePath, buf.Bytes(), 0o644)
	_, err := ExtractFilteredPayload(archivePath, t.TempDir(), ResolvedPayload{Include: []string{"**"}})
	if !errors.Is(err, ErrArchiveTraversal) {
		t.Fatalf("expected ErrArchiveTraversal, got %v", err)
	}
}

// Filenames may legally contain `..` as a substring (e.g.
// `docs/v1..notes.md`); the traversal check must only reject
// `..` segments.
func TestExtractFilteredPayloadAcceptsDotDotSubstring(t *testing.T) {
	entries := []tarEntry{
		{name: "docs/v1..notes.md", body: "ok"},
	}
	tarBytes := buildTarball(t, "x-12345678", entries)
	archivePath := filepath.Join(t.TempDir(), "a.tar.gz")
	os.WriteFile(archivePath, tarBytes, 0o644)
	written, err := ExtractFilteredPayload(archivePath, t.TempDir(), ResolvedPayload{Include: []string{"docs/**"}})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(written) != 1 || written[0] != "docs/v1..notes.md" {
		t.Fatalf("written = %v, want [docs/v1..notes.md]", written)
	}
}

// Binary files (identified by an embedded null byte in the first 8 KB)
// are silently skipped from the install payload; the wrapper repo can
// still include them upstream, but they don't land in source/.
func TestExtractFilteredPayloadSkipsBinaryFiles(t *testing.T) {
	entries := []tarEntry{
		{name: "AGENT.md", body: "# text\n"},
		{name: "assets/logo.png", body: "PNG\x00binarycontent"},
	}
	tarBytes := buildTarball(t, "x-12345678", entries)
	archivePath := filepath.Join(t.TempDir(), "a.tar.gz")
	os.WriteFile(archivePath, tarBytes, 0o644)

	dest := t.TempDir()
	written, err := ExtractFilteredPayload(archivePath, dest, ResolvedPayload{Include: []string{"**"}})
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range written {
		if p == "assets/logo.png" {
			t.Fatalf("binary file should have been skipped")
		}
	}
	if _, err := os.Stat(filepath.Join(dest, "assets/logo.png")); err == nil {
		t.Fatal("binary file should not be written to disk")
	}
	if _, err := os.Stat(filepath.Join(dest, "AGENT.md")); err != nil {
		t.Fatalf("text file should still be present: %v", err)
	}
}

// Text files larger than 1 MB are a hard install failure so the author
// notices instead of silently dropping the file.
func TestExtractFilteredPayloadRejectsOversizeTextFile(t *testing.T) {
	body := strings.Repeat("a", int(MaxPerFileTextBytes)+1)
	entries := []tarEntry{
		{name: "docs/big.md", body: body},
	}
	tarBytes := buildTarball(t, "x-12345678", entries)
	archivePath := filepath.Join(t.TempDir(), "a.tar.gz")
	os.WriteFile(archivePath, tarBytes, 0o644)
	_, err := ExtractFilteredPayload(archivePath, t.TempDir(), ResolvedPayload{Include: []string{"docs/**"}})
	if !errors.Is(err, ErrPayloadFileTooLarge) {
		t.Fatalf("expected ErrPayloadFileTooLarge, got %v", err)
	}
}

func TestExtractFilteredPayloadEnforcesFileCountLimit(t *testing.T) {
	// Build many files; cap is hit by raising count past MaxPayloadFileCount.
	entries := make([]tarEntry, MaxPayloadFileCount+1)
	for i := range entries {
		entries[i] = tarEntry{name: filepath.Join("docs", string(rune('a'+i%26))+string(rune('a'+(i/26)%26))+".md"), body: "x"}
	}
	tarBytes := buildTarball(t, "x-12345678", entries)
	archivePath := filepath.Join(t.TempDir(), "a.tar.gz")
	os.WriteFile(archivePath, tarBytes, 0o644)
	_, err := ExtractFilteredPayload(archivePath, t.TempDir(), ResolvedPayload{Include: []string{"**"}})
	if !errors.Is(err, ErrPayloadTooManyFiles) {
		t.Fatalf("expected ErrPayloadTooManyFiles, got %v", err)
	}
}

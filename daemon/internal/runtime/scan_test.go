//go:build !windows

package runtime

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"testing"

	"github.com/getcrew44/crew44/daemon/internal/model"
)

// TestLocalScannerDetectsAllProviders builds a fake CLI for each supported
// provider on a temp PATH and verifies every one shows up in the scan
// result. The fakes emit a representative `--version` line shape
// (a leading prose word followed by a semver — what every supported CLI
// actually prints in practice) so changes to extractVersionLine /
// CheckMinVersion are exercised end-to-end through the scanner.
func TestLocalScannerDetectsAllProviders(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX-only: shell-script fixtures")
	}

	type fixture struct {
		bin     string // file name to drop on PATH
		version string // what `<bin> --version` should print
	}
	// Real-world version output shapes, harvested from each tool's source:
	//   claude:        "2.1.146 (Claude Code)"
	//   codex:         "codex-cli 0.125.0"
	//   cursor-agent:  prose with embedded "v1.2.3"
	//   gemini:        Windows shim sometimes prefixes "Active code page: 65001"
	//                  — exercise that path so extractVersionLine actually runs
	//   hermes:        "hermes 0.4.2"
	//   kimi:          "kimi 0.3.0"
	//   opencode:      "opencode 0.21.4"
	//   openclaw:      "openclaw 2026.5.5 abc123" (CalVer)
	//   pi:            "pi 0.5.0"
	fixtures := map[string]fixture{
		"claude":   {bin: "claude", version: "2.1.146 (Claude Code)"},
		"codex":    {bin: "codex", version: "codex-cli 0.125.0"},
		"cursor":   {bin: "cursor-agent", version: "cursor-agent v1.4.2"},
		"gemini":   {bin: "gemini", version: "Active code page: 65001\n0.6.1"},
		"hermes":   {bin: "hermes", version: "hermes 0.4.2"},
		"kimi":     {bin: "kimi", version: "kimi 0.3.0"},
		"opencode": {bin: "opencode", version: "opencode 0.21.4"},
		"openclaw": {bin: "openclaw", version: "openclaw 2026.5.5 abc123"},
		"pi":       {bin: "pi", version: "pi 0.5.0"},
	}

	binDir := t.TempDir()
	for _, fx := range fixtures {
		writeFakeVersionScript(t, filepath.Join(binDir, fx.bin), fx.version)
	}

	// Isolate PATH so a real claude / codex on the developer's machine doesn't
	// shadow the fake — exec.LookPath would otherwise find the real one first.
	t.Setenv("PATH", binDir)
	// Clear any env overrides that would skip the default-bin lookup.
	for _, spec := range localProviderSpecs {
		t.Setenv(spec.PathEnv, "")
		t.Setenv(spec.ModelEnv, "")
	}

	records, err := LocalScanner{}.Scan(context.Background())
	if err != nil {
		t.Fatalf("Scan returned error: %v", err)
	}

	got := make(map[string]string, len(records))
	for _, r := range records {
		got[r.Provider] = r.Version
	}

	wantProviders := make([]string, 0, len(fixtures))
	for p := range fixtures {
		wantProviders = append(wantProviders, p)
	}
	sort.Strings(wantProviders)

	for _, p := range wantProviders {
		version, ok := got[p]
		if !ok {
			t.Errorf("provider %q: not detected (got %d providers: %v)", p, len(records), providerList(records))
			continue
		}
		// Version must carry a semver — that's what downstream CheckMinVersion
		// and the UI dropdown care about. Tolerate prefixes/suffixes.
		if !strings.ContainsAny(version, "0123456789") || !strings.Contains(version, ".") {
			t.Errorf("provider %q: version %q does not look like a semver", p, version)
		}
	}
}

// TestLocalScannerSkipsMissing covers the negative path: when no binary
// exists on PATH, the scan completes cleanly and returns no records — i.e.
// missing CLIs are silently skipped rather than producing an error.
func TestLocalScannerSkipsMissing(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX-only: shell-script fixtures")
	}
	t.Setenv("PATH", t.TempDir())
	for _, spec := range localProviderSpecs {
		t.Setenv(spec.PathEnv, "")
	}

	records, err := LocalScanner{}.Scan(context.Background())
	if err != nil {
		t.Fatalf("Scan returned error: %v", err)
	}
	if len(records) != 0 {
		t.Errorf("expected zero records on empty PATH, got %d: %v", len(records), providerList(records))
	}
}

// TestDisplayRuntimeNamesAreSet guards against silent regressions: every
// provider listed in localProviderSpecs must have a hand-written display
// name, not the strings.Title fallback (which produces e.g. "Cursor"
// instead of "Cursor Agent" and "Opencode" instead of "OpenCode").
func TestDisplayRuntimeNamesAreSet(t *testing.T) {
	want := map[string]string{
		"claude":   "Claude Code",
		"codex":    "Codex",
		"cursor":   "Cursor Agent",
		"gemini":   "Gemini CLI",
		"hermes":   "Hermes",
		"kimi":     "Kimi",
		"opencode": "OpenCode",
		"openclaw": "OpenClaw",
		"pi":       "Pi",
	}
	for _, spec := range localProviderSpecs {
		got := displayRuntimeName(spec.Provider)
		expected, ok := want[spec.Provider]
		if !ok {
			t.Errorf("provider %q has no expected display name in this test — add one to keep coverage honest", spec.Provider)
			continue
		}
		if got != expected {
			t.Errorf("displayRuntimeName(%q) = %q, want %q", spec.Provider, got, expected)
		}
	}
}

func writeFakeVersionScript(t *testing.T, path, version string) {
	t.Helper()
	script := "#!/bin/sh\n" +
		"if [ \"$1\" = \"--version\" ]; then\n" +
		"  printf '%s\\n' " + shellQuote(version) + "\n" +
		"  exit 0\n" +
		"fi\n" +
		"exit 0\n"
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake script %s: %v", path, err)
	}
}

func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

func providerList(records []model.RuntimeRecord) []string {
	out := make([]string, 0, len(records))
	for _, r := range records {
		out = append(out, r.Provider)
	}
	sort.Strings(out)
	return out
}

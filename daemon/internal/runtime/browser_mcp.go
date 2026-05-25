package runtime

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// Crew44 gives every isolated claude/codex runtime a headless browser by
// injecting a Playwright MCP server into the runtime's config. The server is
// launched on demand via npx, so no extra binary ships with crew44 — the agent
// gains browser_navigate / browser_take_screenshot / browser_snapshot tools the
// moment it asks for them.
//
// The browser runs headless (no visible window) since these agents are spawned
// by a daemon, and --isolated keeps no profile on disk.
const (
	// Pinned to a specific tested version rather than @latest: an isolated
	// agent's browser behavior stays reproducible across runs, and a new npm
	// publish can't silently change tool behavior (or ship a compromised
	// build) underneath every runtime. Bump deliberately after testing.
	playwrightMCPPackage = "@playwright/mcp@0.0.75"
	browserMCPServerName = "playwright"
)

// playwrightMCPArgs are the npx arguments shared by both runtimes. -y skips the
// npx install prompt; --headless runs without a window; --isolated avoids
// persisting a browser profile into the sandboxed HOME.
func playwrightMCPArgs() []string {
	return []string{"-y", playwrightMCPPackage, "--headless", "--isolated"}
}

// resolvePlaywrightBrowsersPath returns the directory Playwright should use for
// its browser binaries. An explicit PLAYWRIGHT_BROWSERS_PATH on the daemon wins
// (lets an operator pin a shared cache). Otherwise we point at the host user's
// default ms-playwright cache so every agent reuses one Chromium download
// instead of each redirected HOME triggering its own.
//
// Returns "" only when the host home can't be resolved, in which case callers
// omit the env override and let Playwright fall back to its own default
// (the sandboxed HOME).
func resolvePlaywrightBrowsersPath() string {
	if v := strings.TrimSpace(os.Getenv("PLAYWRIGHT_BROWSERS_PATH")); v != "" {
		return v
	}
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return ""
	}
	switch runtime.GOOS {
	case "darwin":
		return filepath.Join(home, "Library", "Caches", "ms-playwright")
	case "windows":
		if local := strings.TrimSpace(os.Getenv("LOCALAPPDATA")); local != "" {
			return filepath.Join(local, "ms-playwright")
		}
		return filepath.Join(home, "AppData", "Local", "ms-playwright")
	default:
		return filepath.Join(home, ".cache", "ms-playwright")
	}
}

// browserMCPEnv returns the env vars the Playwright MCP server should run with,
// or nil when there's nothing to set.
func browserMCPEnv() map[string]string {
	if path := resolvePlaywrightBrowsersPath(); path != "" {
		return map[string]string{"PLAYWRIGHT_BROWSERS_PATH": path}
	}
	return nil
}

// ensureClaudeBrowserMCP merges the Playwright MCP server into the isolated
// .claude.json at user scope (top-level mcpServers), preserving every other
// key. claude reads back via the same file, so re-running is safe: the
// playwright entry is set to its canonical value each time while any other
// servers and settings are left untouched.
//
// The file is decoded with UseNumber so large integer fields (e.g. ms
// timestamps) round-trip exactly rather than through float64.
func ensureClaudeBrowserMCP(configDir string) error {
	path := filepath.Join(configDir, ".claude.json")

	top := map[string]any{}
	data, err := os.ReadFile(path)
	if err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("read claude config: %w", err)
	}
	if len(bytes.TrimSpace(data)) > 0 {
		dec := json.NewDecoder(bytes.NewReader(data))
		dec.UseNumber()
		if err := dec.Decode(&top); err != nil {
			return fmt.Errorf("parse claude config: %w", err)
		}
	}

	servers, _ := top["mcpServers"].(map[string]any)
	if servers == nil {
		servers = map[string]any{}
	}
	server := map[string]any{
		"type":    "stdio",
		"command": "npx",
		"args":    playwrightMCPArgs(),
	}
	if env := browserMCPEnv(); env != nil {
		server["env"] = env
	}
	servers[browserMCPServerName] = server
	top["mcpServers"] = servers

	out, err := json.MarshalIndent(top, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal claude config: %w", err)
	}
	out = append(out, '\n')
	if err := os.MkdirAll(configDir, 0o755); err != nil {
		return fmt.Errorf("create claude config dir: %w", err)
	}
	return os.WriteFile(path, out, 0o600)
}

// ensureCodexBrowserMCP appends a [mcp_servers.playwright] table to the
// isolated codex config.toml when one is not already present. codex round-trips
// this file (preserving the table) and writes its own top-level keys before any
// table, so appending at the end stays valid TOML.
//
// The guard keys off the table header: if the agent (or a prior run) already
// configured a playwright server, we leave it alone rather than risk a
// duplicate-table parse error. The project has no TOML dependency, so the block
// is emitted as text — it has no dynamic structure beyond the browsers path.
func ensureCodexBrowserMCP(codexHome string) error {
	path := filepath.Join(codexHome, "config.toml")

	existing, err := os.ReadFile(path)
	if err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("read codex config: %w", err)
	}
	if codexHasServerTable(string(existing), browserMCPServerName) {
		return nil
	}

	block := codexBrowserMCPBlock()
	var buf bytes.Buffer
	if trimmed := bytes.TrimRight(existing, "\n"); len(trimmed) > 0 {
		buf.Write(trimmed)
		buf.WriteString("\n\n")
	}
	buf.WriteString(block)

	if err := os.MkdirAll(codexHome, 0o755); err != nil {
		return fmt.Errorf("create codex home: %w", err)
	}
	return os.WriteFile(path, buf.Bytes(), 0o600)
}

// codexHasServerTable reports whether config.toml already declares the
// [mcp_servers.<name>] table. It scans line by line rather than substring-
// matching the whole file so that the same text inside a comment or a string
// value does not count as a real declaration — and so a header written with
// legal inner whitespace (`[ mcp_servers.name ]`) is still recognized, which a
// naive Contains would miss and then duplicate. Quoted-key headers
// (`["mcp_servers"."name"]`) are not matched, but codex never emits them.
func codexHasServerTable(content, name string) bool {
	target := "mcp_servers." + name
	for _, line := range strings.Split(content, "\n") {
		// Drop any trailing comment. A '#' inside a string can't begin a
		// table-header line, so cutting at the first '#' is safe here.
		if i := strings.IndexByte(line, '#'); i >= 0 {
			line = line[:i]
		}
		line = strings.TrimSpace(line)
		// Single-table headers only: skip [[array.of.tables]] and non-headers.
		if !strings.HasPrefix(line, "[") || strings.HasPrefix(line, "[[") || !strings.HasSuffix(line, "]") {
			continue
		}
		inner := line[1 : len(line)-1]
		// TOML permits whitespace inside the brackets and around the dots.
		inner = strings.ReplaceAll(inner, " ", "")
		inner = strings.ReplaceAll(inner, "\t", "")
		if inner == target {
			return true
		}
	}
	return false
}

func codexBrowserMCPBlock() string {
	args := playwrightMCPArgs()
	quoted := make([]string, len(args))
	for i, a := range args {
		quoted[i] = tomlString(a)
	}
	var b strings.Builder
	fmt.Fprintf(&b, "[mcp_servers.%s]\n", browserMCPServerName)
	b.WriteString("command = \"npx\"\n")
	fmt.Fprintf(&b, "args = [%s]\n", strings.Join(quoted, ", "))
	b.WriteString("startup_timeout_sec = 60\n")
	if env := browserMCPEnv(); env != nil {
		fmt.Fprintf(&b, "\n[mcp_servers.%s.env]\n", browserMCPServerName)
		if path := env["PLAYWRIGHT_BROWSERS_PATH"]; path != "" {
			fmt.Fprintf(&b, "PLAYWRIGHT_BROWSERS_PATH = %s\n", tomlString(path))
		}
	}
	return b.String()
}

// tomlString renders s as a TOML basic string. It escapes backslash and double
// quote, the named control escapes TOML defines, and any other control
// character (< 0x20, plus DEL) as \uXXXX. The values we emit are paths and npx
// args that never contain control bytes in practice, but encoding them keeps
// the output valid TOML rather than silently corrupting config.toml if one ever
// does (e.g. an operator-set PLAYWRIGHT_BROWSERS_PATH with a stray newline).
func tomlString(s string) string {
	var b strings.Builder
	b.WriteByte('"')
	for _, r := range s {
		switch r {
		case '\\':
			b.WriteString(`\\`)
		case '"':
			b.WriteString(`\"`)
		case '\b':
			b.WriteString(`\b`)
		case '\t':
			b.WriteString(`\t`)
		case '\n':
			b.WriteString(`\n`)
		case '\f':
			b.WriteString(`\f`)
		case '\r':
			b.WriteString(`\r`)
		default:
			if r < 0x20 || r == 0x7f {
				fmt.Fprintf(&b, `\u%04X`, r)
			} else {
				b.WriteRune(r)
			}
		}
	}
	b.WriteByte('"')
	return b.String()
}

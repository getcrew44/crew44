//go:build windows

package runtime

import (
	"os"
	"strings"
	"syscall"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

// refreshSystemPath re-reads HKLM + HKCU Environment\Path from the Windows
// registry and merges them into the daemon's PATH so a freshly-installed
// claude.exe / codex.cmd becomes visible without restarting the app. The
// Electron parent inherits PATH from explorer.exe, which only refreshes on
// WM_SETTINGCHANGE — which neither Electron nor this daemon listens for, so
// without this call the inherited PATH is permanently stale relative to the
// registry whenever the user installs a CLI after launching Crew44.
func refreshSystemPath() {
	merged := make([]string, 0, 64)
	seen := make(map[string]bool)
	add := func(parts []string) {
		for _, p := range parts {
			p = strings.TrimSpace(p)
			if p == "" {
				continue
			}
			key := strings.ToLower(p)
			if seen[key] {
				continue
			}
			seen[key] = true
			merged = append(merged, p)
		}
	}
	// System PATH first, then user PATH, then whatever the process already
	// had — matches the order Windows itself composes a new process's PATH.
	add(readRegistryPath(registry.LOCAL_MACHINE, `SYSTEM\CurrentControlSet\Control\Session Manager\Environment`))
	add(readRegistryPath(registry.CURRENT_USER, `Environment`))
	add(strings.Split(os.Getenv("PATH"), string(os.PathListSeparator)))

	if len(merged) > 0 {
		os.Setenv("PATH", strings.Join(merged, string(os.PathListSeparator)))
	}
}

func readRegistryPath(root registry.Key, sub string) []string {
	k, err := registry.OpenKey(root, sub, registry.QUERY_VALUE)
	if err != nil {
		return nil
	}
	defer k.Close()
	// Path is REG_EXPAND_SZ; GetStringValue returns it unexpanded
	// (literal "%SystemRoot%\\System32"). Expand via the Win32 API.
	raw, _, err := k.GetStringValue("Path")
	if err != nil {
		return nil
	}
	return strings.Split(expandEnv(raw), string(os.PathListSeparator))
}

func expandEnv(in string) string {
	src, err := syscall.UTF16PtrFromString(in)
	if err != nil {
		return in
	}
	n, err := windows.ExpandEnvironmentStrings(src, nil, 0)
	if err != nil || n == 0 {
		return in
	}
	buf := make([]uint16, n)
	if _, err := windows.ExpandEnvironmentStrings(src, &buf[0], n); err != nil {
		return in
	}
	return syscall.UTF16ToString(buf)
}

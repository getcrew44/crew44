//go:build !windows

package runtime

// refreshSystemPath is a no-op outside Windows. On macOS and Linux the
// Electron parent already runs repairProcessPath() to recover the login
// shell's PATH (see electron/main.cjs), and there is no registry-style
// out-of-process truth to consult mid-run.
func refreshSystemPath() {}

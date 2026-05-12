package runtime

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
)

var codexSymlinkedDirs = []string{
	"sessions",
}

var codexSymlinkedFiles = []string{
	"auth.json",
}

var codexCopiedFiles = []string{
	"config.json",
	"config.toml",
	"instructions.md",
}

func prepareCodexHome(codexHome string) error {
	sharedHome := resolveSharedCodexHome()
	if err := os.MkdirAll(codexHome, 0o755); err != nil {
		return fmt.Errorf("create codex home: %w", err)
	}

	for _, name := range codexSymlinkedDirs {
		src := filepath.Join(sharedHome, name)
		dst := filepath.Join(codexHome, name)
		_ = ensureDirSymlink(src, dst)
	}
	for _, name := range codexSymlinkedFiles {
		src := filepath.Join(sharedHome, name)
		dst := filepath.Join(codexHome, name)
		_ = ensureSymlinkOrCopy(src, dst)
	}
	for _, name := range codexCopiedFiles {
		src := filepath.Join(sharedHome, name)
		dst := filepath.Join(codexHome, name)
		_ = copyFileIfExists(src, dst)
	}
	return sanitizeCopiedCodexConfig(filepath.Join(codexHome, "config.toml"))
}

func resolveSharedCodexHome() string {
	if v := os.Getenv("CODEX_HOME"); v != "" {
		if abs, err := filepath.Abs(v); err == nil {
			return abs
		}
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return filepath.Join(os.TempDir(), ".codex")
	}
	return filepath.Join(home, ".codex")
}

func ensureDirSymlink(src, dst string) error {
	if err := os.MkdirAll(src, 0o755); err != nil {
		return fmt.Errorf("create shared codex dir %s: %w", src, err)
	}
	if ok, err := existingSymlinkPointsTo(dst, src); err != nil {
		return err
	} else if ok {
		return nil
	}
	if err := os.RemoveAll(dst); err != nil && !os.IsNotExist(err) {
		return err
	}
	if err := os.Symlink(src, dst); err != nil {
		return copyDirIfExists(src, dst)
	}
	return nil
}

func ensureSymlinkOrCopy(src, dst string) error {
	if _, err := os.Stat(src); os.IsNotExist(err) {
		return nil
	} else if err != nil {
		return err
	}
	if ok, err := existingSymlinkPointsTo(dst, src); err != nil {
		return err
	} else if ok {
		return nil
	}
	if err := os.RemoveAll(dst); err != nil && !os.IsNotExist(err) {
		return err
	}
	if err := os.Symlink(src, dst); err != nil {
		return copyFileIfExists(src, dst)
	}
	return nil
}

func existingSymlinkPointsTo(path, target string) (bool, error) {
	info, err := os.Lstat(path)
	if os.IsNotExist(err) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if info.Mode()&os.ModeSymlink == 0 {
		return false, nil
	}
	current, err := os.Readlink(path)
	if err != nil {
		return false, err
	}
	return current == target, nil
}

func copyFileIfExists(src, dst string) error {
	in, err := os.Open(src)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	defer in.Close()

	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	defer out.Close()
	if _, err := io.Copy(out, in); err != nil {
		return err
	}
	return out.Close()
}

func copyDirIfExists(src, dst string) error {
	entries, err := os.ReadDir(src)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dst, 0o755); err != nil {
		return err
	}
	for _, entry := range entries {
		srcPath := filepath.Join(src, entry.Name())
		dstPath := filepath.Join(dst, entry.Name())
		if entry.IsDir() {
			if err := copyDirIfExists(srcPath, dstPath); err != nil {
				return err
			}
			continue
		}
		if err := copyFileIfExists(srcPath, dstPath); err != nil {
			return err
		}
	}
	return nil
}

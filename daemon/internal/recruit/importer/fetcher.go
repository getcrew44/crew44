package importer

import (
	"archive/tar"
	"compress/gzip"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// NewDirFetcher returns a Fetcher that copies the contents of srcDir
// into the importer's working directory. Useful when the operator
// already has a clone of the upstream repo and doesn't want the
// importer to talk to the network.
func NewDirFetcher(srcDir string) Fetcher {
	return &dirFetcher{src: srcDir}
}

type dirFetcher struct{ src string }

func (f *dirFetcher) Fetch(workDir string) (string, error) {
	info, err := os.Stat(f.src)
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		return "", fmt.Errorf("importer: --from-dir %q is not a directory", f.src)
	}
	return "", copyTree(f.src, workDir)
}

// NewTarballFetcher returns a Fetcher that downloads the GitHub
// tarball for {owner}/{repo} at ref, strips the codeload wrapper
// directory, and unpacks the contents into workDir. The base argument
// defaults to https://codeload.github.com when empty so tests can
// substitute an httptest server.
func NewTarballFetcher(client *http.Client, base, owner, repo, ref string) Fetcher {
	if client == nil {
		client = http.DefaultClient
	}
	if base == "" {
		base = "https://codeload.github.com"
	}
	return &tarballFetcher{client: client, base: base, owner: owner, repo: repo, ref: ref}
}

type tarballFetcher struct {
	client *http.Client
	base   string
	owner  string
	repo   string
	ref    string
}

func (f *tarballFetcher) Fetch(workDir string) (string, error) {
	url := fmt.Sprintf("%s/%s/%s/tar.gz/%s",
		strings.TrimRight(f.base, "/"),
		f.owner, f.repo, f.ref,
	)
	resp, err := f.client.Get(url)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return "", fmt.Errorf("importer: tarball not found for %s/%s@%s", f.owner, f.repo, f.ref)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("importer: fetch %s: status %d", url, resp.StatusCode)
	}
	gz, err := gzip.NewReader(resp.Body)
	if err != nil {
		return "", err
	}
	defer gz.Close()
	tr := tar.NewReader(gz)
	wrapper := ""
	for {
		hdr, err := tr.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return "", err
		}
		name := filepath.ToSlash(filepath.Clean(hdr.Name))
		if name == "" || name == "." {
			continue
		}
		if strings.HasPrefix(name, "/") || strings.Contains(name, "..") {
			return "", fmt.Errorf("importer: archive entry escapes repo root: %s", hdr.Name)
		}
		segs := strings.SplitN(name, "/", 2)
		if wrapper == "" {
			wrapper = segs[0]
		}
		if segs[0] != wrapper {
			return "", fmt.Errorf("importer: archive has multiple top-level dirs")
		}
		rel := ""
		if len(segs) > 1 {
			rel = segs[1]
		}
		if rel == "" {
			continue
		}
		if hdr.Typeflag == tar.TypeSymlink || hdr.Typeflag == tar.TypeLink {
			return "", fmt.Errorf("importer: symlinks are not supported in the importer fetch step")
		}
		target := filepath.Join(workDir, filepath.FromSlash(rel))
		if hdr.Typeflag == tar.TypeDir {
			if err := os.MkdirAll(target, 0o755); err != nil {
				return "", err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return "", err
		}
		out, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o644)
		if err != nil {
			return "", err
		}
		if _, err := io.Copy(out, tr); err != nil {
			out.Close()
			return "", err
		}
		if err := out.Close(); err != nil {
			return "", err
		}
	}
	// Strip the wrapper prefix from the recorded commit: it usually
	// includes the short SHA so wrapper="repo-abc1234" yields commit
	// "abc1234". When the wrapper is opaque, return "".
	commit := ""
	if idx := strings.LastIndex(wrapper, "-"); idx > 0 && idx < len(wrapper)-1 {
		commit = wrapper[idx+1:]
	}
	return commit, nil
}

// copyTree mirrors src into dst. Symlinks are skipped and the .git
// directory is ignored.
func copyTree(src, dst string) error {
	if err := os.MkdirAll(dst, 0o755); err != nil {
		return err
	}
	return filepath.Walk(src, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() && info.Name() == ".git" {
			return filepath.SkipDir
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		if rel == "." {
			return nil
		}
		target := filepath.Join(dst, rel)
		switch {
		case info.IsDir():
			return os.MkdirAll(target, 0o755)
		case info.Mode()&os.ModeSymlink != 0:
			return nil
		default:
			data, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				return err
			}
			return os.WriteFile(target, data, info.Mode().Perm())
		}
	})
}

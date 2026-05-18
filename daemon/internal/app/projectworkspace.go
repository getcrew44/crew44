package app

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"unicode/utf8"
)

// GitDiffFile is a single entry in the working-tree diff for a project.
type GitDiffFile struct {
	Path    string        `json:"path"`
	Status  string        `json:"status"` // 'A' (added), 'M' (modified), 'D' (deleted), 'R' (renamed), '?' (untracked)
	OldPath string        `json:"old_path,omitempty"`
	Added   int           `json:"added"`
	Removed int           `json:"removed"`
	Binary  bool          `json:"binary,omitempty"`
	Diff    []GitDiffLine `json:"diff,omitempty"`
}

// GitDiffLine is one line in a unified diff. Kind is "add", "del", "ctx", or
// "hunk" (for @@ hunk headers).
type GitDiffLine struct {
	Kind string `json:"kind"`
	Text string `json:"text"`
}

// GitDiff returns the working-tree diff (staged + unstaged) for a project's
// workdir. Returns ErrBadRequest when the workdir is missing, or a wrapped
// error when the workdir is not a git repository.
func (a *App) GitDiff(projectID string) ([]GitDiffFile, error) {
	project, err := a.store.GetProject(projectID)
	if err != nil {
		return nil, a.mapError(err)
	}
	root := strings.TrimSpace(project.Workdir)
	if root == "" {
		return nil, ErrBadRequest
	}
	if !isGitRepo(root) {
		return nil, fmt.Errorf("not a git repository: %w", ErrBadRequest)
	}
	hasHead := gitHasHead(root)
	pathPrefix := gitPathPrefix(root)

	// Untracked files (git diff alone won't show them).
	untracked, err := gitUntrackedFiles(root)
	if err != nil {
		return nil, err
	}

	// Tracked changes. With a real HEAD, `git diff HEAD` combines staged and
	// unstaged changes; in a brand-new repo there is no HEAD, so only the index
	// can be diffed and untracked files are listed separately below.
	stat, err := gitDiffNumstat(root, hasHead)
	if err != nil {
		return nil, err
	}
	names, err := gitDiffNameStatus(root, hasHead)
	if err != nil {
		return nil, err
	}
	diffs, err := gitDiffUnified(root, hasHead)
	if err != nil {
		return nil, err
	}

	out := make([]GitDiffFile, 0, len(stat)+len(untracked))
	seen := make(map[string]int, len(stat))
	for _, s := range stat {
		path := stripGitPathPrefix(s.Path, pathPrefix)
		idx := len(out)
		out = append(out, GitDiffFile{
			Path:    path,
			OldPath: stripGitPathPrefix(s.OldPath, pathPrefix),
			Added:   s.Added,
			Removed: s.Removed,
			Binary:  s.Binary,
			Status:  "M",
		})
		seen[path] = idx
	}
	for _, n := range names {
		path := stripGitPathPrefix(n.Path, pathPrefix)
		i, ok := seen[path]
		if !ok {
			continue
		}
		out[i].Status = n.Status
		if n.OldPath != "" {
			out[i].OldPath = stripGitPathPrefix(n.OldPath, pathPrefix)
		}
	}
	for _, d := range diffs {
		path := stripGitPathPrefix(d.Path, pathPrefix)
		i, ok := seen[path]
		if !ok {
			continue
		}
		out[i].Diff = d.Lines
	}
	for _, path := range untracked {
		out = append(out, GitDiffFile{Path: stripGitPathPrefix(path, pathPrefix), Status: "?"})
	}
	return out, nil
}

func isGitRepo(root string) bool {
	out, err := runGit(root, "rev-parse", "--is-inside-work-tree")
	return err == nil && strings.TrimSpace(string(out)) == "true"
}

func gitHasHead(root string) bool {
	_, err := runGit(root, "rev-parse", "--verify", "HEAD")
	return err == nil
}

func gitPathPrefix(root string) string {
	out, err := runGit(root, "rev-parse", "--show-prefix")
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func stripGitPathPrefix(path, prefix string) string {
	if path == "" || prefix == "" {
		return path
	}
	prefix = strings.TrimSuffix(prefix, "/") + "/"
	return strings.TrimPrefix(path, prefix)
}

func runGit(root string, args ...string) ([]byte, error) {
	cmd := exec.Command("git", args...)
	cmd.Dir = root
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return stdout.Bytes(), fmt.Errorf("git %s: %w: %s", strings.Join(args, " "), err, strings.TrimSpace(stderr.String()))
	}
	return stdout.Bytes(), nil
}

func gitUntrackedFiles(root string) ([]string, error) {
	out, err := runGit(root, "ls-files", "--others", "--exclude-standard", "-z")
	if err != nil {
		return nil, err
	}
	parts := bytes.Split(out, []byte{0})
	res := make([]string, 0, len(parts))
	for _, p := range parts {
		if len(p) == 0 {
			continue
		}
		res = append(res, string(p))
	}
	return res, nil
}

type numstatEntry struct {
	Path    string
	OldPath string
	Added   int
	Removed int
	Binary  bool
}

func gitDiffCommandArgs(hasHead bool, tail ...string) []string {
	args := []string{"diff"}
	if hasHead {
		args = append(args, "HEAD")
	} else {
		args = append(args, "--cached")
	}
	args = append(args, tail...)
	return args
}

func gitDiffNumstat(root string, hasHead bool) ([]numstatEntry, error) {
	out, err := runGit(root, gitDiffCommandArgs(hasHead, "--numstat", "-z", "--no-color")...)
	if err != nil {
		return nil, err
	}
	// Output format with -z is:
	//   added\tremoved\tpath\0
	// or, for renames:
	//   added\tremoved\t\0oldpath\0newpath\0
	res := []numstatEntry{}
	data := out
	for len(data) > 0 {
		// Read until first NUL (one "record").
		idx := bytes.IndexByte(data, 0)
		if idx < 0 {
			break
		}
		head := string(data[:idx])
		data = data[idx+1:]
		fields := strings.SplitN(head, "\t", 3)
		if len(fields) < 3 {
			continue
		}
		entry := numstatEntry{}
		if fields[0] == "-" || fields[1] == "-" {
			entry.Binary = true
		} else {
			entry.Added, _ = atoiSafe(fields[0])
			entry.Removed, _ = atoiSafe(fields[1])
		}
		if fields[2] == "" {
			// Rename: the next two NUL-terminated entries are oldPath, newPath.
			oldIdx := bytes.IndexByte(data, 0)
			if oldIdx < 0 {
				break
			}
			entry.OldPath = string(data[:oldIdx])
			data = data[oldIdx+1:]
			newIdx := bytes.IndexByte(data, 0)
			if newIdx < 0 {
				break
			}
			entry.Path = string(data[:newIdx])
			data = data[newIdx+1:]
		} else {
			entry.Path = fields[2]
		}
		res = append(res, entry)
	}
	return res, nil
}

type namestatusEntry struct {
	Path    string
	OldPath string
	Status  string
}

func gitDiffNameStatus(root string, hasHead bool) ([]namestatusEntry, error) {
	out, err := runGit(root, gitDiffCommandArgs(hasHead, "--name-status", "-z", "--no-color")...)
	if err != nil {
		return nil, err
	}
	res := []namestatusEntry{}
	fields := bytes.Split(out, []byte{0})
	for i := 0; i < len(fields); {
		if len(fields[i]) == 0 {
			i++
			continue
		}
		statusRaw := string(fields[i])
		i++
		status := string(statusRaw[0])
		if status == "R" || status == "C" {
			if i+1 >= len(fields) {
				break
			}
			oldPath := string(fields[i])
			newPath := string(fields[i+1])
			i += 2
			res = append(res, namestatusEntry{Path: newPath, OldPath: oldPath, Status: status})
		} else {
			if i >= len(fields) {
				break
			}
			path := string(fields[i])
			i++
			res = append(res, namestatusEntry{Path: path, Status: status})
		}
	}
	return res, nil
}

type unifiedDiff struct {
	Path  string
	Lines []GitDiffLine
}

func gitDiffUnified(root string, hasHead bool) ([]unifiedDiff, error) {
	out, err := runGit(root, gitDiffCommandArgs(hasHead, "--no-color", "--unified=3")...)
	if err != nil {
		return nil, err
	}
	return parseUnifiedDiff(out), nil
}

// parseUnifiedDiff turns a `git diff` blob into per-file structured line lists.
// Binary patches are surfaced as empty Lines on the matching file entry.
func parseUnifiedDiff(out []byte) []unifiedDiff {
	res := []unifiedDiff{}
	lines := strings.Split(string(out), "\n")
	var current *unifiedDiff
	inHunk := false
	for i := 0; i < len(lines); i++ {
		line := lines[i]
		if strings.HasPrefix(line, "diff --git ") {
			if current != nil {
				res = append(res, *current)
			}
			path := extractDiffPath(line)
			current = &unifiedDiff{Path: path, Lines: nil}
			inHunk = false
			continue
		}
		if current == nil {
			continue
		}
		if strings.HasPrefix(line, "+++ ") {
			// `+++ b/<path>` — refine path from this header. Skip dev/null.
			rest := strings.TrimPrefix(line, "+++ ")
			if rest != "/dev/null" {
				if strings.HasPrefix(rest, "b/") {
					rest = rest[2:]
				}
				if rest != "" {
					current.Path = rest
				}
			}
			continue
		}
		if strings.HasPrefix(line, "@@") {
			inHunk = true
			current.Lines = append(current.Lines, GitDiffLine{Kind: "hunk", Text: line})
			continue
		}
		if !inHunk {
			continue
		}
		if len(line) == 0 {
			continue
		}
		switch line[0] {
		case '+':
			current.Lines = append(current.Lines, GitDiffLine{Kind: "add", Text: line[1:]})
		case '-':
			current.Lines = append(current.Lines, GitDiffLine{Kind: "del", Text: line[1:]})
		case ' ':
			current.Lines = append(current.Lines, GitDiffLine{Kind: "ctx", Text: line[1:]})
		default:
			// "\ No newline at end of file" etc. — ignore.
		}
	}
	if current != nil {
		res = append(res, *current)
	}
	return res
}

func extractDiffPath(header string) string {
	// header: `diff --git a/<path> b/<path>` — return the b-path.
	idx := strings.Index(header, " b/")
	if idx < 0 {
		return ""
	}
	return strings.TrimSpace(header[idx+3:])
}

func atoiSafe(s string) (int, error) {
	n := 0
	for _, ch := range s {
		if ch < '0' || ch > '9' {
			return 0, errors.New("not a number")
		}
		n = n*10 + int(ch-'0')
	}
	return n, nil
}

// maxFileReadBytes is the upper bound for ReadProjectFile. Anything larger is
// truncated. Keeps the drawer responsive on big files.
const maxFileReadBytes = 512 * 1024 // 512 KiB

// ProjectFileContent is the response shape for ReadProjectFile.
type ProjectFileContent struct {
	Path      string `json:"path"`
	Content   string `json:"content"`
	Size      int64  `json:"size"`
	Truncated bool   `json:"truncated"`
	Binary    bool   `json:"binary"`
}

// ReadProjectFile reads a file inside a project's workdir. The path must be
// project-relative; absolute paths and path traversal segments (`..`) are
// rejected so the daemon can't be tricked into reading arbitrary disk paths.
// Binary content is detected and refused (Content stays empty).
func (a *App) ReadProjectFile(projectID, relPath string) (ProjectFileContent, error) {
	project, err := a.store.GetProject(projectID)
	if err != nil {
		return ProjectFileContent{}, a.mapError(err)
	}
	root := strings.TrimSpace(project.Workdir)
	if root == "" {
		return ProjectFileContent{}, ErrBadRequest
	}
	clean := strings.TrimSpace(relPath)
	if clean == "" {
		return ProjectFileContent{}, ErrBadRequest
	}
	// Agents frequently call read/write tools with absolute paths (e.g.
	// `/Users/me/proj/src/foo.js`). Accept both forms: if absolute, the path
	// is required to live inside the workdir; if relative, it's joined onto
	// the workdir. Either way the final path is validated against `root` so
	// the daemon can't be tricked into reading arbitrary disk locations.
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return ProjectFileContent{}, err
	}
	realRoot, err := filepath.EvalSymlinks(absRoot)
	if err != nil {
		return ProjectFileContent{}, err
	}
	var absFile string
	if filepath.IsAbs(clean) {
		absFile, err = filepath.Abs(clean)
		if err != nil {
			return ProjectFileContent{}, err
		}
	} else {
		for _, seg := range strings.Split(filepath.ToSlash(clean), "/") {
			if seg == ".." {
				return ProjectFileContent{}, ErrBadRequest
			}
		}
		absFile, err = filepath.Abs(filepath.Join(absRoot, clean))
		if err != nil {
			return ProjectFileContent{}, err
		}
	}
	rel, err := filepath.Rel(absRoot, absFile)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return ProjectFileContent{}, ErrBadRequest
	}
	realFile, err := filepath.EvalSymlinks(absFile)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return ProjectFileContent{}, ErrNotFound
		}
		return ProjectFileContent{}, err
	}
	realRel, err := filepath.Rel(realRoot, realFile)
	if err != nil || realRel == ".." || strings.HasPrefix(realRel, ".."+string(filepath.Separator)) {
		return ProjectFileContent{}, ErrBadRequest
	}

	info, err := os.Stat(realFile)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return ProjectFileContent{}, ErrNotFound
		}
		return ProjectFileContent{}, err
	}
	if info.IsDir() {
		return ProjectFileContent{}, ErrBadRequest
	}

	// Open the symlink-resolved path so a TOCTOU swap between EvalSymlinks
	// and Open can't pivot us to a file outside realRoot.
	f, err := os.Open(realFile)
	if err != nil {
		return ProjectFileContent{}, err
	}
	defer f.Close()

	// Read up to maxFileReadBytes + 1 so we can tell whether the file was
	// truncated.
	buf := make([]byte, maxFileReadBytes+1)
	n, err := readUpTo(f, buf)
	if err != nil {
		return ProjectFileContent{}, err
	}
	data := buf[:n]
	truncated := n > maxFileReadBytes
	if truncated {
		data = data[:maxFileReadBytes]
	}

	res := ProjectFileContent{
		Path:      filepath.ToSlash(rel),
		Size:      info.Size(),
		Truncated: truncated,
	}
	if isLikelyBinary(data) {
		res.Binary = true
		return res, nil
	}
	res.Content = string(data)
	return res, nil
}

// readUpTo reads up to len(buf) bytes from f, treating EOF as a normal stop.
// Returns the number of bytes actually read.
func readUpTo(f *os.File, buf []byte) (int, error) {
	total := 0
	for total < len(buf) {
		n, err := f.Read(buf[total:])
		total += n
		if err != nil {
			if errors.Is(err, io.EOF) {
				return total, nil
			}
			return total, err
		}
	}
	return total, nil
}

// isLikelyBinary uses two cheap heuristics: presence of a NUL byte (essentially
// a guarantee), or a high fraction of non-UTF8 invalid bytes / control chars.
func isLikelyBinary(data []byte) bool {
	if bytes.IndexByte(data, 0) >= 0 {
		return true
	}
	if !utf8.Valid(data) {
		return true
	}
	control := 0
	for _, b := range data {
		if b < 0x09 || (b > 0x0d && b < 0x20) {
			control++
		}
	}
	// More than 1% non-printable control bytes → call it binary.
	if len(data) > 0 && control*100/len(data) > 1 {
		return true
	}
	return false
}

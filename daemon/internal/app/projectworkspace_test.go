package app

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func runGitForTest(t *testing.T, root string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = root
	cmd.Env = []string{
		"HOME=" + t.TempDir(),
		"GIT_AUTHOR_NAME=Test",
		"GIT_AUTHOR_EMAIL=test@example.com",
		"GIT_COMMITTER_NAME=Test",
		"GIT_COMMITTER_EMAIL=test@example.com",
		"PATH=" + os.Getenv("PATH"),
	}
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %s: %v: %s", strings.Join(args, " "), err, string(out))
	}
}

func writeAt(t *testing.T, root, rel, body string) {
	t.Helper()
	full := filepath.Join(root, rel)
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatalf("mkdir parent of %s: %v", rel, err)
	}
	if err := os.WriteFile(full, []byte(body), 0o644); err != nil {
		t.Fatalf("write %s: %v", rel, err)
	}
}

func TestParseUnifiedDiffSplitsFilesAndKinds(t *testing.T) {
	raw := `diff --git a/src/foo.js b/src/foo.js
index e69de29..b6fc4c6 100644
--- a/src/foo.js
+++ b/src/foo.js
@@ -1,2 +1,3 @@
 const x = 1;
-const y = 2;
+const y = 22;
+const z = 3;
diff --git a/README.md b/README.md
new file mode 100644
index 0000000..f1d2d2f
--- /dev/null
+++ b/README.md
@@ -0,0 +1,2 @@
+hello
+world
`
	files := parseUnifiedDiff([]byte(raw))
	if len(files) != 2 {
		t.Fatalf("expected 2 files, got %d", len(files))
	}
	if files[0].Path != "src/foo.js" {
		t.Fatalf("expected first path src/foo.js, got %q", files[0].Path)
	}
	want := []struct{ kind, text string }{
		{"hunk", "@@ -1,2 +1,3 @@"},
		{"ctx", "const x = 1;"},
		{"del", "const y = 2;"},
		{"add", "const y = 22;"},
		{"add", "const z = 3;"},
	}
	if len(files[0].Lines) != len(want) {
		t.Fatalf("file 0 line count: want %d got %d (%#v)", len(want), len(files[0].Lines), files[0].Lines)
	}
	for i, w := range want {
		got := files[0].Lines[i]
		if got.Kind != w.kind || got.Text != w.text {
			t.Fatalf("file 0 line %d: want %s/%q got %s/%q", i, w.kind, w.text, got.Kind, got.Text)
		}
	}
	if files[1].Path != "README.md" {
		t.Fatalf("expected second path README.md, got %q", files[1].Path)
	}
}

func TestIsLikelyBinaryDetectsNullByte(t *testing.T) {
	if !isLikelyBinary([]byte{0x68, 0x00, 0x69}) {
		t.Fatalf("expected NUL-containing data to be flagged as binary")
	}
	if isLikelyBinary([]byte("hello\nworld\n")) {
		t.Fatalf("plain text should not be flagged as binary")
	}
}

func TestGitDiffReportsWorkingTreeChanges(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not installed")
	}

	a := newOptimizerTestApp(t)
	agentID := firstAgentID(t, a)

	workdir := t.TempDir()
	writeAt(t, workdir, "src/foo.js", "const x = 1;\nconst y = 2;\n")
	runGitForTest(t, workdir, "init", "-q", "-b", "main")
	runGitForTest(t, workdir, "add", ".")
	runGitForTest(t, workdir, "commit", "-q", "-m", "initial")
	writeAt(t, workdir, "src/foo.js", "const x = 1;\nconst y = 22;\nconst z = 3;\n")
	writeAt(t, workdir, "NEW.md", "new file\n")

	project, err := a.CreateProject("Git Project", workdir, agentID)
	if err != nil {
		t.Fatalf("create project: %v", err)
	}

	files, err := a.GitDiff(project.ID)
	if err != nil {
		t.Fatalf("GitDiff: %v", err)
	}
	byPath := map[string]GitDiffFile{}
	for _, f := range files {
		byPath[f.Path] = f
	}
	tracked, ok := byPath["src/foo.js"]
	if !ok {
		t.Fatalf("expected src/foo.js in diff, got %v", byPath)
	}
	if tracked.Status != "M" {
		t.Fatalf("expected status M for modified file, got %q", tracked.Status)
	}
	if tracked.Added < 1 || tracked.Removed < 1 {
		t.Fatalf("expected nonzero added+removed, got +%d -%d", tracked.Added, tracked.Removed)
	}
	if len(tracked.Diff) == 0 {
		t.Fatalf("expected unified diff lines, got none")
	}
	untracked, ok := byPath["NEW.md"]
	if !ok {
		t.Fatalf("expected NEW.md in diff (untracked), got %v", byPath)
	}
	if untracked.Status != "?" {
		t.Fatalf("expected status ? for untracked, got %q", untracked.Status)
	}
}

func TestGitDiffReportsTrackedStatuses(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not installed")
	}

	a := newOptimizerTestApp(t)
	agentID := firstAgentID(t, a)

	workdir := t.TempDir()
	writeAt(t, workdir, "deleted.txt", "delete me\n")
	writeAt(t, workdir, "renamed.txt", "rename me\n")
	runGitForTest(t, workdir, "init", "-q", "-b", "main")
	runGitForTest(t, workdir, "add", ".")
	runGitForTest(t, workdir, "commit", "-q", "-m", "initial")
	writeAt(t, workdir, "added.txt", "new file\n")
	runGitForTest(t, workdir, "add", "added.txt")
	if err := os.Remove(filepath.Join(workdir, "deleted.txt")); err != nil {
		t.Fatalf("remove deleted.txt: %v", err)
	}
	runGitForTest(t, workdir, "mv", "renamed.txt", "renamed-new.txt")

	project, err := a.CreateProject("Git Project", workdir, agentID)
	if err != nil {
		t.Fatalf("create project: %v", err)
	}

	files, err := a.GitDiff(project.ID)
	if err != nil {
		t.Fatalf("GitDiff: %v", err)
	}
	byPath := map[string]GitDiffFile{}
	for _, f := range files {
		byPath[f.Path] = f
	}
	if got := byPath["added.txt"].Status; got != "A" {
		t.Fatalf("added status: want A got %q", got)
	}
	if got := byPath["deleted.txt"].Status; got != "D" {
		t.Fatalf("deleted status: want D got %q", got)
	}
	renamed := byPath["renamed-new.txt"]
	if renamed.Status != "R" {
		t.Fatalf("renamed status: want R got %q", renamed.Status)
	}
	if renamed.OldPath != "renamed.txt" {
		t.Fatalf("renamed old path: want renamed.txt got %q", renamed.OldPath)
	}
}

func TestGitDiffWorksInEmptyRepo(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not installed")
	}

	a := newOptimizerTestApp(t)
	agentID := firstAgentID(t, a)

	workdir := t.TempDir()
	runGitForTest(t, workdir, "init", "-q", "-b", "main")
	writeAt(t, workdir, "NEW.md", "new file\n")

	project, err := a.CreateProject("Empty Git Project", workdir, agentID)
	if err != nil {
		t.Fatalf("create project: %v", err)
	}

	files, err := a.GitDiff(project.ID)
	if err != nil {
		t.Fatalf("GitDiff: %v", err)
	}
	if len(files) != 1 || files[0].Path != "NEW.md" || files[0].Status != "?" {
		t.Fatalf("expected one untracked file, got %#v", files)
	}
}

func TestGitDiffWorksFromRepoSubdirectory(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not installed")
	}

	a := newOptimizerTestApp(t)
	agentID := firstAgentID(t, a)

	repo := t.TempDir()
	workdir := filepath.Join(repo, "sub")
	writeAt(t, repo, "sub/file.txt", "before\n")
	writeAt(t, repo, "other/file.txt", "before\n")
	runGitForTest(t, repo, "init", "-q", "-b", "main")
	runGitForTest(t, repo, "add", ".")
	runGitForTest(t, repo, "commit", "-q", "-m", "initial")
	writeAt(t, repo, "sub/file.txt", "after\n")
	writeAt(t, repo, "sub/new.txt", "new\n")
	writeAt(t, repo, "other/file.txt", "after\n")
	writeAt(t, repo, "other/new.txt", "new\n")

	project, err := a.CreateProject("Subdir Git Project", workdir, agentID)
	if err != nil {
		t.Fatalf("create project: %v", err)
	}

	files, err := a.GitDiff(project.ID)
	if err != nil {
		t.Fatalf("GitDiff: %v", err)
	}
	byPath := map[string]GitDiffFile{}
	for _, f := range files {
		byPath[f.Path] = f
	}
	if len(byPath) != 2 {
		t.Fatalf("expected only subdir changes, got %#v", files)
	}
	if got := byPath["file.txt"].Status; got != "M" {
		t.Fatalf("expected modified file relative to subdir, got %#v", files)
	}
	if got := byPath["new.txt"].Status; got != "?" {
		t.Fatalf("expected untracked file relative to subdir, got %#v", files)
	}
	if _, ok := byPath["other/file.txt"]; ok {
		t.Fatalf("expected outer repo changes to be excluded, got %#v", files)
	}
}

func TestGitDiffErrorsWhenNotARepo(t *testing.T) {
	a := newOptimizerTestApp(t)
	agentID := firstAgentID(t, a)

	workdir := t.TempDir()
	writeAt(t, workdir, "README.md", "hi\n")

	project, err := a.CreateProject("Non-Git", workdir, agentID)
	if err != nil {
		t.Fatalf("create project: %v", err)
	}

	if _, err := a.GitDiff(project.ID); err == nil {
		t.Fatalf("expected error for non-git project")
	}
}

func TestReadProjectFileReturnsContent(t *testing.T) {
	a := newOptimizerTestApp(t)
	agentID := firstAgentID(t, a)

	workdir := t.TempDir()
	writeAt(t, workdir, "src/hello.txt", "hello, world!\n")

	project, err := a.CreateProject("Read Project", workdir, agentID)
	if err != nil {
		t.Fatalf("create project: %v", err)
	}

	res, err := a.ReadProjectFile(project.ID, "src/hello.txt")
	if err != nil {
		t.Fatalf("ReadProjectFile: %v", err)
	}
	if res.Content != "hello, world!\n" {
		t.Fatalf("unexpected content: %q", res.Content)
	}
	if res.Binary || res.Truncated {
		t.Fatalf("expected binary=false truncated=false, got %#v", res)
	}
}

func TestReadProjectFileRejectsTraversal(t *testing.T) {
	a := newOptimizerTestApp(t)
	agentID := firstAgentID(t, a)

	workdir := t.TempDir()
	writeAt(t, workdir, "ok.txt", "ok\n")

	project, err := a.CreateProject("Trav Project", workdir, agentID)
	if err != nil {
		t.Fatalf("create project: %v", err)
	}

	for _, bad := range []string{"../etc/passwd", "/etc/passwd", "src/../../etc/passwd"} {
		if _, err := a.ReadProjectFile(project.ID, bad); err == nil {
			t.Fatalf("expected error reading %q, got nil", bad)
		}
	}
}

func TestReadProjectFileRejectsSymlinkEscape(t *testing.T) {
	a := newOptimizerTestApp(t)
	agentID := firstAgentID(t, a)

	workdir := t.TempDir()
	outside := t.TempDir()
	writeAt(t, outside, "secret.txt", "secret\n")
	if err := os.Symlink(filepath.Join(outside, "secret.txt"), filepath.Join(workdir, "link.txt")); err != nil {
		t.Skipf("symlink not available: %v", err)
	}

	project, err := a.CreateProject("Symlink Project", workdir, agentID)
	if err != nil {
		t.Fatalf("create project: %v", err)
	}

	if _, err := a.ReadProjectFile(project.ID, "link.txt"); err == nil {
		t.Fatalf("expected error reading symlink that points outside workdir")
	}
}

func TestReadProjectFileTruncatesLargeFile(t *testing.T) {
	a := newOptimizerTestApp(t)
	agentID := firstAgentID(t, a)

	workdir := t.TempDir()
	big := strings.Repeat("abcd", maxFileReadBytes/4+100)
	writeAt(t, workdir, "big.txt", big)

	project, err := a.CreateProject("Big Project", workdir, agentID)
	if err != nil {
		t.Fatalf("create project: %v", err)
	}

	res, err := a.ReadProjectFile(project.ID, "big.txt")
	if err != nil {
		t.Fatalf("ReadProjectFile: %v", err)
	}
	if !res.Truncated {
		t.Fatalf("expected truncated=true")
	}
	if len(res.Content) != maxFileReadBytes {
		t.Fatalf("expected len(content) == %d, got %d", maxFileReadBytes, len(res.Content))
	}
}

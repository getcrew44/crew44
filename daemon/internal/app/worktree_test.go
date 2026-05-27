package app

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/getcrew44/crew44/daemon/internal/model"
)

func boolPtr(b bool) *bool { return &b }

// gitProject initializes a git repo at workdir with one commit on main and
// registers it as a crew44 project rooted at projectRoot (which may be a
// subdirectory of the repo to exercise prefix mapping).
func gitProject(t *testing.T, a *App, agentID, repoRoot, projectRoot string) model.ProjectRecord {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not installed")
	}
	writeAt(t, repoRoot, "README.md", "hello\n")
	runGitForTest(t, repoRoot, "init", "-q", "-b", "main")
	runGitForTest(t, repoRoot, "add", ".")
	runGitForTest(t, repoRoot, "commit", "-q", "-m", "initial")
	project, err := a.CreateProject("Git Project", projectRoot, agentID)
	if err != nil {
		t.Fatalf("create project: %v", err)
	}
	return project
}

func TestCreateChatProvisionsWorktree(t *testing.T) {
	a := newOptimizerTestApp(t)
	agentID := firstAgentID(t, a)
	repo := t.TempDir()
	project := gitProject(t, a, agentID, repo, repo)

	chat, err := a.CreateChat(project.ID, "first message", agentID, boolPtr(true), "")
	if err != nil {
		t.Fatalf("CreateChat: %v", err)
	}
	if chat.Worktree == nil {
		t.Fatal("expected a worktree binding")
	}
	wt := chat.Worktree
	if want := "crew/" + shortID(chat.ID); wt.Branch != want {
		t.Fatalf("branch: want %q got %q", want, wt.Branch)
	}
	if wt.BaseRef != "main" {
		t.Fatalf("base ref: want main got %q", wt.BaseRef)
	}
	if info, err := os.Stat(wt.Workdir); err != nil || !info.IsDir() {
		t.Fatalf("worktree workdir not a directory: %v", err)
	}
	// Runtime cwd resolution must point at the worktree, not the project root.
	got, err := a.resolveWorkdir(project.ID, chat.ID)
	if err != nil {
		t.Fatalf("resolveWorkdir: %v", err)
	}
	if got != wt.Workdir {
		t.Fatalf("resolveWorkdir: want %q got %q", wt.Workdir, got)
	}
}

func TestCreateChatHonorsSafeClientID(t *testing.T) {
	a := newOptimizerTestApp(t)
	agentID := firstAgentID(t, a)
	repo := t.TempDir()
	project := gitProject(t, a, agentID, repo, repo)

	const clientID = "0123abcd-4567-89ef-0123-456789abcdef"
	chat, err := a.CreateChat(project.ID, "first message", agentID, boolPtr(true), "", clientID)
	if err != nil {
		t.Fatalf("CreateChat: %v", err)
	}
	if chat.ID != clientID {
		t.Fatalf("chat ID: want %q got %q", clientID, chat.ID)
	}
	if want := "crew/" + shortID(clientID); chat.Worktree.Branch != want {
		t.Fatalf("branch: want %q got %q", want, chat.Worktree.Branch)
	}
}

func TestCreateChatRejectsUnsafeClientID(t *testing.T) {
	a := newOptimizerTestApp(t)
	agentID := firstAgentID(t, a)
	repo := t.TempDir()
	project := gitProject(t, a, agentID, repo, repo)

	// A traversal-laden ID must be ignored in favor of a freshly minted one.
	chat, err := a.CreateChat(project.ID, "first message", agentID, boolPtr(true), "", "../../etc/passwd")
	if err != nil {
		t.Fatalf("CreateChat: %v", err)
	}
	if chat.ID == "../../etc/passwd" {
		t.Fatal("unsafe client ID was accepted")
	}
}

func TestCreateChatExplicitWorktreeNonGitRejected(t *testing.T) {
	a := newOptimizerTestApp(t)
	agentID := firstAgentID(t, a)
	project, err := a.CreateProject("Plain", t.TempDir(), agentID)
	if err != nil {
		t.Fatalf("create project: %v", err)
	}
	if _, err := a.CreateChat(project.ID, "x", agentID, boolPtr(true), ""); err == nil {
		t.Fatal("expected error creating worktree chat in a non-git project")
	}
}

func TestCreateChatDefaultWorktreeNonGitFallsBack(t *testing.T) {
	a := newOptimizerTestApp(t)
	agentID := firstAgentID(t, a)
	project, err := a.CreateProject("Plain", t.TempDir(), agentID)
	if err != nil {
		t.Fatalf("create project: %v", err)
	}
	if _, err := a.UpdateProject(model.ProjectRecord{ID: project.ID}, boolPtr(true)); err != nil {
		t.Fatalf("set default: %v", err)
	}
	// nil = use project default; a non-git workdir must silently skip the worktree.
	chat, err := a.CreateChat(project.ID, "x", agentID, nil, "")
	if err != nil {
		t.Fatalf("CreateChat: %v", err)
	}
	if chat.Worktree != nil {
		t.Fatal("expected no worktree on a non-git project default")
	}
}

func TestCreateChatWorktreeSubdirMapping(t *testing.T) {
	a := newOptimizerTestApp(t)
	agentID := firstAgentID(t, a)
	repo := t.TempDir()
	writeAt(t, repo, "pkg/app/main.go", "package main\n")
	project := gitProject(t, a, agentID, repo, filepath.Join(repo, "pkg/app"))

	chat, err := a.CreateChat(project.ID, "sub", agentID, boolPtr(true), "")
	if err != nil {
		t.Fatalf("CreateChat: %v", err)
	}
	wt := chat.Worktree
	if !strings.HasSuffix(filepath.ToSlash(wt.Workdir), "pkg/app") {
		t.Fatalf("expected workdir to keep the pkg/app subdir, got %q", wt.Workdir)
	}
	if wt.Workdir == wt.Path {
		t.Fatal("expected workdir to differ from the worktree root for a subdir project")
	}
}

func TestWorktreeBranchRenamedOnTitle(t *testing.T) {
	a := newOptimizerTestApp(t)
	agentID := firstAgentID(t, a)
	repo := t.TempDir()
	project := gitProject(t, a, agentID, repo, repo)

	chat, err := a.CreateChat(project.ID, "raw first message", agentID, boolPtr(true), "")
	if err != nil {
		t.Fatalf("CreateChat: %v", err)
	}
	placeholder := chat.Worktree.Branch

	updated, changed, err := a.applyAutoChatTitle(chat.ID, "Refactor the login flow now")
	if err != nil || !changed {
		t.Fatalf("applyAutoChatTitle: changed=%v err=%v", changed, err)
	}
	if updated.Worktree.Branch == placeholder {
		t.Fatal("branch was not renamed")
	}
	if want := "crew/refactor-the-login-flow"; updated.Worktree.Branch != want {
		t.Fatalf("renamed branch: want %q got %q", want, updated.Worktree.Branch)
	}
	if !gitBranchExists(updated.Worktree.Path, updated.Worktree.Branch) {
		t.Fatalf("renamed branch %q does not exist in the worktree", updated.Worktree.Branch)
	}
}

func TestGitInfoReportsBranches(t *testing.T) {
	a := newOptimizerTestApp(t)
	agentID := firstAgentID(t, a)
	repo := t.TempDir()
	project := gitProject(t, a, agentID, repo, repo)
	runGitForTest(t, repo, "branch", "develop")

	info, err := a.GitInfo(project.ID)
	if err != nil {
		t.Fatalf("GitInfo: %v", err)
	}
	if !info.IsGitRepo || info.CurrentBranch != "main" {
		t.Fatalf("unexpected git info: %+v", info)
	}
	if !contains(info.Branches, "main") || !contains(info.Branches, "develop") {
		t.Fatalf("expected main and develop in branches, got %v", info.Branches)
	}

	plain, err := a.CreateProject("Plain", t.TempDir(), agentID)
	if err != nil {
		t.Fatalf("create plain project: %v", err)
	}
	if info, _ := a.GitInfo(plain.ID); info.IsGitRepo {
		t.Fatal("non-git project should report is_git_repo=false")
	}
}

func TestDeleteProjectRemovesWorktrees(t *testing.T) {
	a := newOptimizerTestApp(t)
	agentID := firstAgentID(t, a)
	repo := t.TempDir()
	project := gitProject(t, a, agentID, repo, repo)

	chat, err := a.CreateChat(project.ID, "x", agentID, boolPtr(true), "")
	if err != nil {
		t.Fatalf("CreateChat: %v", err)
	}
	if err := a.DeleteProject(project.ID); err != nil {
		t.Fatalf("DeleteProject: %v", err)
	}
	out, err := runGit(repo, "worktree", "list", "--porcelain")
	if err != nil {
		t.Fatalf("git worktree list: %v", err)
	}
	if strings.Contains(string(out), chat.Worktree.Path) {
		t.Fatalf("worktree still registered after project delete:\n%s", out)
	}
}

func contains(s []string, want string) bool {
	for _, v := range s {
		if v == want {
			return true
		}
	}
	return false
}

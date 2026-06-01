package store

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/getcrew44/crew44/daemon/internal/model"
)

// CommitAgentInstall must produce source/, recruited-skills.json, and
// config.json atomically. With no previous install, the staging
// artifacts simply rename into place.
func TestCommitAgentInstallFreshInstall(t *testing.T) {
	s, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	agentID := "abc"
	installID := "inst1"
	stageInstall(t, s, agentID, installID, "v1 source", []model.RecruitedSkill{{Name: "a", Path: "skills/a/SKILL.md", SourcePath: "/x/skills/a/SKILL.md", Version: "1"}})

	agent := model.AgentConfig{ID: agentID, Name: "X", Source: &model.AgentSource{Version: "1.0.0", SourceDir: s.AgentSourceDir(agentID)}}
	if err := s.CommitAgentInstall(agent, installID); err != nil {
		t.Fatal(err)
	}
	// source/ has the staged payload.
	data, err := os.ReadFile(filepath.Join(s.AgentSourceDir(agentID), "INSTRUCTIONS.md"))
	if err != nil || string(data) != "v1 source" {
		t.Fatalf("source INSTRUCTIONS.md = %q, err=%v", data, err)
	}
	// recruited-skills.json moved into place.
	if _, err := os.Stat(s.RecruitedSkillsPath(agentID)); err != nil {
		t.Fatalf("recruited-skills.json missing: %v", err)
	}
	// config.json holds the AgentConfig we passed in.
	got, err := s.GetAgent(agentID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Name != "X" {
		t.Fatalf("config.Name = %q", got.Name)
	}
	// Staging artifacts are consumed.
	if _, err := os.Stat(s.AgentSourceTmpDir(agentID, installID)); err == nil {
		t.Fatal("staging source dir should have been consumed")
	}
	// No .prev parked anywhere.
	if _, err := os.Stat(s.AgentSourcePrevDir(agentID)); err == nil {
		t.Fatal("source.prev should be removed after a successful fresh install")
	}
}

// A subsequent install moves the previous source/ to source.prev/,
// applies the new payload + config, then sweeps source.prev/ — all in
// one commit.
func TestCommitAgentInstallReinstallSwapsAtomically(t *testing.T) {
	s, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	agentID := "abc"
	// First install at v1.
	stageInstall(t, s, agentID, "i1", "v1 source", nil)
	v1 := model.AgentConfig{ID: agentID, Name: "X", Source: &model.AgentSource{Version: "1.0.0", SourceDir: s.AgentSourceDir(agentID)}}
	if err := s.CommitAgentInstall(v1, "i1"); err != nil {
		t.Fatal(err)
	}

	// Reinstall at v2.
	stageInstall(t, s, agentID, "i2", "v2 source", []model.RecruitedSkill{{Name: "a", Path: "skills/a/SKILL.md", SourcePath: "/x/skills/a/SKILL.md"}})
	v2 := model.AgentConfig{ID: agentID, Name: "X", Source: &model.AgentSource{Version: "2.0.0", SourceDir: s.AgentSourceDir(agentID)}}
	if err := s.CommitAgentInstall(v2, "i2"); err != nil {
		t.Fatal(err)
	}
	body, _ := os.ReadFile(filepath.Join(s.AgentSourceDir(agentID), "INSTRUCTIONS.md"))
	if string(body) != "v2 source" {
		t.Fatalf("source INSTRUCTIONS.md = %q, want v2", body)
	}
	got, _ := s.GetAgent(agentID)
	if got.Source.Version != "2.0.0" {
		t.Fatalf("config version = %q", got.Source.Version)
	}
	if _, err := os.Stat(s.AgentSourcePrevDir(agentID)); err == nil {
		t.Fatal("source.prev should be cleaned up after commit")
	}
}

// When a mid-commit rename fails (here forced by chmodding the agent
// dir read-only after the v1 commit succeeded), the rollback path must
// restore the previous source/, recruited-skills.json, and config.json.
func TestCommitAgentInstallRollsBackOnRenameFailure(t *testing.T) {
	s, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	agentID := "abc"
	stageInstall(t, s, agentID, "i1", "v1 source", []model.RecruitedSkill{{Name: "a", Path: "skills/a/SKILL.md", SourcePath: "/x/skills/a/SKILL.md", Version: "1.0.0"}})
	v1 := model.AgentConfig{ID: agentID, Name: "v1", Source: &model.AgentSource{Version: "1.0.0", SourceDir: s.AgentSourceDir(agentID)}}
	if err := s.CommitAgentInstall(v1, "i1"); err != nil {
		t.Fatal(err)
	}

	// Stage v2 then make the agent dir read-only. The first internal
	// rename CommitAgentInstall attempts is sourceDir → source.prev/,
	// which requires write perm on the agent dir; that fails so the
	// commit rolls back before any state changes.
	stageInstall(t, s, agentID, "i2", "v2 source", []model.RecruitedSkill{{Name: "a", Path: "skills/a/SKILL.md", SourcePath: "/x/skills/a/SKILL.md", Version: "2.0.0"}})
	agentDir := s.AgentDir(agentID)
	if err := os.Chmod(agentDir, 0o555); err != nil {
		t.Fatal(err)
	}
	defer os.Chmod(agentDir, 0o755)

	v2 := model.AgentConfig{ID: agentID, Name: "v2", Source: &model.AgentSource{Version: "2.0.0", SourceDir: s.AgentSourceDir(agentID)}}
	if err := s.CommitAgentInstall(v2, "i2"); err == nil {
		t.Fatal("expected commit to fail because agent dir is read-only")
	}

	// Restore write perms before reading back state.
	os.Chmod(agentDir, 0o755)

	body, readErr := os.ReadFile(filepath.Join(s.AgentSourceDir(agentID), "INSTRUCTIONS.md"))
	if readErr != nil {
		t.Fatalf("source INSTRUCTIONS.md missing after rollback: %v", readErr)
	}
	if string(body) != "v1 source" {
		t.Fatalf("source rolled forward despite failure: %q", body)
	}
	got, err := s.GetAgent(agentID)
	if err != nil {
		t.Fatalf("config missing after rollback: %v", err)
	}
	if got.Name != "v1" {
		t.Fatalf("config rolled forward: Name = %q, want v1", got.Name)
	}
	skills, err := s.LoadRecruitedSkills(agentID)
	if err != nil {
		t.Fatal(err)
	}
	if len(skills) != 1 || skills[0].Version != "1.0.0" {
		t.Fatalf("recruited-skills rolled forward: %+v", skills)
	}
}

// stageInstall populates the staging files CommitAgentInstall expects.
// Mirrors what ExtractFilteredPayload + WriteRecruitedSkillsTmp produce
// during a real install but bypasses the HTTP and tar machinery so
// store-level tests stay focused.
func stageInstall(t *testing.T, s *Store, agentID, installID, agentBody string, skills []model.RecruitedSkill) {
	t.Helper()
	staged := s.AgentSourceTmpDir(agentID, installID)
	if err := os.MkdirAll(staged, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(staged, "INSTRUCTIONS.md"), []byte(agentBody), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := s.WriteRecruitedSkillsTmp(agentID, installID, skills); err != nil {
		t.Fatal(err)
	}
}

// Loaded recruited skills should round-trip the on-disk record exactly.
func TestLoadRecruitedSkillsRoundTrip(t *testing.T) {
	s, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	agentID := "abc"
	want := []model.RecruitedSkill{{Name: "writing", Path: "skills/writing/SKILL.md", SourcePath: "/agent/source/skills/writing/SKILL.md", Version: "1.0.0"}}
	stageInstall(t, s, agentID, "i", "body", want)
	agent := model.AgentConfig{ID: agentID, Name: "X", Source: &model.AgentSource{SourceDir: s.AgentSourceDir(agentID)}}
	if err := s.CommitAgentInstall(agent, "i"); err != nil {
		t.Fatal(err)
	}
	got, err := s.LoadRecruitedSkills(agentID)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0] != want[0] {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

// Sanity-check that LoadRecruitedSkills returns nil + no error when
// the file is missing, since the runtime path treats that as "no
// recruited skills" rather than an error.
func TestLoadRecruitedSkillsMissingReturnsEmpty(t *testing.T) {
	s, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	got, err := s.LoadRecruitedSkills("missing")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("got %v, want empty", got)
	}
}

func TestCommitAgentInstallRejectsMissingStaging(t *testing.T) {
	s, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	agent := model.AgentConfig{ID: "x", Source: &model.AgentSource{}}
	err = s.CommitAgentInstall(agent, "missing")
	if err == nil || !strings.Contains(err.Error(), "staged source missing") {
		t.Fatalf("expected staged source error, got %v", err)
	}

	// With staged source but no recruited-skills.json tmp, the staged
	// skills check fires.
	if err := os.MkdirAll(s.AgentSourceTmpDir("x", "missing"), 0o755); err != nil {
		t.Fatal(err)
	}
	err = s.CommitAgentInstall(agent, "missing")
	if err == nil || !strings.Contains(err.Error(), "staged recruited-skills.json missing") {
		t.Fatalf("expected staged skills error, got %v", err)
	}
}

// Sanity: ensure errors.Is still works against os.ErrNotExist for
// callers checking the LoadRecruitedSkills no-op return shape.
func TestLoadRecruitedSkillsErrNotExistNotPropagated(t *testing.T) {
	s, _ := New(t.TempDir())
	_, err := s.LoadRecruitedSkills("nope")
	if errors.Is(err, os.ErrNotExist) {
		t.Fatal("os.ErrNotExist should not be exposed to callers")
	}
}

package app

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/getcrew44/crew44/daemon/internal/model"
	"github.com/getcrew44/crew44/daemon/internal/recruit"
	"github.com/getcrew44/crew44/daemon/internal/runtime"
)

// fakeRegistry composes an httptest server that serves agents.json plus
// per-repo manifests and content files. Files are keyed by full request
// path so a test can both seed normal happy-path content and substitute
// "missing tag" or "missing AGENT.md" responses.
type fakeRegistry struct {
	t      *testing.T
	files  map[string]string
	missed map[string]int
}

func newFakeRegistry(t *testing.T) *fakeRegistry {
	return &fakeRegistry{t: t, files: map[string]string{}, missed: map[string]int{}}
}

func (f *fakeRegistry) set(path, body string) {
	f.files[path] = body
}

func (f *fakeRegistry) handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, ok := f.files[r.URL.Path]
		if !ok {
			f.missed[r.URL.Path]++
			w.WriteHeader(http.StatusNotFound)
			return
		}
		if strings.HasSuffix(r.URL.Path, ".json") {
			w.Header().Set("Content-Type", "application/json")
		}
		w.Write([]byte(body))
	})
}

func newRecruitTestApp(t *testing.T, srv *httptest.Server) *App {
	t.Helper()
	root := t.TempDir()
	client := recruit.NewClient(recruit.Config{
		RawBase:      srv.URL,
		RegistryRepo: "registry/test",
	})
	a, err := New(Config{
		StateDir:       filepath.Join(root, ".crew44"),
		RuntimeScanDir: filepath.Join(root, "runtime-manifests"),
		Scanner: runtime.StaticScanner{Records: []model.RuntimeRecord{{
			ID:         "runtime-mock",
			Provider:   "mock",
			Name:       "Mock Runtime",
			Status:     model.RuntimeStatusAvailable,
			BinaryPath: "builtin://mock",
			Version:    "test",
		}}},
		Engine:  runtime.MockEngine{},
		Recruit: client,
	})
	if err != nil {
		t.Fatal(err)
	}
	return a
}

// seedPatchAgent populates a happy-path fake repo for the "patch" agent
// at version 1.0.0 with one skill, plus registry entry.
func seedPatchAgent(f *fakeRegistry, version string) {
	headManifest := fmt.Sprintf(`{
		"schema_version":"crew44.agent.v1",
		"name":"Patch","version":"%s","description":"Reproduces bugs from reports.",
		"author":"hex.studio","tags":["testing"],
		"suggested_runtime":"claude",
		"skills":[{"name":"minimal-failing-test","path":"skills/minimal-failing-test/SKILL.md"}]
	}`, version)
	f.set("/registry/test/HEAD/agents.json", `{
		"schema_version":"crew44.agent-registry.v1",
		"agents":[{
			"id":"patch","name":"Patch",
			"description":"Reproduces bugs from reports.",
			"repo_url":"https://github.com/hex/patch-agent",
			"author":"hex.studio","tags":["testing"]
		}]
	}`)
	f.set("/hex/patch-agent/HEAD/crew44-agent.json", headManifest)
	f.set("/hex/patch-agent/HEAD/AGENT.md", "# Patch\nReproduces bugs.\n")
	tag := "v" + version
	f.set("/hex/patch-agent/"+tag+"/crew44-agent.json", headManifest)
	f.set("/hex/patch-agent/"+tag+"/AGENT.md", "# Patch\nReproduces bugs at "+version+".\n")
	f.set("/hex/patch-agent/"+tag+"/skills/minimal-failing-test/SKILL.md",
		"---\nname: minimal-failing-test\n---\n# Minimal failing test\nWrite the failing test first.\n")
}

func TestRecruitListMarksInstalled(t *testing.T) {
	f := newFakeRegistry(t)
	seedPatchAgent(f, "1.0.0")
	srv := httptest.NewServer(f.handler())
	defer srv.Close()
	a := newRecruitTestApp(t, srv)

	items, err := a.ListRecruitAgents(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].Installed {
		t.Fatalf("pre-install: expected one uninstalled item, got %+v", items)
	}
	if _, err := a.InstallRecruitAgent(context.Background(), "patch"); err != nil {
		t.Fatal(err)
	}
	// Invalidate the client cache so the second list re-fetches.
	a.recruit.InvalidateRegistry()
	items, err = a.ListRecruitAgents(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !items[0].Installed {
		t.Fatalf("post-install: expected installed=true, got %+v", items)
	}
}

func TestRecruitInstallCreatesAgentAndSkill(t *testing.T) {
	f := newFakeRegistry(t)
	seedPatchAgent(f, "1.0.0")
	srv := httptest.NewServer(f.handler())
	defer srv.Close()
	a := newRecruitTestApp(t, srv)

	agent, err := a.InstallRecruitAgent(context.Background(), "patch")
	if err != nil {
		t.Fatal(err)
	}
	if agent.Name != "Patch" {
		t.Fatalf("name = %q", agent.Name)
	}
	if !strings.Contains(agent.Instruction, "Reproduces bugs at 1.0.0") {
		t.Fatalf("agent body not pulled from tag: %q", agent.Instruction)
	}
	if agent.RuntimeID != "runtime-mock" {
		t.Fatalf("runtime = %q, want runtime-mock", agent.RuntimeID)
	}
	if agent.Source == nil || agent.Source.RepoURL != "https://github.com/hex/patch-agent" {
		t.Fatalf("source not recorded: %+v", agent.Source)
	}
	if agent.Source.Version != "1.0.0" {
		t.Fatalf("source version = %q", agent.Source.Version)
	}
	if len(agent.SkillIDs) != 1 {
		t.Fatalf("skill_ids = %v", agent.SkillIDs)
	}

	skills, err := a.ListSkills()
	if err != nil {
		t.Fatal(err)
	}
	var attached *model.SkillRecord
	for i := range skills {
		if skills[i].ID == agent.SkillIDs[0] {
			attached = &skills[i]
			break
		}
	}
	if attached == nil {
		t.Fatal("attached skill not in list")
	}
	if attached.Source == nil || attached.Source.Path != "skills/minimal-failing-test/SKILL.md" {
		t.Fatalf("skill source not recorded: %+v", attached.Source)
	}
	files, err := a.ListSkillFiles(attached.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(files) == 0 || !strings.Contains(files[0].Content, "Write the failing test first") {
		t.Fatalf("SKILL.md not written; files=%+v", files)
	}
}

func TestRecruitInstallIdempotent(t *testing.T) {
	f := newFakeRegistry(t)
	seedPatchAgent(f, "1.0.0")
	srv := httptest.NewServer(f.handler())
	defer srv.Close()
	a := newRecruitTestApp(t, srv)

	first, err := a.InstallRecruitAgent(context.Background(), "patch")
	if err != nil {
		t.Fatal(err)
	}
	second, err := a.InstallRecruitAgent(context.Background(), "patch")
	if err != nil {
		t.Fatal(err)
	}
	if first.ID != second.ID {
		t.Fatalf("idempotency broken: %s vs %s", first.ID, second.ID)
	}
	if len(second.SkillIDs) != 1 || first.SkillIDs[0] != second.SkillIDs[0] {
		t.Fatalf("skill IDs changed: %v vs %v", first.SkillIDs, second.SkillIDs)
	}
	agents, err := a.ListAgents()
	if err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, ag := range agents {
		if ag.Source != nil && ag.Source.RepoURL == "https://github.com/hex/patch-agent" {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("expected one recruited agent, got %d", count)
	}
}

func TestRecruitInstallVersionBumpUpdatesContent(t *testing.T) {
	f := newFakeRegistry(t)
	seedPatchAgent(f, "1.0.0")
	srv := httptest.NewServer(f.handler())
	defer srv.Close()
	a := newRecruitTestApp(t, srv)

	first, err := a.InstallRecruitAgent(context.Background(), "patch")
	if err != nil {
		t.Fatal(err)
	}

	// Author publishes 1.1.0 — update HEAD manifest and add a new tag.
	seedPatchAgent(f, "1.1.0")
	a.recruit.InvalidateRegistry()

	second, err := a.InstallRecruitAgent(context.Background(), "patch")
	if err != nil {
		t.Fatal(err)
	}
	if first.ID != second.ID {
		t.Fatal("agent record should be reused across version bumps")
	}
	if !strings.Contains(second.Instruction, "Reproduces bugs at 1.1.0") {
		t.Fatalf("instruction not updated: %q", second.Instruction)
	}
	if second.Source.Version != "1.1.0" {
		t.Fatalf("source version not bumped: %s", second.Source.Version)
	}
}

// Install must refuse a tag whose pinned manifest disagrees with the
// HEAD manifest's version. Simulates a force-pushed release tag.
func TestRecruitInstallRejectsVersionMismatch(t *testing.T) {
	f := newFakeRegistry(t)
	f.set("/registry/test/HEAD/agents.json", `{
		"schema_version":"crew44.agent-registry.v1",
		"agents":[{"id":"patch","name":"Patch","description":"d","repo_url":"https://github.com/hex/patch-agent"}]
	}`)
	// HEAD says 1.0.0, but both candidate tags claim 9.9.9.
	f.set("/hex/patch-agent/HEAD/crew44-agent.json", `{
		"schema_version":"crew44.agent.v1","name":"Patch","version":"1.0.0","description":"d"
	}`)
	divergent := `{
		"schema_version":"crew44.agent.v1","name":"Patch","version":"9.9.9","description":"d"
	}`
	f.set("/hex/patch-agent/v1.0.0/crew44-agent.json", divergent)
	f.set("/hex/patch-agent/1.0.0/crew44-agent.json", divergent)
	srv := httptest.NewServer(f.handler())
	defer srv.Close()
	a := newRecruitTestApp(t, srv)

	_, err := a.InstallRecruitAgent(context.Background(), "patch")
	if err == nil {
		t.Fatal("expected install to reject divergent tag manifest")
	}
	if !errors.Is(err, recruit.ErrVersionMismatch) {
		t.Fatalf("expected ErrVersionMismatch, got %v", err)
	}
}

func TestRecruitInstallMissingTag(t *testing.T) {
	f := newFakeRegistry(t)
	// Registry + HEAD manifest exist, but no tag was published.
	f.set("/registry/test/HEAD/agents.json", `{
		"schema_version":"crew44.agent-registry.v1",
		"agents":[{"id":"patch","name":"Patch","description":"d","repo_url":"https://github.com/hex/patch-agent"}]
	}`)
	f.set("/hex/patch-agent/HEAD/crew44-agent.json", `{
		"schema_version":"crew44.agent.v1","name":"Patch","version":"9.9.9","description":"d"
	}`)
	srv := httptest.NewServer(f.handler())
	defer srv.Close()
	a := newRecruitTestApp(t, srv)

	_, err := a.InstallRecruitAgent(context.Background(), "patch")
	if err == nil {
		t.Fatal("expected install to fail when release tag missing")
	}
	if !errors.Is(err, ErrBadRequest) {
		t.Fatalf("expected ErrBadRequest, got %v", err)
	}
	if !strings.Contains(err.Error(), "9.9.9") {
		t.Fatalf("error should mention missing version: %v", err)
	}
}

func TestRecruitInstallRejectsUnsafeSkillPath(t *testing.T) {
	f := newFakeRegistry(t)
	f.set("/registry/test/HEAD/agents.json", `{
		"schema_version":"crew44.agent-registry.v1",
		"agents":[{"id":"evil","name":"Evil","description":"d","repo_url":"https://github.com/x/evil"}]
	}`)
	f.set("/x/evil/HEAD/crew44-agent.json", `{
		"schema_version":"crew44.agent.v1","name":"Evil","version":"1.0.0","description":"d",
		"skills":[{"name":"x","path":"../../../etc/passwd"}]
	}`)
	srv := httptest.NewServer(f.handler())
	defer srv.Close()
	a := newRecruitTestApp(t, srv)

	_, err := a.InstallRecruitAgent(context.Background(), "evil")
	if err == nil {
		t.Fatal("expected install to fail on traversal path")
	}
	if !errors.Is(err, recruit.ErrUnsafePath) && !strings.Contains(err.Error(), "unsafe") {
		t.Fatalf("expected unsafe path error, got %v", err)
	}
}

func TestRecruitNamespacingIsolatesSameNamedSkill(t *testing.T) {
	f := newFakeRegistry(t)
	// Two agents declare a skill named "shared" — they must end up as two
	// separate skill records keyed by (repo_url, path).
	register := func(id, repo string) {
		manifest := `{
			"schema_version":"crew44.agent.v1",
			"name":"` + id + `","version":"1.0.0","description":"d",
			"skills":[{"name":"shared","path":"skills/shared/SKILL.md"}]
		}`
		f.set("/registry/test/HEAD/agents.json",
			coalesceRegistry(f.files["/registry/test/HEAD/agents.json"], id, repo))
		f.set("/"+repo+"/HEAD/crew44-agent.json", manifest)
		f.set("/"+repo+"/HEAD/AGENT.md", "# "+id+"\n")
		f.set("/"+repo+"/v1.0.0/crew44-agent.json", manifest)
		f.set("/"+repo+"/v1.0.0/AGENT.md", "# "+id+"\n")
		f.set("/"+repo+"/v1.0.0/skills/shared/SKILL.md", "# shared from "+id+"\n")
	}
	register("alpha", "o/alpha")
	register("beta", "o/beta")
	srv := httptest.NewServer(f.handler())
	defer srv.Close()
	a := newRecruitTestApp(t, srv)

	a1, err := a.InstallRecruitAgent(context.Background(), "alpha")
	if err != nil {
		t.Fatal(err)
	}
	a2, err := a.InstallRecruitAgent(context.Background(), "beta")
	if err != nil {
		t.Fatal(err)
	}
	if a1.SkillIDs[0] == a2.SkillIDs[0] {
		t.Fatal("same-named skills from different repos should not share an ID")
	}
	skills, _ := a.ListSkills()
	matches := 0
	for _, s := range skills {
		if s.Name == "shared" {
			matches++
		}
	}
	if matches != 2 {
		t.Fatalf("expected two 'shared' skill records, got %d", matches)
	}
}

// coalesceRegistry appends a registry entry into existing agents.json,
// or starts a new one. Lets the namespacing test register two agents
// without hand-writing the JSON.
func coalesceRegistry(existing, id, repo string) string {
	entry := fmt.Sprintf(`{"id":"%s","name":"%s","description":"d","repo_url":"https://github.com/%s"}`, id, id, repo)
	if existing == "" {
		return `{"schema_version":"crew44.agent-registry.v1","agents":[` + entry + `]}`
	}
	return strings.Replace(existing, "]}", `,`+entry+`]}`, 1)
}

func TestRecruitInstallMissingManifestField(t *testing.T) {
	f := newFakeRegistry(t)
	f.set("/registry/test/HEAD/agents.json", `{
		"schema_version":"crew44.agent-registry.v1",
		"agents":[{"id":"bad","name":"Bad","description":"d","repo_url":"https://github.com/x/bad"}]
	}`)
	// Missing required "version" field.
	f.set("/x/bad/HEAD/crew44-agent.json", `{
		"schema_version":"crew44.agent.v1","name":"Bad","description":"d"
	}`)
	srv := httptest.NewServer(f.handler())
	defer srv.Close()
	a := newRecruitTestApp(t, srv)
	_, err := a.InstallRecruitAgent(context.Background(), "bad")
	if !errors.Is(err, recruit.ErrManifestInvalid) {
		t.Fatalf("expected ErrManifestInvalid, got %v", err)
	}
	// Recruit metadata failures must map to ErrBadRequest so the RPC
	// layer translates them to a -32000 bad-request the UI can render
	// as a clean toast, not a generic internal error.
	if !errors.Is(err, ErrBadRequest) {
		t.Fatalf("expected ErrBadRequest (for RPC mapping), got %v", err)
	}
}

// Bad repo URLs in the registry must also surface as ErrBadRequest, not
// as an internal error. Uses a non-github.com host that parseGitHubRepo
// rejects with ErrRepoURLInvalid.
func TestRecruitInstallBadRepoURLMapsToBadRequest(t *testing.T) {
	f := newFakeRegistry(t)
	f.set("/registry/test/HEAD/agents.json", `{
		"schema_version":"crew44.agent-registry.v1",
		"agents":[{"id":"x","name":"X","description":"d","repo_url":"https://gitlab.com/o/r"}]
	}`)
	srv := httptest.NewServer(f.handler())
	defer srv.Close()
	a := newRecruitTestApp(t, srv)
	_, err := a.InstallRecruitAgent(context.Background(), "x")
	if !errors.Is(err, ErrBadRequest) {
		t.Fatalf("expected ErrBadRequest, got %v", err)
	}
	if !errors.Is(err, recruit.ErrRepoURLInvalid) {
		t.Fatalf("expected ErrRepoURLInvalid, got %v", err)
	}
}

func TestRecruitGetReturnsHEADManifestAndBody(t *testing.T) {
	f := newFakeRegistry(t)
	seedPatchAgent(f, "1.0.0")
	srv := httptest.NewServer(f.handler())
	defer srv.Close()
	a := newRecruitTestApp(t, srv)

	detail, err := a.GetRecruitAgent(context.Background(), "patch")
	if err != nil {
		t.Fatal(err)
	}
	if detail.Manifest.Name != "Patch" || detail.Manifest.Version != "1.0.0" {
		t.Fatalf("manifest: %+v", detail.Manifest)
	}
	if detail.Manifest.SuggestedRuntime != "claude" {
		t.Fatalf("suggested runtime not parsed: %+v", detail.Manifest)
	}
	if !strings.Contains(detail.AgentBody, "Reproduces bugs.") {
		t.Fatalf("AGENT.md body: %q", detail.AgentBody)
	}
}

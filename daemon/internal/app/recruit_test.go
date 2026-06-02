package app

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/getcrew44/crew44/daemon/internal/model"
	"github.com/getcrew44/crew44/daemon/internal/recruit"
	"github.com/getcrew44/crew44/daemon/internal/runtime"
)

// fakeRegistry composes an httptest server that serves both raw-content
// requests (registry, HEAD manifests, HEAD INSTRUCTIONS.md) and codeload tarball
// requests. Raw files are keyed by full URL path; tarballs are keyed by
// (owner, repo, ref) and built on demand from the seeded file map.
type fakeRegistry struct {
	t        *testing.T
	rawFiles map[string]string
	// tarRefs records which (owner, repo, ref) tuples a tarball should be
	// served for. Files matching the ref's repo prefix are bundled into
	// the synthetic tarball.
	tarRefs map[string]map[string]bool // "owner/repo" -> set of refs
}

func newFakeRegistry(t *testing.T) *fakeRegistry {
	return &fakeRegistry{
		t:        t,
		rawFiles: map[string]string{},
		tarRefs:  map[string]map[string]bool{},
	}
}

func (f *fakeRegistry) set(path, body string) {
	f.rawFiles[path] = body
}

// publishTag registers a tag for codeload serving. When the installer
// requests /{owner}/{repo}/tar.gz/{ref}, the handler builds a tarball
// from every rawFiles entry matching /{owner}/{repo}/{ref}/...
func (f *fakeRegistry) publishTag(owner, repo, ref string) {
	key := owner + "/" + repo
	if f.tarRefs[key] == nil {
		f.tarRefs[key] = map[string]bool{}
	}
	f.tarRefs[key][ref] = true
}

func (f *fakeRegistry) handler() http.Handler {
	mux := http.NewServeMux()
	// Tarball endpoint: /{owner}/{repo}/tar.gz/{ref}
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// Match the codeload tarball path first.
		parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
		if len(parts) == 4 && parts[2] == "tar.gz" {
			owner, repo, ref := parts[0], parts[1], parts[3]
			key := owner + "/" + repo
			if !f.tarRefs[key][ref] {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			tarBytes := f.buildTarball(owner, repo, ref)
			w.Header().Set("Content-Type", "application/gzip")
			w.Write(tarBytes)
			return
		}
		body, ok := f.rawFiles[r.URL.Path]
		if !ok {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		if strings.HasSuffix(r.URL.Path, ".json") {
			w.Header().Set("Content-Type", "application/json")
		}
		w.Write([]byte(body))
	})
	return mux
}

func (f *fakeRegistry) buildTarball(owner, repo, ref string) []byte {
	prefix := "/" + owner + "/" + repo + "/" + ref + "/"
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	wrapper := repo + "-abcd1234"
	tw.WriteHeader(&tar.Header{Name: wrapper + "/", Typeflag: tar.TypeDir, Mode: 0o755})
	for path, body := range f.rawFiles {
		if !strings.HasPrefix(path, prefix) {
			continue
		}
		rel := strings.TrimPrefix(path, prefix)
		hdr := &tar.Header{
			Name:     wrapper + "/" + rel,
			Mode:     0o644,
			Size:     int64(len(body)),
			Typeflag: tar.TypeReg,
		}
		tw.WriteHeader(hdr)
		tw.Write([]byte(body))
	}
	tw.Close()
	gz.Close()
	return buf.Bytes()
}

func newRecruitTestApp(t *testing.T, srv *httptest.Server) *App {
	t.Helper()
	root := t.TempDir()
	client := recruit.NewClient(recruit.Config{
		RawBase:      srv.URL,
		CodeloadBase: srv.URL,
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
	f.set("/hex/patch-agent/HEAD/INSTRUCTIONS.md", "# Patch\nReproduces bugs.\n")
	tag := "v" + version
	f.set("/hex/patch-agent/"+tag+"/crew44-agent.json", headManifest)
	f.set("/hex/patch-agent/"+tag+"/INSTRUCTIONS.md", "# Patch\nReproduces bugs at "+version+".\n")
	f.set("/hex/patch-agent/"+tag+"/skills/minimal-failing-test/SKILL.md",
		"---\nname: minimal-failing-test\n---\n# Minimal failing test\nWrite the failing test first.\n")
	f.publishTag("hex", "patch-agent", tag)
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
	a.recruit.InvalidateRegistry()
	items, err = a.ListRecruitAgents(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !items[0].Installed {
		t.Fatalf("post-install: expected installed=true, got %+v", items)
	}
}

// Install must create a payload-backed source/ directory, write
// recruited-skills.json with SKILL.md paths under source/, and NOT
// create a global SkillRecord. The agent body comes from the tag's
// INSTRUCTIONS.md (not HEAD).
func TestRecruitInstallCreatesPayloadAndRecruitedSkills(t *testing.T) {
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
	if strings.TrimSpace(agent.Source.SourceDir) == "" {
		t.Fatalf("source dir not recorded")
	}
	// Recruited skills must NOT be promoted to global SkillIDs.
	if len(agent.SkillIDs) != 0 {
		t.Fatalf("recruited skills should not populate SkillIDs: %v", agent.SkillIDs)
	}
	// Payload files must exist under source/.
	for _, expected := range []string{"INSTRUCTIONS.md", "crew44-agent.json", "skills/minimal-failing-test/SKILL.md"} {
		full := filepath.Join(agent.Source.SourceDir, expected)
		if _, err := os.Stat(full); err != nil {
			t.Errorf("payload missing %s: %v", expected, err)
		}
	}
	// recruited-skills.json should index the manifest skill.
	skills, err := a.store.LoadRecruitedSkills(agent.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(skills) != 1 {
		t.Fatalf("recruited skills = %v", skills)
	}
	if skills[0].Name != "minimal-failing-test" {
		t.Fatalf("recruited skill name = %q", skills[0].Name)
	}
	wantPath := filepath.Join(agent.Source.SourceDir, "skills", "minimal-failing-test", "SKILL.md")
	if skills[0].SourcePath != wantPath {
		t.Fatalf("recruited skill source path = %q, want %q", skills[0].SourcePath, wantPath)
	}
	body, err := os.ReadFile(skills[0].SourcePath)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(body), "Write the failing test first") {
		t.Fatalf("SKILL.md body not in source/: %q", body)
	}
	// No global skill registry entry should reference this repo.
	global, err := a.ListSkills()
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range global {
		if s.Source != nil && s.Source.RepoURL == "https://github.com/hex/patch-agent" {
			t.Fatalf("recruited skills should not be in global registry: %+v", s)
		}
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
	// source/ must reflect 1.1.0 too.
	body, err := os.ReadFile(filepath.Join(second.Source.SourceDir, "INSTRUCTIONS.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(body), "1.1.0") {
		t.Fatalf("source INSTRUCTIONS.md not updated: %q", body)
	}
}

func TestRecruitInstallRejectsVersionMismatch(t *testing.T) {
	f := newFakeRegistry(t)
	f.set("/registry/test/HEAD/agents.json", `{
		"schema_version":"crew44.agent-registry.v1",
		"agents":[{"id":"patch","name":"Patch","description":"d","repo_url":"https://github.com/hex/patch-agent"}]
	}`)
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

// Two agents declaring a skill named "shared" must end up with two
// fully isolated agent-private skill records under their own
// recruited-skills.json files. Nothing lands in the global skill
// registry.
func TestRecruitNamespacingIsolatesSameNamedSkill(t *testing.T) {
	f := newFakeRegistry(t)
	register := func(id, repo string) {
		manifest := `{
			"schema_version":"crew44.agent.v1",
			"name":"` + id + `","version":"1.0.0","description":"d",
			"skills":[{"name":"shared","path":"skills/shared/SKILL.md"}]
		}`
		f.set("/registry/test/HEAD/agents.json",
			coalesceRegistry(f.rawFiles["/registry/test/HEAD/agents.json"], id, repo))
		f.set("/"+repo+"/HEAD/crew44-agent.json", manifest)
		f.set("/"+repo+"/HEAD/INSTRUCTIONS.md", "# "+id+"\n")
		f.set("/"+repo+"/v1.0.0/crew44-agent.json", manifest)
		f.set("/"+repo+"/v1.0.0/INSTRUCTIONS.md", "# "+id+"\n")
		f.set("/"+repo+"/v1.0.0/skills/shared/SKILL.md", "# shared from "+id+"\n")
		parts := strings.SplitN(repo, "/", 2)
		f.publishTag(parts[0], parts[1], "v1.0.0")
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
	skills1, err := a.store.LoadRecruitedSkills(a1.ID)
	if err != nil {
		t.Fatal(err)
	}
	skills2, err := a.store.LoadRecruitedSkills(a2.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(skills1) != 1 || len(skills2) != 1 {
		t.Fatalf("expected one private skill each, got alpha=%v beta=%v", skills1, skills2)
	}
	if skills1[0].SourcePath == skills2[0].SourcePath {
		t.Fatal("private skills must be isolated under each agent dir")
	}
	body1, _ := os.ReadFile(skills1[0].SourcePath)
	body2, _ := os.ReadFile(skills2[0].SourcePath)
	if !strings.Contains(string(body1), "from alpha") {
		t.Fatalf("alpha skill body wrong: %q", body1)
	}
	if !strings.Contains(string(body2), "from beta") {
		t.Fatalf("beta skill body wrong: %q", body2)
	}
	// Nothing should be in the global skill registry from these
	// recruited installs.
	global, err := a.ListSkills()
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range global {
		if s.Source != nil && (s.Source.RepoURL == "https://github.com/o/alpha" || s.Source.RepoURL == "https://github.com/o/beta") {
			t.Fatalf("recruited skill leaked into global registry: %+v", s)
		}
	}
}

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
	if !errors.Is(err, ErrBadRequest) {
		t.Fatalf("expected ErrBadRequest (for RPC mapping), got %v", err)
	}
}

func TestRecruitInstallRejectsUnsupportedSchemaVersion(t *testing.T) {
	f := newFakeRegistry(t)
	f.set("/registry/test/HEAD/agents.json", `{
		"schema_version":"crew44.agent-registry.v1",
		"agents":[{"id":"future","name":"Future","description":"d","repo_url":"https://github.com/x/future"}]
	}`)
	f.set("/x/future/HEAD/crew44-agent.json", `{
		"schema_version":"crew44.agent.v2","name":"Future","version":"1.0.0","description":"d"
	}`)
	srv := httptest.NewServer(f.handler())
	defer srv.Close()
	a := newRecruitTestApp(t, srv)
	_, err := a.InstallRecruitAgent(context.Background(), "future")
	if !errors.Is(err, recruit.ErrManifestInvalid) {
		t.Fatalf("expected ErrManifestInvalid, got %v", err)
	}
	if !strings.Contains(err.Error(), "schema_version") {
		t.Fatalf("error should mention schema_version: %v", err)
	}
}

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
		t.Fatalf("INSTRUCTIONS.md body: %q", detail.AgentBody)
	}
}

// Upstream-wrapper repos must extract upstream/** by default and surface
// the upstream manifest metadata on the installed agent's Source record.
func TestRecruitInstallUpstreamWrapper(t *testing.T) {
	f := newFakeRegistry(t)
	manifest := `{
		"schema_version":"crew44.agent.v1",
		"name":"Karpathy","version":"1.0.0","description":"wrapped",
		"source_type":"upstream-wrapper",
		"upstream":{"repo_url":"https://github.com/multica-ai/andrej-karpathy-skills","path":"upstream","commit":"abc1234"},
		"skills":[{"name":"writing","path":"upstream/skills/writing/SKILL.md"}]
	}`
	f.set("/registry/test/HEAD/agents.json", `{
		"schema_version":"crew44.agent-registry.v1",
		"agents":[{"id":"karp","name":"Karpathy","description":"wrapped","repo_url":"https://github.com/multica-ai/karpathy-agent"}]
	}`)
	f.set("/multica-ai/karpathy-agent/HEAD/crew44-agent.json", manifest)
	f.set("/multica-ai/karpathy-agent/HEAD/INSTRUCTIONS.md", "# K HEAD\n")
	f.set("/multica-ai/karpathy-agent/v1.0.0/crew44-agent.json", manifest)
	f.set("/multica-ai/karpathy-agent/v1.0.0/INSTRUCTIONS.md", "# K\nWrapped upstream agent.\n")
	f.set("/multica-ai/karpathy-agent/v1.0.0/upstream/README.md", "# upstream readme\n")
	f.set("/multica-ai/karpathy-agent/v1.0.0/upstream/skills/writing/SKILL.md", "# writing\n")
	f.set("/multica-ai/karpathy-agent/v1.0.0/upstream/data/example.txt", "example\n")
	f.publishTag("multica-ai", "karpathy-agent", "v1.0.0")
	srv := httptest.NewServer(f.handler())
	defer srv.Close()
	a := newRecruitTestApp(t, srv)

	agent, err := a.InstallRecruitAgent(context.Background(), "karp")
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{
		"INSTRUCTIONS.md",
		"crew44-agent.json",
		"upstream/README.md",
		"upstream/skills/writing/SKILL.md",
		"upstream/data/example.txt",
	} {
		if _, err := os.Stat(filepath.Join(agent.Source.SourceDir, expected)); err != nil {
			t.Errorf("upstream payload missing %s: %v", expected, err)
		}
	}
	skills, err := a.store.LoadRecruitedSkills(agent.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(skills) != 1 || skills[0].Path != "upstream/skills/writing/SKILL.md" {
		t.Fatalf("recruited skill not indexed: %+v", skills)
	}
}

// A failed install must leave the previously installed source/ payload
// intact. Simulates "missing INSTRUCTIONS.md at tag" after a working install.
func TestRecruitInstallFailureLeavesPreviousSourceIntact(t *testing.T) {
	f := newFakeRegistry(t)
	seedPatchAgent(f, "1.0.0")
	srv := httptest.NewServer(f.handler())
	defer srv.Close()
	a := newRecruitTestApp(t, srv)

	first, err := a.InstallRecruitAgent(context.Background(), "patch")
	if err != nil {
		t.Fatal(err)
	}
	prevSource := filepath.Join(first.Source.SourceDir, "INSTRUCTIONS.md")
	if _, err := os.Stat(prevSource); err != nil {
		t.Fatal(err)
	}

	// Bump HEAD manifest to a new version, publish a tag whose
	// payload omits INSTRUCTIONS.md to force a deterministic install-time
	// failure after archive download.
	manifest11 := `{
		"schema_version":"crew44.agent.v1",
		"name":"Patch","version":"1.1.0","description":"d",
		"skills":[{"name":"minimal-failing-test","path":"skills/minimal-failing-test/SKILL.md"}],
		"payload":{"include":["skills/**","crew44-agent.json"]}
	}`
	f.set("/hex/patch-agent/HEAD/crew44-agent.json", manifest11)
	f.set("/hex/patch-agent/v1.1.0/crew44-agent.json", manifest11)
	f.set("/hex/patch-agent/v1.1.0/skills/minimal-failing-test/SKILL.md", "# new\n")
	f.publishTag("hex", "patch-agent", "v1.1.0")
	a.recruit.InvalidateRegistry()

	_, err = a.InstallRecruitAgent(context.Background(), "patch")
	if err == nil {
		t.Fatal("expected install to fail because INSTRUCTIONS.md missing from payload")
	}
	// Previous source must still be 1.0.0.
	body, err := os.ReadFile(prevSource)
	if err != nil {
		t.Fatalf("previous source vanished: %v", err)
	}
	if !strings.Contains(string(body), "1.0.0") {
		t.Fatalf("previous source corrupted: %q", body)
	}
}

// A failed first-time install must not leave an empty agents/agent-<id>
// directory behind, because ListAgents expects every agent dir to contain
// config.json.
func TestRecruitInstallFreshFailureDoesNotPoisonAgentList(t *testing.T) {
	f := newFakeRegistry(t)
	f.set("/registry/test/HEAD/agents.json", `{
		"schema_version":"crew44.agent-registry.v1",
		"agents":[{"id":"broken","name":"Broken","description":"d","repo_url":"https://github.com/x/broken"}]
	}`)
	manifest := `{
		"schema_version":"crew44.agent.v1",
		"name":"Broken","version":"1.0.0","description":"d",
		"payload":{"include":["crew44-agent.json"]}
	}`
	f.set("/x/broken/HEAD/crew44-agent.json", manifest)
	f.set("/x/broken/v1.0.0/crew44-agent.json", manifest)
	f.publishTag("x", "broken", "v1.0.0")
	srv := httptest.NewServer(f.handler())
	defer srv.Close()
	a := newRecruitTestApp(t, srv)

	if _, err := a.InstallRecruitAgent(context.Background(), "broken"); err == nil {
		t.Fatal("expected install to fail because INSTRUCTIONS.md is missing from payload")
	}
	if _, err := a.ListAgents(); err != nil {
		t.Fatalf("failed install left agent store unreadable: %v", err)
	}
	if _, err := a.ListRecruitAgents(context.Background()); err != nil {
		t.Fatalf("failed install broke recruit list installed-state check: %v", err)
	}
}

// Legacy global skill cleanup is best-effort. If it fails after the new
// payload-backed install has already committed, the install RPC should still
// report success so the UI does not show a false failure.
func TestRecruitInstallIgnoresLegacySkillCleanupFailureAfterCommit(t *testing.T) {
	f := newFakeRegistry(t)
	seedPatchAgent(f, "1.0.0")
	srv := httptest.NewServer(f.handler())
	defer srv.Close()
	a := newRecruitTestApp(t, srv)

	if err := a.store.SaveSkills([]model.SkillRecord{{
		ID:     "legacy",
		Name:   "legacy",
		Source: &model.SkillSource{RepoURL: "https://github.com/hex/patch-agent", Path: "skills/legacy/SKILL.md", Version: "0.9.0"},
	}}); err != nil {
		t.Fatal(err)
	}
	registryPath := filepath.Join(a.store.Root(), "skills", "registry.json")
	if err := os.Chmod(registryPath, 0o400); err != nil {
		t.Fatal(err)
	}
	defer os.Chmod(registryPath, 0o600)

	agent, err := a.InstallRecruitAgent(context.Background(), "patch")
	if err != nil {
		t.Fatalf("install should succeed even when legacy cleanup fails: %v", err)
	}
	if agent.Source == nil || agent.Source.Version != "1.0.0" {
		t.Fatalf("install did not return committed agent: %+v", agent)
	}
	if _, err := os.Stat(filepath.Join(agent.Source.SourceDir, "INSTRUCTIONS.md")); err != nil {
		t.Fatalf("committed source missing after cleanup failure: %v", err)
	}
}

// Symlink entries inside the tarball must be rejected — never extracted.
func TestRecruitInstallRejectsSymlinkEscape(t *testing.T) {
	f := newFakeRegistry(t)
	f.set("/registry/test/HEAD/agents.json", `{
		"schema_version":"crew44.agent-registry.v1",
		"agents":[{"id":"evil","name":"Evil","description":"d","repo_url":"https://github.com/x/evil"}]
	}`)
	manifest := `{
		"schema_version":"crew44.agent.v1","name":"Evil","version":"1.0.0","description":"d"
	}`
	f.set("/x/evil/HEAD/crew44-agent.json", manifest)
	f.set("/x/evil/v1.0.0/crew44-agent.json", manifest)
	f.set("/x/evil/v1.0.0/INSTRUCTIONS.md", "# E\n")
	f.publishTag("x", "evil", "v1.0.0")
	// Inject a symlink entry directly into the codeload handler.
	hijacked := f.handler()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/tar.gz/v1.0.0") {
			var buf bytes.Buffer
			gz := gzip.NewWriter(&buf)
			tw := tar.NewWriter(gz)
			tw.WriteHeader(&tar.Header{Name: "evil-abcd/", Typeflag: tar.TypeDir, Mode: 0o755})
			tw.WriteHeader(&tar.Header{
				Name:     "evil-abcd/INSTRUCTIONS.md",
				Typeflag: tar.TypeReg,
				Size:     5,
				Mode:     0o644,
			})
			tw.Write([]byte("# E\n\n"))
			tw.WriteHeader(&tar.Header{
				Name:     "evil-abcd/crew44-agent.json",
				Typeflag: tar.TypeReg,
				Size:     int64(len(manifest)),
				Mode:     0o644,
			})
			tw.Write([]byte(manifest))
			tw.WriteHeader(&tar.Header{
				Name:     "evil-abcd/escape",
				Typeflag: tar.TypeSymlink,
				Linkname: "../../../etc/passwd",
			})
			tw.Close()
			gz.Close()
			w.Header().Set("Content-Type", "application/gzip")
			w.Write(buf.Bytes())
			return
		}
		hijacked.ServeHTTP(w, r)
	}))
	defer srv.Close()
	a := newRecruitTestApp(t, srv)

	_, err := a.InstallRecruitAgent(context.Background(), "evil")
	if err == nil {
		t.Fatal("expected install to reject symlink entry")
	}
	if !errors.Is(err, recruit.ErrArchiveSymlinkEscape) {
		t.Fatalf("expected ErrArchiveSymlinkEscape, got %v", err)
	}
}

// Runtime must receive the installed source dir for a recruited agent.
// Verified by inspecting the agent record + recruited-skills.json file
// produced by the install; runtime exposure is wired through
// runtime.RunRequest.AgentSourceDir → CREW44_AGENT_SOURCE_DIR.
func TestRecruitInstallRecordsSourceDir(t *testing.T) {
	f := newFakeRegistry(t)
	seedPatchAgent(f, "1.0.0")
	srv := httptest.NewServer(f.handler())
	defer srv.Close()
	a := newRecruitTestApp(t, srv)

	agent, err := a.InstallRecruitAgent(context.Background(), "patch")
	if err != nil {
		t.Fatal(err)
	}
	if agent.Source == nil {
		t.Fatal("source record missing")
	}
	if got, want := agent.Source.SourceDir, a.store.AgentSourceDir(agent.ID); got != want {
		t.Fatalf("source dir = %q, want %q", got, want)
	}
}

// resolveRunSkills must load both global skills (from SkillIDs) and
// agent-private recruited skills from the installed source/ dir.
func TestResolveRunSkillsIncludesRecruited(t *testing.T) {
	f := newFakeRegistry(t)
	seedPatchAgent(f, "1.0.0")
	srv := httptest.NewServer(f.handler())
	defer srv.Close()
	a := newRecruitTestApp(t, srv)

	agent, err := a.InstallRecruitAgent(context.Background(), "patch")
	if err != nil {
		t.Fatal(err)
	}
	skills, err := a.resolveRunSkills(agent)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, s := range skills {
		if s.Name == "minimal-failing-test" {
			found = true
			if !strings.Contains(s.Content, "Write the failing test first") {
				t.Fatalf("recruited skill content not loaded: %q", s.Content)
			}
		}
	}
	if !found {
		t.Fatalf("recruited skill missing from resolveRunSkills: %+v", skills)
	}
}

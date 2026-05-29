// Package importer turns an arbitrary GitHub repository into a
// Crew44-compatible agent repo: a top-level AGENT.md, a
// crew44-agent.json manifest, and an optional wrapper of the
// upstream content under upstream/.
//
// The importer is structured as a deterministic tool around two
// pluggable hooks: a Fetcher (clones or downloads the upstream repo
// content into a working tree) and an optional Generator (calls a
// Crew44 runtime adapter to write the AGENT.md body). The deterministic
// path can run without any LLM call; the runtime hook is purely additive
// so unit tests stay hermetic.
package importer

import (
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/getcrew44/crew44/daemon/internal/recruit"
)

// Options describe a single import. They are derived from CLI flags by
// the main entry point.
type Options struct {
	// RepoURL is the upstream GitHub repo URL the importer wraps. Used
	// only for the manifest's upstream block — the actual file fetch
	// is delegated to Fetcher.
	RepoURL          string
	Name             string
	Description      string
	Version          string
	Author           string
	Tags             []string
	SuggestedRuntime string
	// Native disables upstream wrapping: the importer treats the
	// source repo as an already-Crew44 layout (root AGENT.md or
	// skills/ at the top) and copies it directly into OutputDir.
	Native bool
	// OutputDir is the destination directory for the generated wrapper
	// repo. It must not exist or must be empty; the importer never
	// overwrites existing files.
	OutputDir string
	// UpstreamPath is the directory under OutputDir where wrapped
	// upstream content is placed. Defaults to "upstream" when omitted.
	UpstreamPath string
	// PayloadInclude / PayloadExclude let callers override the
	// generated manifest's payload globs. Empty falls back to the
	// auto-computed defaults from recruit.ResolvePayload.
	PayloadInclude []string
	PayloadExclude []string
	// Commit is the upstream commit recorded on the manifest's
	// upstream block for traceability. Filled in by the Fetcher when
	// it knows the pinned ref.
	Commit string
}

// Fetcher pulls the upstream repo content into workDir. Implementations
// are free to clone, download a tarball, or copy from an existing
// directory; the importer treats workDir as opaque after the fetch
// returns. The returned commit (when known) is recorded on the manifest.
type Fetcher interface {
	Fetch(workDir string) (commit string, err error)
}

// Generator is the optional runtime-adapter hook. When non-nil, the
// importer asks it to draft the AGENT.md body. When nil, the importer
// falls back to a deterministic template.
type Generator interface {
	GenerateAgentBody(ctx GenerateContext) (string, error)
}

// GenerateContext is what the importer hands the Generator. The hook
// can use this to construct a runtime prompt; the deterministic
// fallback ignores everything and uses just Name/Description.
type GenerateContext struct {
	Name        string
	Description string
	RepoURL     string
	Native      bool
	UpstreamRel string // upstream/, or empty for native
	Skills      []recruit.SkillDecl
	// SourceFiles is the sorted list of repo-root-relative files that
	// will land in the installed agent's source/ directory. Useful for
	// telling the runtime "files X, Y, Z are available locally".
	SourceFiles []string
	// READMEs maps repo-root-relative paths to README contents so the
	// generator can summarize without re-reading the working tree.
	READMEs map[string]string
}

// Result reports what the importer wrote so the CLI can print next
// steps and so tests can assert against the generated layout without
// re-reading every file.
type Result struct {
	OutputDir        string
	ManifestPath     string
	AgentMDPath      string
	ImportReportPath string
	Manifest         recruit.Manifest
	DetectedSkills   []recruit.SkillDecl
	IncludedFiles    []string
	SkippedFiles     []string
	NextSteps        []string
}

// Run executes a single import end-to-end.
func Run(opts Options, fetcher Fetcher, generator Generator) (Result, error) {
	if err := validateOptions(opts); err != nil {
		return Result{}, err
	}
	if err := prepareOutputDir(opts.OutputDir); err != nil {
		return Result{}, err
	}

	upstreamRel := opts.UpstreamPath
	if upstreamRel == "" {
		upstreamRel = recruit.UpstreamPathDefault
	}
	var workDir string
	if opts.Native {
		// Native imports drop the upstream wrapper: the importer
		// fetches into the output dir itself.
		workDir = opts.OutputDir
	} else {
		workDir = filepath.Join(opts.OutputDir, upstreamRel)
		if err := os.MkdirAll(workDir, 0o755); err != nil {
			return Result{}, err
		}
	}

	commit, err := fetcher.Fetch(workDir)
	if err != nil {
		return Result{}, err
	}
	opts.Commit = commit

	skills, err := scanSkills(workDir, opts.Native, upstreamRel)
	if err != nil {
		return Result{}, err
	}
	readmes, err := loadREADMEs(workDir, opts.Native, upstreamRel)
	if err != nil {
		return Result{}, err
	}
	included, skipped, err := walkPayloadFiles(opts.OutputDir, opts.Native, upstreamRel)
	if err != nil {
		return Result{}, err
	}

	manifest := buildManifest(opts, upstreamRel, skills)
	manifestBytes, err := marshalManifest(manifest)
	if err != nil {
		return Result{}, err
	}
	manifestPath := filepath.Join(opts.OutputDir, "crew44-agent.json")
	// Native imports may carry an upstream crew44-agent.json that the
	// author already maintains; preserve it rather than clobbering.
	// Wrapper imports never have this conflict because the fetch
	// lands under upstream/.
	if opts.Native && fileExists(manifestPath) {
		// Reload the on-disk manifest so the rest of Run reflects
		// the author's intent.
		raw, err := os.ReadFile(manifestPath)
		if err != nil {
			return Result{}, err
		}
		if err := json.Unmarshal(raw, &manifest); err != nil {
			return Result{}, fmt.Errorf("importer: existing crew44-agent.json is invalid JSON: %w", err)
		}
	} else if err := writeNoOverwrite(manifestPath, manifestBytes); err != nil {
		return Result{}, err
	}

	body := ""
	if generator != nil {
		body, err = generator.GenerateAgentBody(GenerateContext{
			Name:        opts.Name,
			Description: opts.Description,
			RepoURL:     opts.RepoURL,
			Native:      opts.Native,
			UpstreamRel: upstreamRel,
			Skills:      skills,
			SourceFiles: included,
			READMEs:     readmes,
		})
		if err != nil {
			return Result{}, fmt.Errorf("generator: %w", err)
		}
	}
	if strings.TrimSpace(body) == "" {
		body = renderAgentMDTemplate(opts, upstreamRel, skills)
	}
	agentPath := filepath.Join(opts.OutputDir, "AGENT.md")
	if opts.Native && fileExists(agentPath) {
		// Author-shipped AGENT.md wins in native mode.
	} else if err := writeNoOverwrite(agentPath, []byte(body)); err != nil {
		return Result{}, err
	}

	reportPath := filepath.Join(opts.OutputDir, "IMPORT_REPORT.md")
	report := renderImportReport(opts, manifest, skills, included, skipped, commit)
	if err := writeNoOverwrite(reportPath, []byte(report)); err != nil {
		return Result{}, err
	}

	// Final validation: run the same manifest validator the daemon
	// applies on install, so a generated repo can never publish a
	// manifest the daemon will reject.
	if err := recruit.ValidateManifestForImporter(&manifest); err != nil {
		return Result{}, fmt.Errorf("generated manifest failed daemon validation: %w", err)
	}

	tag := opts.Version
	if !strings.HasPrefix(tag, "v") {
		tag = "v" + tag
	}
	next := []string{
		fmt.Sprintf("cd %s", opts.OutputDir),
		"git init",
		"git add AGENT.md crew44-agent.json IMPORT_REPORT.md " + upstreamRel,
		fmt.Sprintf("git commit -m \"Initial import of %s %s\"", opts.Name, opts.Version),
		fmt.Sprintf("git tag %s", tag),
		"git remote add origin <new repo url>",
		fmt.Sprintf("git push -u origin main %s", tag),
	}
	if opts.Native {
		// Native repos don't have an upstream/ dir to add separately.
		next[2] = "git add ."
	}

	return Result{
		OutputDir:        opts.OutputDir,
		ManifestPath:     manifestPath,
		AgentMDPath:      agentPath,
		ImportReportPath: reportPath,
		Manifest:         manifest,
		DetectedSkills:   skills,
		IncludedFiles:    included,
		SkippedFiles:     skipped,
		NextSteps:        next,
	}, nil
}

func validateOptions(opts Options) error {
	if strings.TrimSpace(opts.RepoURL) == "" {
		return errors.New("importer: --repo is required")
	}
	if strings.TrimSpace(opts.Name) == "" {
		return errors.New("importer: --name is required")
	}
	if strings.TrimSpace(opts.Description) == "" {
		return errors.New("importer: --description is required")
	}
	if strings.TrimSpace(opts.Version) == "" {
		return errors.New("importer: --version is required")
	}
	if strings.TrimSpace(opts.OutputDir) == "" {
		return errors.New("importer: --out is required")
	}
	return nil
}

func prepareOutputDir(dir string) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	if len(entries) > 0 {
		return fmt.Errorf("importer: output dir %q is not empty", dir)
	}
	return nil
}

// scanSkills walks the working tree looking for SKILL.md files and
// returns them as manifest SkillDecls. Skill name comes from the
// directory name; YAML frontmatter parsing is deferred to a future
// pass that wants richer skill metadata.
func scanSkills(workDir string, native bool, upstreamRel string) ([]recruit.SkillDecl, error) {
	if _, err := os.Stat(workDir); err != nil {
		return nil, nil
	}
	var skills []recruit.SkillDecl
	err := filepath.WalkDir(workDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if d.Name() == ".git" {
				return filepath.SkipDir
			}
			return nil
		}
		if d.Name() != "SKILL.md" {
			return nil
		}
		rel, err := filepath.Rel(workDir, path)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		if !native {
			rel = upstreamRel + "/" + rel
		}
		name := filepath.Base(filepath.Dir(path))
		skills = append(skills, recruit.SkillDecl{Name: name, Path: rel})
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Slice(skills, func(i, j int) bool { return skills[i].Path < skills[j].Path })
	return skills, nil
}

// loadREADMEs returns a small set of README-style files keyed by
// repo-root-relative path. Capped so the generator hook never receives
// a giant blob; the importer is supposed to feed the runtime a
// summarizable digest, not the whole repo.
func loadREADMEs(workDir string, native bool, upstreamRel string) (map[string]string, error) {
	out := map[string]string{}
	if _, err := os.Stat(workDir); err != nil {
		return out, nil
	}
	candidates := []string{"README.md", "README", "readme.md"}
	for _, name := range candidates {
		full := filepath.Join(workDir, name)
		data, err := os.ReadFile(full)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return nil, err
		}
		if len(data) > 16*1024 {
			data = data[:16*1024]
		}
		key := name
		if !native {
			key = upstreamRel + "/" + name
		}
		out[key] = string(data)
	}
	return out, nil
}

// walkPayloadFiles lists every file in OutputDir relative to OutputDir,
// classifying each as included (will be copied into source/ at install
// time) or skipped (filtered by default exclude globs). Used to fill
// the IMPORT_REPORT.md tables.
func walkPayloadFiles(outputDir string, native bool, upstreamRel string) ([]string, []string, error) {
	var included, skipped []string
	skipGlobs := []string{"**/.git/**", "**/.git", "**/node_modules/**", "**/.DS_Store"}
	err := filepath.WalkDir(outputDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if d.Name() == ".git" {
				return filepath.SkipDir
			}
			return nil
		}
		rel, err := filepath.Rel(outputDir, path)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		// IMPORT_REPORT.md isn't part of the install payload by default
		// since the manifest's auto-include omits it.
		if rel == "IMPORT_REPORT.md" {
			skipped = append(skipped, rel)
			return nil
		}
		if matchesAny(rel, skipGlobs) {
			skipped = append(skipped, rel)
			return nil
		}
		included = append(included, rel)
		return nil
	})
	if err != nil {
		return nil, nil, err
	}
	sort.Strings(included)
	sort.Strings(skipped)
	return included, skipped, nil
}

func matchesAny(candidate string, patterns []string) bool {
	for _, p := range patterns {
		if recruit.MatchPayloadGlobForImporter(p, candidate) {
			return true
		}
	}
	return false
}

func buildManifest(opts Options, upstreamRel string, skills []recruit.SkillDecl) recruit.Manifest {
	m := recruit.Manifest{
		SchemaVersion:    "crew44.agent.v1",
		Name:             opts.Name,
		Version:          opts.Version,
		Description:      opts.Description,
		Author:           opts.Author,
		Tags:             opts.Tags,
		SuggestedRuntime: opts.SuggestedRuntime,
		Skills:           skills,
	}
	if opts.Native {
		m.SourceType = recruit.SourceTypeNative
	} else {
		m.SourceType = recruit.SourceTypeUpstreamWrapper
		m.Upstream = &recruit.UpstreamMeta{
			RepoURL:    opts.RepoURL,
			Commit:     opts.Commit,
			Path:       upstreamRel,
			ImportedAt: time.Now().UTC().Format(time.RFC3339),
		}
	}
	if len(opts.PayloadInclude) > 0 || len(opts.PayloadExclude) > 0 {
		m.Payload = &recruit.PayloadSpec{
			Include: opts.PayloadInclude,
			Exclude: opts.PayloadExclude,
		}
	} else if !opts.Native {
		// Wrapper repos with a wide upstream/ tree benefit from a
		// default exclude block covering common junk. Authors can
		// drop or extend this list by editing the generated manifest.
		m.Payload = &recruit.PayloadSpec{
			Include: defaultWrapperInclude(upstreamRel, skills),
			Exclude: []string{".git/**", "**/.git/**", "**/node_modules/**", "**/.DS_Store"},
		}
	}
	return m
}

func defaultWrapperInclude(upstreamRel string, skills []recruit.SkillDecl) []string {
	out := []string{"AGENT.md", "crew44-agent.json"}
	for _, s := range skills {
		out = append(out, s.Path)
	}
	out = append(out, upstreamRel+"/**")
	return out
}

func marshalManifest(m recruit.Manifest) ([]byte, error) {
	data, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return nil, err
	}
	return append(data, '\n'), nil
}

func writeNoOverwrite(path string, data []byte) error {
	if _, err := os.Stat(path); err == nil {
		return fmt.Errorf("importer: refusing to overwrite %s", path)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

//go:embed templates/AGENT.md.tmpl
var agentMDTemplate string

//go:embed templates/IMPORT_REPORT.md.tmpl
var importReportTemplate string

// renderAgentMDTemplate is the deterministic fallback when no Generator
// is configured. It produces a usable AGENT.md a human can ship or
// refine before publishing.
func renderAgentMDTemplate(opts Options, upstreamRel string, skills []recruit.SkillDecl) string {
	type tplData struct {
		Name        string
		Description string
		RepoURL     string
		UpstreamRel string
		Skills      []recruit.SkillDecl
		Native      bool
	}
	d := tplData{
		Name:        opts.Name,
		Description: opts.Description,
		RepoURL:     opts.RepoURL,
		UpstreamRel: upstreamRel,
		Skills:      skills,
		Native:      opts.Native,
	}
	return renderInlineTemplate(agentMDTemplate, d)
}

func renderImportReport(opts Options, manifest recruit.Manifest, skills []recruit.SkillDecl, included, skipped []string, commit string) string {
	type tplData struct {
		Name       string
		RepoURL    string
		Version    string
		Commit     string
		ImportedAt string
		Native     bool
		Skills     []recruit.SkillDecl
		Included   []string
		Skipped    []string
	}
	d := tplData{
		Name:       opts.Name,
		RepoURL:    opts.RepoURL,
		Version:    opts.Version,
		Commit:     commit,
		ImportedAt: time.Now().UTC().Format(time.RFC3339),
		Native:     opts.Native,
		Skills:     skills,
		Included:   included,
		Skipped:    skipped,
	}
	return renderInlineTemplate(importReportTemplate, d)
}

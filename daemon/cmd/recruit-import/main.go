// Command recruit-import packages an arbitrary GitHub repository as
// a Crew44 wrapper agent repo with a root AGENT.md and crew44-agent.json.
//
// Two fetch strategies are supported:
//
//   - --from-dir  copy an existing local checkout (useful for tests
//     and for repos already cloned by the operator).
//   - default     download the GitHub tarball at the pinned ref via
//     codeload.github.com.
//
// The deterministic generation path is enough to produce a publishable
// wrapper. A runtime-adapter generator hook is exposed by the importer
// package for callers that want LLM-drafted AGENT.md; this CLI keeps
// the dependency surface narrow and always uses the deterministic
// template.
package main

import (
	"flag"
	"fmt"
	"net/http"
	"os"
	"strings"

	"github.com/getcrew44/crew44/daemon/internal/recruit"
	"github.com/getcrew44/crew44/daemon/internal/recruit/importer"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "recruit-import: "+err.Error())
		os.Exit(1)
	}
}

func run(args []string) error {
	fs := flag.NewFlagSet("recruit-import", flag.ContinueOnError)
	repoURL := fs.String("repo", "", "Upstream GitHub repo URL (required)")
	name := fs.String("name", "", "Agent display name (required)")
	desc := fs.String("description", "", "Agent description (required)")
	version := fs.String("version", "", "Agent version, e.g. 1.0.0 (required)")
	author := fs.String("author", "", "Optional author string")
	tagsCSV := fs.String("tags", "", "Comma-separated agent tags")
	suggested := fs.String("suggested-runtime", "", "Display-only runtime hint (claude/codex/...)")
	out := fs.String("out", "", "Output directory for the generated wrapper repo (required)")
	native := fs.Bool("native", false, "Skip the upstream/ wrapper and treat the source as a native Crew44 layout")
	upstreamPath := fs.String("upstream-path", "", "Override the upstream subdirectory name (default 'upstream')")
	fromDir := fs.String("from-dir", "", "Copy from an existing local repo instead of downloading the tarball")
	ref := fs.String("ref", "HEAD", "Upstream ref to download when --from-dir is not set")
	if err := fs.Parse(args); err != nil {
		return err
	}

	opts := importer.Options{
		RepoURL:          *repoURL,
		Name:             *name,
		Description:      *desc,
		Version:          *version,
		Author:           *author,
		Tags:             splitTags(*tagsCSV),
		SuggestedRuntime: *suggested,
		OutputDir:        *out,
		Native:           *native,
		UpstreamPath:     *upstreamPath,
	}

	fetcher, err := pickFetcher(*fromDir, *repoURL, *ref)
	if err != nil {
		return err
	}

	result, err := importer.Run(opts, fetcher, nil)
	if err != nil {
		return err
	}

	fmt.Println("Wrote " + result.OutputDir)
	fmt.Println("  - " + result.ManifestPath)
	fmt.Println("  - " + result.AgentMDPath)
	fmt.Println("  - " + result.ImportReportPath)
	fmt.Println()
	fmt.Printf("Detected %d skill(s).\n\n", len(result.DetectedSkills))
	fmt.Println("Next steps:")
	for _, line := range result.NextSteps {
		fmt.Println("  " + line)
	}
	return nil
}

func splitTags(csv string) []string {
	if strings.TrimSpace(csv) == "" {
		return nil
	}
	parts := strings.Split(csv, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func pickFetcher(fromDir, repoURL, ref string) (importer.Fetcher, error) {
	if strings.TrimSpace(fromDir) != "" {
		return importer.NewDirFetcher(fromDir), nil
	}
	if strings.TrimSpace(repoURL) == "" {
		return nil, fmt.Errorf("--repo is required when --from-dir is not set")
	}
	coord, err := recruit.ParseGitHubRepoForImporter(repoURL)
	if err != nil {
		return nil, err
	}
	return importer.NewTarballFetcher(http.DefaultClient, "", coord.Owner, coord.Repo, ref), nil
}

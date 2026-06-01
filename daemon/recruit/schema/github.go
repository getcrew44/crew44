package schema

import (
	"fmt"
	"net/url"
	"strings"
)

// RepoCoord captures the owner/repo pair parsed from a GitHub repo URL.
type RepoCoord struct {
	Owner string
	Repo  string
}

// ParseGitHubRepo accepts forms like https://github.com/owner/repo or
// https://github.com/owner/repo.git and returns the owner/repo coordinate.
// Returns ErrRepoURLInvalid for any non-github.com host or malformed
// path so callers can map the failure to a clear user-facing error.
func ParseGitHubRepo(repoURL string) (RepoCoord, error) {
	u, err := url.Parse(strings.TrimSpace(repoURL))
	if err != nil {
		return RepoCoord{}, fmt.Errorf("%w: %v", ErrRepoURLInvalid, err)
	}
	if u.Host != "github.com" {
		return RepoCoord{}, fmt.Errorf("%w: only github.com repos are supported (got %q)", ErrRepoURLInvalid, u.Host)
	}
	parts := strings.Split(strings.Trim(u.Path, "/"), "/")
	if len(parts) < 2 || parts[0] == "" || parts[1] == "" {
		return RepoCoord{}, fmt.Errorf("%w: missing owner/repo in %s", ErrRepoURLInvalid, repoURL)
	}
	return RepoCoord{Owner: parts[0], Repo: strings.TrimSuffix(parts[1], ".git")}, nil
}

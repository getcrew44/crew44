package recruit

import (
	"fmt"
	"net/url"
	"path"
	"strings"

	"github.com/getcrew44/crew44/daemon/recruit/schema"
)

// repoCoord captures the owner/repo pair parsed from a GitHub repo URL.
type repoCoord struct {
	Owner string
	Repo  string
}

// parseGitHubRepo accepts forms like https://github.com/owner/repo or
// https://github.com/owner/repo.git and returns the owner/repo coordinate.
// The parse rules (and ErrRepoURLInvalid) live in the public schema
// package so the importer applies the same validation; this thin wrapper
// adapts the result to the unexported runtime coord type.
func parseGitHubRepo(repoURL string) (repoCoord, error) {
	c, err := schema.ParseGitHubRepo(repoURL)
	if err != nil {
		return repoCoord{}, err
	}
	return repoCoord{Owner: c.Owner, Repo: c.Repo}, nil
}

// rawFileURL builds a {base}/owner/repo/ref/path URL. base is configurable
// so tests can point at an httptest server; in production it is
// https://raw.githubusercontent.com.
func rawFileURL(base string, c repoCoord, ref, filePath string) string {
	cleaned := path.Clean("/" + filePath)
	cleaned = strings.TrimPrefix(cleaned, "/")
	return fmt.Sprintf(
		"%s/%s/%s/%s/%s",
		strings.TrimRight(base, "/"),
		url.PathEscape(c.Owner),
		url.PathEscape(c.Repo),
		url.PathEscape(ref),
		cleaned,
	)
}

// candidateRefs returns the tag forms to try when resolving manifest
// version "X" to a real ref. GitHub convention favors v-prefixed tags;
// some authors omit the prefix. Try both, in order.
func candidateRefs(version string) []string {
	v := strings.TrimSpace(version)
	if v == "" {
		return nil
	}
	if strings.HasPrefix(v, "v") {
		return []string{v, strings.TrimPrefix(v, "v")}
	}
	return []string{"v" + v, v}
}

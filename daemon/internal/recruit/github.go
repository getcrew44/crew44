package recruit

import (
	"fmt"
	"net/url"
	"path"
	"strings"
)

// repoCoord captures the owner/repo pair parsed from a GitHub repo URL.
type repoCoord struct {
	Owner string
	Repo  string
}

// parseGitHubRepo accepts forms like https://github.com/owner/repo or
// https://github.com/owner/repo.git and returns the owner/repo coordinate.
// Returns an error for any non-github.com host so the install path can
// give a clear "only github.com is supported in v1" message.
func parseGitHubRepo(repoURL string) (repoCoord, error) {
	u, err := url.Parse(strings.TrimSpace(repoURL))
	if err != nil {
		return repoCoord{}, fmt.Errorf("invalid repo url: %w", err)
	}
	if u.Host != "github.com" {
		return repoCoord{}, fmt.Errorf("only github.com repos are supported (got %q)", u.Host)
	}
	parts := strings.Split(strings.Trim(u.Path, "/"), "/")
	if len(parts) < 2 || parts[0] == "" || parts[1] == "" {
		return repoCoord{}, fmt.Errorf("repo url missing owner/repo: %s", repoURL)
	}
	return repoCoord{Owner: parts[0], Repo: strings.TrimSuffix(parts[1], ".git")}, nil
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

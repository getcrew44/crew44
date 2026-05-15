package main

import (
	"fmt"
	"runtime/debug"
	"strings"
)

type buildMetadata struct {
	GitRef   string
	VCSTime  string
	Modified string
}

func currentBuildMetadata() buildMetadata {
	var meta buildMetadata

	info, ok := debug.ReadBuildInfo()
	if !ok {
		return meta
	}

	for _, setting := range info.Settings {
		switch setting.Key {
		case "vcs.revision":
			meta.GitRef = setting.Value
		case "vcs.time":
			meta.VCSTime = setting.Value
		case "vcs.modified":
			meta.Modified = setting.Value
		}
	}

	return meta
}

func (m buildMetadata) LogFields() string {
	var fields []string
	if value := strings.TrimSpace(m.GitRef); value != "" {
		fields = append(fields, fmt.Sprintf("git_ref=%s", value))
	}
	if value := strings.TrimSpace(m.VCSTime); value != "" {
		fields = append(fields, fmt.Sprintf("vcs_time=%s", value))
	}
	if value := strings.TrimSpace(m.Modified); value != "" {
		fields = append(fields, fmt.Sprintf("vcs_modified=%s", value))
	}
	return strings.Join(fields, " ")
}

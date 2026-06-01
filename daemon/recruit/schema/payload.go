package schema

import "strings"

// ResolvedPayload is what the install flow uses after manifest parsing:
// a concrete list of include/exclude globs that already account for the
// "no payload block ⇒ sensible default" fallback.
type ResolvedPayload struct {
	Include []string
	Exclude []string
}

// ResolvePayload returns the include/exclude globs the installer should
// apply for this manifest. When the manifest omits a Payload block, the
// default is AGENT.md, crew44-agent.json, every declared skills[].path,
// and — when an upstream block is present — `{upstream.path}/**`. The
// default applies to both native and wrapper repos; an explicit Payload
// block in the manifest is used as-is.
func ResolvePayload(m *Manifest) ResolvedPayload {
	if m.Payload != nil && (len(m.Payload.Include) > 0 || len(m.Payload.Exclude) > 0) {
		out := ResolvedPayload{
			Include: append([]string(nil), m.Payload.Include...),
			Exclude: append([]string(nil), m.Payload.Exclude...),
		}
		if len(out.Include) == 0 {
			out.Include = defaultIncludes(m)
		}
		return out
	}
	return ResolvedPayload{Include: defaultIncludes(m)}
}

func defaultIncludes(m *Manifest) []string {
	out := []string{"AGENT.md", "crew44-agent.json"}
	for _, s := range m.Skills {
		out = append(out, s.Path)
	}
	if m.Upstream != nil {
		p := strings.TrimSpace(m.Upstream.Path)
		if p == "" {
			p = UpstreamPathDefault
		}
		out = append(out, p+"/**")
	}
	return out
}

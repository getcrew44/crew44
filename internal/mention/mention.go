package mention

import "regexp"

type Mention struct {
	Type string `json:"type"`
	ID   string `json:"id"`
}

var mentionRe = regexp.MustCompile(`\[@?(.+?)\]\(mention://(member|agent|issue|all)/([0-9a-fA-F-]+|all)\)`)

func ParseMentions(content string) []Mention {
	matches := mentionRe.FindAllStringSubmatch(content, -1)
	seen := make(map[string]struct{}, len(matches))
	mentions := make([]Mention, 0, len(matches))
	for _, match := range matches {
		key := match[2] + ":" + match[3]
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		mentions = append(mentions, Mention{
			Type: match[2],
			ID:   match[3],
		})
	}
	return mentions
}

func HasMentionAll(mentions []Mention) bool {
	for _, mention := range mentions {
		if mention.Type == "all" && mention.ID == "all" {
			return true
		}
	}
	return false
}

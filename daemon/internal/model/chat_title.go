package model

import "strings"

const maxChatTitleRunes = 128

// NormalizeChatTitle keeps persisted chat titles compact and list-safe.
func NormalizeChatTitle(title string) string {
	title = strings.Join(strings.Fields(title), " ")
	runes := []rune(title)
	if len(runes) <= maxChatTitleRunes {
		return title
	}
	return strings.TrimSpace(string(runes[:maxChatTitleRunes-1])) + "…"
}

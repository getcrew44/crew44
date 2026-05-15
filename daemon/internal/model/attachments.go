package model

import (
	"strings"
)

func AppendAttachmentLinks(content string, attachments []MessageAttachment) string {
	content = strings.TrimSpace(content)
	block := AttachmentMarkdown(attachments)
	if block == "" {
		return content
	}
	if content == "" {
		return block
	}
	return content + "\n\n" + block
}

func AttachmentMarkdown(attachments []MessageAttachment) string {
	lines := attachmentMarkdownLines(attachments)
	if len(lines) == 0 {
		return ""
	}
	return strings.Join(lines, "\n")
}

func attachmentMarkdownLines(attachments []MessageAttachment) []string {
	lines := make([]string, 0, len(attachments)+1)
	for _, attachment := range attachments {
		name := strings.TrimSpace(attachment.DisplayName)
		path := strings.TrimSpace(attachment.Path)
		if name == "" || path == "" {
			continue
		}
		if len(lines) == 0 {
			lines = append(lines, "Attachments:")
		}
		lines = append(lines, "- ["+escapeMarkdownLinkLabel(name)+"]("+path+")")
	}
	return lines
}

func escapeMarkdownLinkLabel(value string) string {
	value = strings.ReplaceAll(value, `\`, `\\`)
	value = strings.ReplaceAll(value, `[`, `\[`)
	value = strings.ReplaceAll(value, `]`, `\]`)
	return value
}

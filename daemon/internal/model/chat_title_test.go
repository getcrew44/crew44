package model

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestNormalizeChatTitleCollapsesWhitespaceAndTruncatesRunes(t *testing.T) {
	title := "  first line\n\nsecond\tline  "
	if got := NormalizeChatTitle(title); got != "first line second line" {
		t.Fatalf("title=%q", got)
	}

	long := strings.Repeat("界", 140)
	got := NormalizeChatTitle(long)
	if utf8.RuneCountInString(got) != 128 {
		t.Fatalf("rune count=%d want 128", utf8.RuneCountInString(got))
	}
	if !strings.HasSuffix(got, "…") {
		t.Fatalf("title should end with ellipsis: %q", got)
	}
}

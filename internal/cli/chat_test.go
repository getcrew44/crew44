package cli

import (
	"bufio"
	"strings"
	"testing"
)

func TestReadSSEFrame(t *testing.T) {
	reader := bufio.NewReader(strings.NewReader("event: chat.event\ndata: {\"seq\":1}\n\nevent: done\ndata: {\"chat_id\":\"123\"}\n\n"))

	first, err := readSSEFrame(reader)
	if err != nil {
		t.Fatalf("read first frame: %v", err)
	}
	if first.Name != "chat.event" {
		t.Fatalf("expected first frame name chat.event, got %q", first.Name)
	}
	if string(first.Data) != "{\"seq\":1}" {
		t.Fatalf("unexpected first frame data: %q", string(first.Data))
	}

	second, err := readSSEFrame(reader)
	if err != nil {
		t.Fatalf("read second frame: %v", err)
	}
	if second.Name != "done" {
		t.Fatalf("expected second frame name done, got %q", second.Name)
	}
	if string(second.Data) != "{\"chat_id\":\"123\"}" {
		t.Fatalf("unexpected second frame data: %q", string(second.Data))
	}
}

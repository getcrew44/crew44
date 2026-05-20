package store

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/getcrew44/crew44/daemon/internal/model"
)

func TestChatRecordLivesInProjectChatList(t *testing.T) {
	root := t.TempDir()
	s, err := New(root)
	if err != nil {
		t.Fatal(err)
	}

	project := model.ProjectRecord{
		ID:        "project-1",
		Name:      "Project",
		Workdir:   t.TempDir(),
		CreatedAt: time.Now().UTC(),
		UpdatedAt: time.Now().UTC(),
	}
	if err := s.SaveProject(project); err != nil {
		t.Fatal(err)
	}

	chat := testChatRecord(project.ID, "chat-1")
	if err := s.SaveChat(chat); err != nil {
		t.Fatal(err)
	}

	if _, err := os.Stat(filepath.Join(root, "chats", "chat-chat-1", "chat.json")); !os.IsNotExist(err) {
		t.Fatalf("chat.json should not exist, stat err=%v", err)
	}
	got, err := s.GetChat(chat.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Title != chat.Title {
		t.Fatalf("title=%q want %q", got.Title, chat.Title)
	}
	chats, err := s.ListChats(project.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(chats) != 1 || chats[0].ID != chat.ID {
		t.Fatalf("unexpected chats: %+v", chats)
	}
}

func TestSaveChatNormalizesLongTitle(t *testing.T) {
	root := t.TempDir()
	s, err := New(root)
	if err != nil {
		t.Fatal(err)
	}

	project := model.ProjectRecord{
		ID:        "project-1",
		Name:      "Project",
		Workdir:   t.TempDir(),
		CreatedAt: time.Now().UTC(),
		UpdatedAt: time.Now().UTC(),
	}
	if err := s.SaveProject(project); err != nil {
		t.Fatal(err)
	}

	chat := testChatRecord(project.ID, "chat-1")
	chat.Title = strings.Repeat("界", 140)
	if err := s.SaveChat(chat); err != nil {
		t.Fatal(err)
	}

	got, err := s.GetChat(chat.ID)
	if err != nil {
		t.Fatal(err)
	}
	if utf8.RuneCountInString(got.Title) != 128 || !strings.HasSuffix(got.Title, "…") {
		t.Fatalf("title=%q rune_count=%d", got.Title, utf8.RuneCountInString(got.Title))
	}
}

func TestNewMigratesLegacyChatJSONIntoProjectChatList(t *testing.T) {
	root := t.TempDir()
	projectID := "project-1"
	chat := testChatRecord(projectID, "chat-1")

	projectDir := filepath.Join(root, "projects", "proj-"+projectID)
	chatDir := filepath.Join(root, "chats", "chat-"+chat.ID)
	if err := os.MkdirAll(projectDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(chatDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := writeJSONL(filepath.Join(projectDir, "chats.jsonl"), []legacyChatIndexEntry{{ChatID: chat.ID}}); err != nil {
		t.Fatal(err)
	}
	if err := writeJSON(filepath.Join(chatDir, "chat.json"), chat); err != nil {
		t.Fatal(err)
	}

	s, err := New(root)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(chatDir, "chat.json")); !os.IsNotExist(err) {
		t.Fatalf("legacy chat.json should be removed, stat err=%v", err)
	}
	data, err := os.ReadFile(filepath.Join(projectDir, "chats.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), `"id":"chat-1"`) || strings.Contains(string(data), `"chat_id"`) {
		t.Fatalf("project chats should contain ChatRecord JSONL, got %s", string(data))
	}
	got, err := s.GetChat(chat.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.ProjectID != projectID {
		t.Fatalf("project_id=%q want %q", got.ProjectID, projectID)
	}
}

func testChatRecord(projectID, chatID string) model.ChatRecord {
	now := time.Now().UTC()
	return model.ChatRecord{
		ID:                  chatID,
		ProjectID:           projectID,
		Title:               "Demo Chat",
		MainAgentID:         "agent-1",
		CurrentAgentID:      "agent-1",
		ParticipantAgentIDs: []string{"agent-1"},
		Status:              "active",
		Stream: model.ChatStreamState{
			Status: "idle",
		},
		CreatedAt: now,
		UpdatedAt: now,
	}
}

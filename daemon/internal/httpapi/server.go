package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/sqtech/crew-ai/crewai-repo/internal/app"
	"github.com/sqtech/crew-ai/crewai-repo/internal/broker"
	"github.com/sqtech/crew-ai/crewai-repo/internal/model"
	"github.com/sqtech/crew-ai/crewai-repo/internal/runtime"
)

type ServerConfig struct {
	StateDir       string
	RuntimeScanDir string
	Scanner        runtime.Scanner
	Engine         runtime.Engine
}

type Server struct {
	app *app.App
	mux *http.ServeMux
}

func NewServer(cfg ServerConfig) (http.Handler, error) {
	application, err := app.New(app.Config{
		StateDir:       cfg.StateDir,
		RuntimeScanDir: cfg.RuntimeScanDir,
		Scanner:        cfg.Scanner,
		Engine:         cfg.Engine,
	})
	if err != nil {
		return nil, err
	}
	server := &Server{
		app: application,
		mux: http.NewServeMux(),
	}
	server.routes()
	return server, nil
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mux.ServeHTTP(w, r)
}

func (s *Server) routes() {
	s.mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"status": "ok"})
	})

	s.mux.HandleFunc("GET /api/runtimes", s.handleListRuntimes)
	s.mux.HandleFunc("POST /api/runtimes/rescan", s.handleRescanRuntimes)
	s.mux.HandleFunc("GET /api/runtimes/{id}", s.handleGetRuntime)
	s.mux.HandleFunc("POST /api/runtimes/{id}/update", s.handleUpdateRuntime)

	s.mux.HandleFunc("GET /api/agents", s.handleListAgents)
	s.mux.HandleFunc("POST /api/agents", s.handleCreateAgent)
	s.mux.HandleFunc("GET /api/agents/{id}", s.handleGetAgent)
	s.mux.HandleFunc("PUT /api/agents/{id}", s.handleUpdateAgent)
	s.mux.HandleFunc("POST /api/agents/{id}/archive", s.handleArchiveAgent)
	s.mux.HandleFunc("POST /api/agents/{id}/restore", s.handleRestoreAgent)
	s.mux.HandleFunc("PUT /api/agents/{id}/skills", s.handleReplaceAgentSkills)

	s.mux.HandleFunc("GET /api/skills", s.handleListSkills)
	s.mux.HandleFunc("POST /api/skills", s.handleCreateSkill)
	s.mux.HandleFunc("GET /api/skills/{id}", s.handleGetSkill)
	s.mux.HandleFunc("PUT /api/skills/{id}", s.handleUpdateSkill)
	s.mux.HandleFunc("DELETE /api/skills/{id}", s.handleDeleteSkill)
	s.mux.HandleFunc("GET /api/skills/{id}/files", s.handleListSkillFiles)
	s.mux.HandleFunc("PUT /api/skills/{id}/files", s.handlePutSkillFile)
	s.mux.HandleFunc("DELETE /api/skills/{id}/files/{fileId...}", s.handleDeleteSkillFile)

	s.mux.HandleFunc("GET /api/projects", s.handleListProjects)
	s.mux.HandleFunc("POST /api/projects", s.handleCreateProject)
	s.mux.HandleFunc("GET /api/projects/{id}", s.handleGetProject)
	s.mux.HandleFunc("PUT /api/projects/{id}", s.handleUpdateProject)
	s.mux.HandleFunc("DELETE /api/projects/{id}", s.handleDeleteProject)
	s.mux.HandleFunc("GET /api/projects/{id}/chats", s.handleListProjectChats)

	s.mux.HandleFunc("POST /api/chat/sessions", s.handleCreateChat)
	s.mux.HandleFunc("GET /api/chat/sessions", s.handleListChats)
	s.mux.HandleFunc("GET /api/chat/sessions/{id}", s.handleGetChat)
	s.mux.HandleFunc("PUT /api/chat/sessions/{id}", s.handleUpdateChat)
	s.mux.HandleFunc("DELETE /api/chat/sessions/{id}", s.handleDeleteChat)
	s.mux.HandleFunc("POST /api/chat/sessions/{id}/messages", s.handlePostMessage)
	s.mux.HandleFunc("GET /api/chat/sessions/{id}/events", s.handleGetEvents)
	s.mux.HandleFunc("POST /api/chat/sessions/{id}/cancel", s.handleCancelChat)
}

func (s *Server) handleListRuntimes(w http.ResponseWriter, r *http.Request) {
	items, err := s.app.ListRuntimes()
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) handleRescanRuntimes(w http.ResponseWriter, r *http.Request) {
	items, err := s.app.RescanRuntimes()
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) handleGetRuntime(w http.ResponseWriter, r *http.Request) {
	item, err := s.app.GetRuntime(r.PathValue("id"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleUpdateRuntime(w http.ResponseWriter, r *http.Request) {
	var body map[string]any
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, app.ErrBadRequest)
		return
	}
	item, err := s.app.UpdateRuntime(r.PathValue("id"), body)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleListAgents(w http.ResponseWriter, r *http.Request) {
	items, err := s.app.ListAgents()
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) handleCreateAgent(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name        string `json:"name"`
		Instruction string `json:"instruction"`
		RuntimeID   string `json:"runtime_id"`
		Model       string `json:"model"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, app.ErrBadRequest)
		return
	}
	item, err := s.app.CreateAgent(body.Name, body.Instruction, body.RuntimeID, body.Model)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) handleGetAgent(w http.ResponseWriter, r *http.Request) {
	item, err := s.app.GetAgent(r.PathValue("id"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleUpdateAgent(w http.ResponseWriter, r *http.Request) {
	var body model.AgentConfig
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, app.ErrBadRequest)
		return
	}
	body.ID = r.PathValue("id")
	item, err := s.app.UpdateAgent(body)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleArchiveAgent(w http.ResponseWriter, r *http.Request) {
	item, err := s.app.SetAgentArchived(r.PathValue("id"), true)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleRestoreAgent(w http.ResponseWriter, r *http.Request) {
	item, err := s.app.SetAgentArchived(r.PathValue("id"), false)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleReplaceAgentSkills(w http.ResponseWriter, r *http.Request) {
	var body struct {
		SkillIDs []string `json:"skill_ids"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, app.ErrBadRequest)
		return
	}
	item, err := s.app.ReplaceAgentSkills(r.PathValue("id"), body.SkillIDs)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleListSkills(w http.ResponseWriter, r *http.Request) {
	items, err := s.app.ListSkills()
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) handleCreateSkill(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name string `json:"name"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, app.ErrBadRequest)
		return
	}
	item, err := s.app.CreateSkill(body.Name)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) handleGetSkill(w http.ResponseWriter, r *http.Request) {
	item, err := s.app.GetSkill(r.PathValue("id"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleUpdateSkill(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name string `json:"name"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, app.ErrBadRequest)
		return
	}
	item, err := s.app.UpdateSkill(r.PathValue("id"), body.Name)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleDeleteSkill(w http.ResponseWriter, r *http.Request) {
	if err := s.app.DeleteSkill(r.PathValue("id")); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleListSkillFiles(w http.ResponseWriter, r *http.Request) {
	items, err := s.app.ListSkillFiles(r.PathValue("id"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) handlePutSkillFile(w http.ResponseWriter, r *http.Request) {
	var body struct {
		FileID  string `json:"file_id"`
		Content string `json:"content"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, app.ErrBadRequest)
		return
	}
	if body.FileID == "" {
		body.FileID = "SKILL.md"
	}
	if err := s.app.PutSkillFile(r.PathValue("id"), body.FileID, body.Content); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleDeleteSkillFile(w http.ResponseWriter, r *http.Request) {
	if err := s.app.DeleteSkillFile(r.PathValue("id"), r.PathValue("fileId")); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleListProjects(w http.ResponseWriter, r *http.Request) {
	items, err := s.app.ListProjects()
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) handleCreateProject(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name        string `json:"name"`
		Workdir     string `json:"workdir"`
		MainAgentID string `json:"main_agent_id"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, app.ErrBadRequest)
		return
	}
	item, err := s.app.CreateProject(body.Name, body.Workdir, body.MainAgentID)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) handleGetProject(w http.ResponseWriter, r *http.Request) {
	item, err := s.app.GetProject(r.PathValue("id"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleUpdateProject(w http.ResponseWriter, r *http.Request) {
	var body model.ProjectRecord
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, app.ErrBadRequest)
		return
	}
	body.ID = r.PathValue("id")
	item, err := s.app.UpdateProject(body)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleDeleteProject(w http.ResponseWriter, r *http.Request) {
	if err := s.app.DeleteProject(r.PathValue("id")); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleListProjectChats(w http.ResponseWriter, r *http.Request) {
	items, err := s.app.ListProjectChats(r.PathValue("id"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) handleCreateChat(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ProjectID   string `json:"project_id"`
		Title       string `json:"title"`
		MainAgentID string `json:"main_agent_id"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, app.ErrBadRequest)
		return
	}
	item, err := s.app.CreateChat(body.ProjectID, body.Title, body.MainAgentID)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) handleListChats(w http.ResponseWriter, r *http.Request) {
	projectID := r.URL.Query().Get("project_id")
	items, err := s.app.ListChats(projectID)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) handleGetChat(w http.ResponseWriter, r *http.Request) {
	item, err := s.app.GetChat(r.PathValue("id"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleUpdateChat(w http.ResponseWriter, r *http.Request) {
	var body model.ChatRecord
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, app.ErrBadRequest)
		return
	}
	body.ID = r.PathValue("id")
	item, err := s.app.UpdateChat(body)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleDeleteChat(w http.ResponseWriter, r *http.Request) {
	if err := s.app.DeleteChat(r.PathValue("id")); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handlePostMessage(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Content       string `json:"content"`
		TargetAgentID string `json:"target_agent_id"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, app.ErrBadRequest)
		return
	}
	item, err := s.app.PostMessage(r.PathValue("id"), body.Content, body.TargetAgentID)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusAccepted, item)
}

func (s *Server) handleGetEvents(w http.ResponseWriter, r *http.Request) {
	chatID := r.PathValue("id")
	after, _ := strconv.ParseInt(r.URL.Query().Get("after"), 10, 64)
	follow := r.URL.Query().Get("follow") == "1" || strings.Contains(r.Header.Get("Accept"), "text/event-stream")
	events, err := s.app.ListEvents(chatID, after)
	if err != nil && !errors.Is(err, app.ErrNotFound) {
		writeError(w, err)
		return
	}
	if !follow {
		writeJSON(w, http.StatusOK, map[string]any{"events": events})
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, fmt.Errorf("streaming unsupported"))
		return
	}

	sub, cancel := s.app.Subscribe(chatID)
	defer cancel()

	for _, event := range events {
		writeSSE(w, "chat.event", event)
	}

	chat, err := s.app.GetChat(chatID)
	if err != nil || chat.Stream.Status != "streaming" {
		writeSSE(w, "done", map[string]any{"chat_id": chatID})
		flusher.Flush()
		return
	}
	flusher.Flush()

	for {
		select {
		case <-r.Context().Done():
			return
		case notification := <-sub:
			switch notification.Kind {
			case broker.KindEvent:
				writeSSE(w, "chat.event", notification.Value)
			case broker.KindDone:
				writeSSE(w, "done", map[string]any{"chat_id": chatID})
				flusher.Flush()
				return
			case broker.KindError:
				writeSSE(w, "error", map[string]any{"message": notification.Error})
				flusher.Flush()
				return
			}
			flusher.Flush()
		}
	}
}

func (s *Server) handleCancelChat(w http.ResponseWriter, r *http.Request) {
	if err := s.app.CancelChat(r.PathValue("id")); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func decodeJSON(r *http.Request, out any) error {
	defer r.Body.Close()
	return json.NewDecoder(r.Body).Decode(out)
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeSSE(w http.ResponseWriter, name string, value any) {
	data, _ := json.Marshal(value)
	_, _ = fmt.Fprintf(w, "event: %s\ndata: %s\n\n", name, data)
}

func writeError(w http.ResponseWriter, err error) {
	status := http.StatusInternalServerError
	switch {
	case errors.Is(err, app.ErrBadRequest):
		status = http.StatusBadRequest
	case errors.Is(err, app.ErrNotFound):
		status = http.StatusNotFound
	case errors.Is(err, app.ErrConflict):
		status = http.StatusConflict
	}
	writeJSON(w, status, map[string]any{"error": err.Error()})
}

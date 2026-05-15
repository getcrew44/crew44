package rpc

import (
	"context"
	"encoding/json"

	"github.com/getcrew44/crew44/daemon/internal/app"
	"github.com/getcrew44/crew44/daemon/internal/model"
)

type methodHandler func(context.Context, Peer, json.RawMessage) (any, error)

func (s *Server) registerMethods() {
	s.methods = map[string]methodHandler{
		"system.health":             s.systemHealth,
		"remote.status":             s.remoteStatus,
		"remote.pairing.create":     s.remotePairingCreate,
		"remote.devices.list":       s.remoteDevicesList,
		"remote.devices.delete":     s.remoteDevicesDelete,
		"onboarding.get":            s.onboardingGet,
		"onboarding.complete":       s.onboardingComplete,
		"runtimes.list":             s.runtimesList,
		"runtimes.rescan":           s.runtimesRescan,
		"runtimes.get":              s.runtimesGet,
		"runtimes.update":           s.runtimesUpdate,
		"agents.list":               s.agentsList,
		"agents.create":             s.agentsCreate,
		"agents.get":                s.agentsGet,
		"agents.update":             s.agentsUpdate,
		"agents.archive":            s.agentsArchive,
		"agents.restore":            s.agentsRestore,
		"agents.skills.replace":     s.agentsSkillsReplace,
		"agents.preset.reset":       s.agentsPresetReset,
		"presets.list":              s.presetsList,
		"presets.defaultCrew.seed":  s.presetsDefaultCrewSeed,
		"presets.defaultCrew.reset": s.presetsDefaultCrewReset,
		"skills.list":               s.skillsList,
		"skills.create":             s.skillsCreate,
		"skills.get":                s.skillsGet,
		"skills.update":             s.skillsUpdate,
		"skills.delete":             s.skillsDelete,
		"skills.files.list":         s.skillsFilesList,
		"skills.files.put":          s.skillsFilesPut,
		"skills.files.delete":       s.skillsFilesDelete,
		"projects.list":             s.projectsList,
		"projects.create":           s.projectsCreate,
		"projects.get":              s.projectsGet,
		"projects.update":           s.projectsUpdate,
		"projects.delete":           s.projectsDelete,
		"projects.chats.list":       s.projectsChatsList,
		"chats.create":              s.chatsCreate,
		"chats.list":                s.chatsList,
		"chats.get":                 s.chatsGet,
		"chats.update":              s.chatsUpdate,
		"chats.delete":              s.chatsDelete,
		"chats.messages.post":       s.chatsMessagesPost,
		"chats.events.list":         s.chatsEventsList,
		"chats.events.subscribe":    s.chatsEventsSubscribe,
		"chats.events.unsubscribe":  s.chatsEventsUnsubscribe,
		"chats.cancel":              s.chatsCancel,

		"optimizer.suggestions.list": s.optimizerSuggestionsList,
		"optimizer.scan.run":         s.optimizerScanRun,
		"optimizer.suggestions.act":  s.optimizerSuggestionsAct,
		"optimizer.schedule.get":     s.optimizerScheduleGet,
		"optimizer.schedule.set":     s.optimizerScheduleSet,
		"optimizer.scans.get":        s.optimizerScansGet,
		"optimizer.scans.purge":      s.optimizerScansPurge,
	}
}

func (s *Server) Handle(ctx context.Context, conn Peer, req Request) (any, error) {
	if req.JSONRPC != Version || req.Method == "" {
		return nil, app.ErrBadRequest
	}
	handler := s.methods[req.Method]
	if handler == nil {
		return nil, errMethodNotFound
	}
	return handler(ctx, conn, req.Params)
}

func (s *Server) systemHealth(context.Context, Peer, json.RawMessage) (any, error) {
	return map[string]string{"status": "ok"}, nil
}

func (s *Server) remoteStatus(ctx context.Context, _ Peer, _ json.RawMessage) (any, error) {
	if s.remote == nil {
		return nil, errMethodNotFound
	}
	return s.remote.Status(ctx)
}

func (s *Server) remotePairingCreate(ctx context.Context, _ Peer, params json.RawMessage) (any, error) {
	if s.remote == nil {
		return nil, errMethodNotFound
	}
	var body struct {
		RelayURL string `json:"relay_url"`
	}
	if err := decodeParams(params, &body); err != nil {
		return nil, err
	}
	return s.remote.CreatePairing(ctx, body.RelayURL)
}

func (s *Server) remoteDevicesList(ctx context.Context, _ Peer, _ json.RawMessage) (any, error) {
	if s.remote == nil {
		return nil, errMethodNotFound
	}
	return s.remote.ListDevices(ctx)
}

func (s *Server) remoteDevicesDelete(ctx context.Context, _ Peer, params json.RawMessage) (any, error) {
	if s.remote == nil {
		return nil, errMethodNotFound
	}
	var body struct {
		DeviceID string `json:"device_id"`
	}
	if err := decodeParams(params, &body); err != nil {
		return nil, err
	}
	return s.remote.DeleteDevice(ctx, body.DeviceID)
}

func (s *Server) onboardingGet(context.Context, Peer, json.RawMessage) (any, error) {
	return s.app.GetOnboardingStatus()
}

func (s *Server) onboardingComplete(context.Context, Peer, json.RawMessage) (any, error) {
	return s.app.CompleteOnboarding()
}

func (s *Server) runtimesList(context.Context, Peer, json.RawMessage) (any, error) {
	items, err := s.app.ListRuntimes()
	return map[string]any{"items": items}, err
}

func (s *Server) runtimesRescan(context.Context, Peer, json.RawMessage) (any, error) {
	items, err := s.app.RescanRuntimes()
	return map[string]any{"items": items}, err
}

func (s *Server) runtimesGet(_ context.Context, _ Peer, params json.RawMessage) (any, error) {
	var body struct {
		ID string `json:"id"`
	}
	if err := decodeParams(params, &body); err != nil {
		return nil, err
	}
	return s.app.GetRuntime(body.ID)
}

func (s *Server) runtimesUpdate(_ context.Context, _ Peer, params json.RawMessage) (any, error) {
	var body struct {
		ID    string         `json:"id"`
		Patch map[string]any `json:"patch"`
	}
	if err := decodeParams(params, &body); err != nil {
		return nil, err
	}
	return s.app.UpdateRuntime(body.ID, body.Patch)
}

func (s *Server) agentsList(context.Context, Peer, json.RawMessage) (any, error) {
	items, err := s.app.ListAgents()
	return map[string]any{"items": items}, err
}

func (s *Server) agentsCreate(_ context.Context, _ Peer, params json.RawMessage) (any, error) {
	var body struct {
		Name        string `json:"name"`
		Instruction string `json:"instruction"`
		RuntimeID   string `json:"runtime_id"`
		Model       string `json:"model"`
	}
	if err := decodeParams(params, &body); err != nil {
		return nil, err
	}
	return s.app.CreateAgent(body.Name, body.Instruction, body.RuntimeID, body.Model)
}

func (s *Server) agentsGet(_ context.Context, _ Peer, params json.RawMessage) (any, error) {
	var body struct {
		ID string `json:"id"`
	}
	if err := decodeParams(params, &body); err != nil {
		return nil, err
	}
	return s.app.GetAgent(body.ID)
}

func (s *Server) agentsUpdate(_ context.Context, _ Peer, params json.RawMessage) (any, error) {
	var body model.AgentConfig
	if err := decodeParams(params, &body); err != nil {
		return nil, err
	}
	return s.app.UpdateAgent(body)
}

func (s *Server) agentsArchive(_ context.Context, _ Peer, params json.RawMessage) (any, error) {
	var body struct {
		ID string `json:"id"`
	}
	if err := decodeParams(params, &body); err != nil {
		return nil, err
	}
	return s.app.SetAgentArchived(body.ID, true)
}

func (s *Server) agentsRestore(_ context.Context, _ Peer, params json.RawMessage) (any, error) {
	var body struct {
		ID string `json:"id"`
	}
	if err := decodeParams(params, &body); err != nil {
		return nil, err
	}
	return s.app.SetAgentArchived(body.ID, false)
}

func (s *Server) agentsSkillsReplace(_ context.Context, _ Peer, params json.RawMessage) (any, error) {
	var body struct {
		ID       string   `json:"id"`
		SkillIDs []string `json:"skill_ids"`
	}
	if err := decodeParams(params, &body); err != nil {
		return nil, err
	}
	return s.app.ReplaceAgentSkills(body.ID, body.SkillIDs)
}

func (s *Server) agentsPresetReset(_ context.Context, _ Peer, params json.RawMessage) (any, error) {
	var body struct {
		ID string `json:"id"`
	}
	if err := decodeParams(params, &body); err != nil {
		return nil, err
	}
	return s.app.ResetAgentPreset(body.ID)
}

func (s *Server) presetsList(context.Context, Peer, json.RawMessage) (any, error) {
	items, err := s.app.ListPresets()
	return map[string]any{"items": items}, err
}

func (s *Server) presetsDefaultCrewSeed(context.Context, Peer, json.RawMessage) (any, error) {
	return s.app.SeedDefaultCrew()
}

func (s *Server) presetsDefaultCrewReset(context.Context, Peer, json.RawMessage) (any, error) {
	return s.app.ResetDefaultCrew()
}

func (s *Server) skillsList(context.Context, Peer, json.RawMessage) (any, error) {
	items, err := s.app.ListSkills()
	return map[string]any{"items": items}, err
}

func (s *Server) skillsCreate(_ context.Context, _ Peer, params json.RawMessage) (any, error) {
	var body struct {
		Name string `json:"name"`
	}
	if err := decodeParams(params, &body); err != nil {
		return nil, err
	}
	return s.app.CreateSkill(body.Name)
}

func (s *Server) skillsGet(_ context.Context, _ Peer, params json.RawMessage) (any, error) {
	var body struct {
		ID string `json:"id"`
	}
	if err := decodeParams(params, &body); err != nil {
		return nil, err
	}
	return s.app.GetSkill(body.ID)
}

func (s *Server) skillsUpdate(_ context.Context, _ Peer, params json.RawMessage) (any, error) {
	var body struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	if err := decodeParams(params, &body); err != nil {
		return nil, err
	}
	return s.app.UpdateSkill(body.ID, body.Name)
}

func (s *Server) skillsDelete(_ context.Context, _ Peer, params json.RawMessage) (any, error) {
	var body struct {
		ID string `json:"id"`
	}
	if err := decodeParams(params, &body); err != nil {
		return nil, err
	}
	if err := s.app.DeleteSkill(body.ID); err != nil {
		return nil, err
	}
	return map[string]any{"ok": true}, nil
}

func (s *Server) skillsFilesList(_ context.Context, _ Peer, params json.RawMessage) (any, error) {
	var body struct {
		ID string `json:"id"`
	}
	if err := decodeParams(params, &body); err != nil {
		return nil, err
	}
	items, err := s.app.ListSkillFiles(body.ID)
	return map[string]any{"items": items}, err
}

func (s *Server) skillsFilesPut(_ context.Context, _ Peer, params json.RawMessage) (any, error) {
	var body struct {
		ID      string `json:"id"`
		FileID  string `json:"file_id"`
		Content string `json:"content"`
	}
	if err := decodeParams(params, &body); err != nil {
		return nil, err
	}
	if body.FileID == "" {
		body.FileID = "SKILL.md"
	}
	if err := s.app.PutSkillFile(body.ID, body.FileID, body.Content); err != nil {
		return nil, err
	}
	return map[string]any{"ok": true}, nil
}

func (s *Server) skillsFilesDelete(_ context.Context, _ Peer, params json.RawMessage) (any, error) {
	var body struct {
		ID     string `json:"id"`
		FileID string `json:"file_id"`
	}
	if err := decodeParams(params, &body); err != nil {
		return nil, err
	}
	if err := s.app.DeleteSkillFile(body.ID, body.FileID); err != nil {
		return nil, err
	}
	return map[string]any{"ok": true}, nil
}

func (s *Server) projectsList(context.Context, Peer, json.RawMessage) (any, error) {
	items, err := s.app.ListProjects()
	return map[string]any{"items": items}, err
}

func (s *Server) projectsCreate(_ context.Context, _ Peer, params json.RawMessage) (any, error) {
	var body struct {
		Name        string `json:"name"`
		Workdir     string `json:"workdir"`
		MainAgentID string `json:"main_agent_id"`
	}
	if err := decodeParams(params, &body); err != nil {
		return nil, err
	}
	return s.app.CreateProject(body.Name, body.Workdir, body.MainAgentID)
}

func (s *Server) projectsGet(_ context.Context, _ Peer, params json.RawMessage) (any, error) {
	var body struct {
		ID string `json:"id"`
	}
	if err := decodeParams(params, &body); err != nil {
		return nil, err
	}
	return s.app.GetProject(body.ID)
}

func (s *Server) projectsUpdate(_ context.Context, _ Peer, params json.RawMessage) (any, error) {
	var body model.ProjectRecord
	if err := decodeParams(params, &body); err != nil {
		return nil, err
	}
	return s.app.UpdateProject(body)
}

func (s *Server) projectsDelete(_ context.Context, _ Peer, params json.RawMessage) (any, error) {
	var body struct {
		ID string `json:"id"`
	}
	if err := decodeParams(params, &body); err != nil {
		return nil, err
	}
	if err := s.app.DeleteProject(body.ID); err != nil {
		return nil, err
	}
	return map[string]any{"ok": true}, nil
}

func (s *Server) projectsChatsList(_ context.Context, _ Peer, params json.RawMessage) (any, error) {
	var body struct {
		ID string `json:"id"`
	}
	if err := decodeParams(params, &body); err != nil {
		return nil, err
	}
	items, err := s.app.ListProjectChats(body.ID)
	return map[string]any{"items": items}, err
}

func (s *Server) chatsCreate(_ context.Context, _ Peer, params json.RawMessage) (any, error) {
	var body struct {
		ProjectID   string `json:"project_id"`
		Title       string `json:"title"`
		MainAgentID string `json:"main_agent_id"`
	}
	if err := decodeParams(params, &body); err != nil {
		return nil, err
	}
	return s.app.CreateChat(body.ProjectID, body.Title, body.MainAgentID)
}

func (s *Server) chatsList(_ context.Context, _ Peer, params json.RawMessage) (any, error) {
	var body struct {
		ProjectID string `json:"project_id"`
	}
	if err := decodeParams(params, &body); err != nil {
		return nil, err
	}
	items, err := s.app.ListChats(body.ProjectID)
	return map[string]any{"items": items}, err
}

func (s *Server) chatsGet(_ context.Context, _ Peer, params json.RawMessage) (any, error) {
	var body struct {
		ID string `json:"id"`
	}
	if err := decodeParams(params, &body); err != nil {
		return nil, err
	}
	return s.app.GetChat(body.ID)
}

func (s *Server) chatsUpdate(_ context.Context, _ Peer, params json.RawMessage) (any, error) {
	var body model.ChatRecord
	if err := decodeParams(params, &body); err != nil {
		return nil, err
	}
	return s.app.UpdateChat(body)
}

func (s *Server) chatsDelete(_ context.Context, _ Peer, params json.RawMessage) (any, error) {
	var body struct {
		ID string `json:"id"`
	}
	if err := decodeParams(params, &body); err != nil {
		return nil, err
	}
	if err := s.app.DeleteChat(body.ID); err != nil {
		return nil, err
	}
	return map[string]any{"ok": true}, nil
}

func (s *Server) chatsMessagesPost(_ context.Context, _ Peer, params json.RawMessage) (any, error) {
	var body struct {
		ID            string `json:"id"`
		Content       string `json:"content"`
		TargetAgentID string `json:"target_agent_id"`
	}
	if err := decodeParams(params, &body); err != nil {
		return nil, err
	}
	return s.app.PostMessage(body.ID, body.Content, body.TargetAgentID)
}

func (s *Server) chatsEventsList(_ context.Context, _ Peer, params json.RawMessage) (any, error) {
	var body struct {
		ChatID string `json:"chat_id"`
		After  int64  `json:"after"`
	}
	if err := decodeParams(params, &body); err != nil {
		return nil, err
	}
	events, err := s.app.ListEvents(body.ChatID, body.After)
	return map[string]any{"events": events}, err
}

func (s *Server) chatsCancel(_ context.Context, _ Peer, params json.RawMessage) (any, error) {
	var body struct {
		ID string `json:"id"`
	}
	if err := decodeParams(params, &body); err != nil {
		return nil, err
	}
	if err := s.app.CancelChat(body.ID); err != nil {
		return nil, err
	}
	return map[string]any{"ok": true}, nil
}

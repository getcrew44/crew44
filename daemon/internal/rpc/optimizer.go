package rpc

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/getcrew44/crew44/daemon/internal/optimizer"
)

func (s *Server) optimizerSuggestionsList(context.Context, Peer, json.RawMessage) (any, error) {
	m := s.app.Optimizer()
	if m == nil {
		return nil, errors.New("optimizer not initialized")
	}
	return m.ListSuggestions()
}

func (s *Server) optimizerScanRun(ctx context.Context, _ Peer, _ json.RawMessage) (any, error) {
	m := s.app.Optimizer()
	if m == nil {
		return nil, errors.New("optimizer not initialized")
	}
	scanID, inFlight, err := m.StartScan(ctx)
	if err != nil {
		return nil, err
	}
	return map[string]any{"scan_id": scanID, "in_flight": inFlight}, nil
}

func (s *Server) optimizerSuggestionsAct(_ context.Context, _ Peer, params json.RawMessage) (any, error) {
	var body struct {
		ID            string              `json:"id"`
		Action        string              `json:"action"`
		EditedPreview *optimizer.Preview  `json:"edited_preview,omitempty"`
	}
	if err := decodeParams(params, &body); err != nil {
		return nil, err
	}
	m := s.app.Optimizer()
	if m == nil {
		return nil, errors.New("optimizer not initialized")
	}
	if err := m.Act(body.ID, body.Action, body.EditedPreview); err != nil {
		return nil, err
	}
	return map[string]any{"ok": true}, nil
}

func (s *Server) optimizerScheduleGet(context.Context, Peer, json.RawMessage) (any, error) {
	m := s.app.Optimizer()
	if m == nil {
		return nil, errors.New("optimizer not initialized")
	}
	return m.GetSchedule()
}

func (s *Server) optimizerScheduleSet(_ context.Context, _ Peer, params json.RawMessage) (any, error) {
	var sched optimizer.Schedule
	if err := decodeParams(params, &sched); err != nil {
		return nil, err
	}
	m := s.app.Optimizer()
	if m == nil {
		return nil, errors.New("optimizer not initialized")
	}
	return m.SetSchedule(sched)
}

func (s *Server) optimizerScansGet(_ context.Context, _ Peer, params json.RawMessage) (any, error) {
	var body struct {
		ID string `json:"id"`
	}
	if err := decodeParams(params, &body); err != nil {
		return nil, err
	}
	m := s.app.Optimizer()
	if m == nil {
		return nil, errors.New("optimizer not initialized")
	}
	return m.GetScan(body.ID)
}

func (s *Server) optimizerScansPurge(context.Context, Peer, json.RawMessage) (any, error) {
	m := s.app.Optimizer()
	if m == nil {
		return nil, errors.New("optimizer not initialized")
	}
	n, err := m.PurgeScans()
	if err != nil {
		return nil, err
	}
	return map[string]any{"deleted": n}, nil
}

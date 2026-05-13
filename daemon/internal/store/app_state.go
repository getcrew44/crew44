package store

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"

	"github.com/sqtech/crew-ai/crewai-repo/internal/model"
)

var ErrAppStateCorrupt = errors.New("app state is corrupt")

func (s *Store) GetAppState() (model.AppState, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := os.ReadFile(filepath.Join(s.root, "app.json"))
	if errors.Is(err, os.ErrNotExist) {
		return model.AppState{}, nil
	}
	if err != nil {
		return model.AppState{}, err
	}
	if len(bytes.TrimSpace(data)) == 0 {
		return model.AppState{}, nil
	}
	var state model.AppState
	if err := json.Unmarshal(data, &state); err != nil {
		return model.AppState{}, ErrAppStateCorrupt
	}
	return state, nil
}

func (s *Store) SaveAppState(state model.AppState) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return writeJSON(filepath.Join(s.root, "app.json"), state)
}

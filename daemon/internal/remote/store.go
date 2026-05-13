package remote

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

type Store struct {
	root string
	mu   sync.Mutex
}

func NewStore(stateDir string) *Store {
	return &Store{root: filepath.Join(stateDir, "remote")}
}

func (s *Store) EnsureIdentity() (Identity, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	path := filepath.Join(s.root, "daemon_identity.json")
	var identity Identity
	err := readJSON(path, &identity)
	if err == nil && identity.ServerID != "" && identity.PublicKey != "" && identity.PrivateKey != "" {
		return identity, nil
	}
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return Identity{}, err
	}

	key, err := generateDHKey()
	if err != nil {
		return Identity{}, err
	}
	identity = Identity{
		ServerID:   newServerID(),
		PublicKey:  encodeKey(key.Public),
		PrivateKey: encodeKey(key.Private),
		CreatedAt:  time.Now().UTC(),
	}
	return identity, writePrivateJSON(path, identity)
}

func (s *Store) ListDevices() ([]Device, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	dir := s.devicesDir()
	entries, err := os.ReadDir(dir)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	devices := make([]Device, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		var device Device
		if err := readJSON(filepath.Join(dir, entry.Name()), &device); err != nil {
			return nil, err
		}
		devices = append(devices, device)
	}
	sort.Slice(devices, func(i, j int) bool { return devices[i].CreatedAt.Before(devices[j].CreatedAt) })
	return devices, nil
}

func (s *Store) SaveDevice(device Device) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return writeJSON(s.devicePath(device.ID), device)
}

func (s *Store) DeleteDevice(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !validDeviceID(id) {
		return os.ErrInvalid
	}
	err := os.Remove(s.devicePath(id))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

func (s *Store) FindDeviceByPublicKey(publicKey string) (Device, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	dir := s.devicesDir()
	entries, err := os.ReadDir(dir)
	if errors.Is(err, os.ErrNotExist) {
		return Device{}, os.ErrNotExist
	}
	if err != nil {
		return Device{}, err
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		var device Device
		if err := readJSON(filepath.Join(dir, entry.Name()), &device); err != nil {
			return Device{}, err
		}
		if device.PublicKey == publicKey {
			return device, nil
		}
	}
	return Device{}, os.ErrNotExist
}

func (s *Store) TouchDevice(id string, at time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !validDeviceID(id) {
		return os.ErrInvalid
	}
	var device Device
	path := s.devicePath(id)
	if err := readJSON(path, &device); err != nil {
		return err
	}
	device.LastSeenAt = at.UTC()
	return writeJSON(path, device)
}

func (s *Store) devicesDir() string {
	return filepath.Join(s.root, "devices")
}

func (s *Store) devicePath(id string) string {
	return filepath.Join(s.devicesDir(), id+".json")
}

func validDeviceID(id string) bool {
	if !strings.HasPrefix(id, "dev_") || len(id) < 8 {
		return false
	}
	for _, r := range strings.TrimPrefix(id, "dev_") {
		if !((r >= 'a' && r <= 'f') || (r >= '0' && r <= '9')) {
			return false
		}
	}
	return true
}

func writeJSON(path string, value any) error {
	return writeJSONFile(path, value, 0o644)
}

func writePrivateJSON(path string, value any) error {
	return writeJSONFile(path, value, 0o600)
}

func writeJSONFile(path string, value any, perm os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	return os.WriteFile(path, data, perm)
}

func readJSON(path string, out any) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	if len(bytes.TrimSpace(data)) == 0 {
		return nil
	}
	return json.Unmarshal(data, out)
}

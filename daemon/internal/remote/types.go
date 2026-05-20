package remote

import "time"

const (
	PairingMode = "pairing"
	DeviceMode  = "device"
)

type Identity struct {
	ServerID   string    `json:"server_id"`
	PublicKey  string    `json:"public_key"`
	PrivateKey string    `json:"private_key"`
	CreatedAt  time.Time `json:"created_at"`
}

type Device struct {
	ID         string    `json:"device_id"`
	Name       string    `json:"name"`
	PublicKey  string    `json:"public_key"`
	RelayURL   string    `json:"relay_url"`
	CreatedAt  time.Time `json:"created_at"`
	LastSeenAt time.Time `json:"last_seen_at,omitempty"`
}

type PairingOffer struct {
	Version       int       `json:"v"`
	Type          string    `json:"type"`
	RelayURL      string    `json:"relay_url"`
	ServerID      string    `json:"server_id"`
	DesktopName   string    `json:"desktop_name,omitempty"`
	DaemonPubKey  string    `json:"daemon_pubkey"`
	PairingID     string    `json:"pairing_id"`
	PairingSecret string    `json:"pairing_secret"`
	ExpiresAt     time.Time `json:"expires_at"`
}

type PairingSession struct {
	Offer     PairingOffer
	CreatedAt time.Time
}

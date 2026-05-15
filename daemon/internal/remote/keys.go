package remote

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"strings"

	"github.com/flynn/noise"
	"github.com/getcrew44/crew44/daemon/internal/id"
)

var noiseCipherSuite = noise.NewCipherSuite(noise.DH25519, noise.CipherChaChaPoly, noise.HashBLAKE2s)

func generateDHKey() (noise.DHKey, error) {
	return noise.DH25519.GenerateKeypair(rand.Reader)
}

func encodeKey(raw []byte) string {
	return base64.RawStdEncoding.EncodeToString(raw)
}

func decodeKey(encoded string) ([]byte, error) {
	value, err := base64.RawStdEncoding.DecodeString(strings.TrimSpace(encoded))
	if err != nil {
		return nil, fmt.Errorf("decode key: %w", err)
	}
	return value, nil
}

func newSecret() string {
	var raw [32]byte
	if _, err := rand.Read(raw[:]); err != nil {
		panic(err)
	}
	return encodeKey(raw[:])
}

func newServerID() string {
	return "srv_" + strings.ReplaceAll(id.New(), "-", "")
}

func newPairingID() string {
	return "pair_" + strings.ReplaceAll(id.New(), "-", "")
}

func deviceID(publicKey string) string {
	sum := sha256.Sum256([]byte(publicKey))
	return "dev_" + hex.EncodeToString(sum[:12])
}

func identityKey(identity Identity) (noise.DHKey, error) {
	privateKey, err := decodeKey(identity.PrivateKey)
	if err != nil {
		return noise.DHKey{}, err
	}
	publicKey, err := decodeKey(identity.PublicKey)
	if err != nil {
		return noise.DHKey{}, err
	}
	return noise.DHKey{Private: privateKey, Public: publicKey}, nil
}

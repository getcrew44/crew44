package remote

import (
	"bytes"
	"testing"

	"github.com/flynn/noise"
)

func sequenceBytes(start byte) []byte {
	out := make([]byte, 32)
	for i := range out {
		out[i] = start + byte(i)
	}
	return out
}

func TestMobileNoiseNKVector(t *testing.T) {
	remoteStatic, err := noise.DH25519.GenerateKeypair(bytes.NewReader(sequenceBytes(33)))
	if err != nil {
		t.Fatalf("remote keypair: %v", err)
	}
	hs, err := noise.NewHandshakeState(noise.Config{
		CipherSuite: noiseCipherSuite,
		Random:      bytes.NewReader(sequenceBytes(1)),
		Pattern:     noise.HandshakeNK,
		Initiator:   true,
		PeerStatic:  remoteStatic.Public,
	})
	if err != nil {
		t.Fatalf("new handshake: %v", err)
	}
	msg, _, _, err := hs.WriteMessage(nil, nil)
	if err != nil {
		t.Fatalf("write message: %v", err)
	}
	if got, want := encodeKey(msg), "B6N8vBQgk8i3VdwbEOhstCY3StFqqFPtC9/AsrhtHHySZ17HkuNCoJta7RZFzycD"; got != want {
		t.Fatalf("NK message A = %s, want %s", got, want)
	}
}

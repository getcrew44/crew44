package id

import (
	"crypto/rand"
	"encoding/hex"
)

func New() string {
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		panic(err)
	}
	return encodeUUID(raw)
}

func encodeUUID(raw [16]byte) string {
	buf := make([]byte, 36)
	hex.Encode(buf[0:8], raw[0:4])
	buf[8] = '-'
	hex.Encode(buf[9:13], raw[4:6])
	buf[13] = '-'
	hex.Encode(buf[14:18], raw[6:8])
	buf[18] = '-'
	hex.Encode(buf[19:23], raw[8:10])
	buf[23] = '-'
	hex.Encode(buf[24:36], raw[10:16])
	return string(buf)
}

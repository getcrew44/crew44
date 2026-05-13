package app

import "errors"

var (
	ErrBadRequest   = errors.New("bad request")
	ErrConflict     = errors.New("conflict")
	ErrNotFound     = errors.New("not found")
	ErrUnauthorized = errors.New("unauthorized")
)

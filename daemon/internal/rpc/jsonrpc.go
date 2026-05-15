package rpc

import (
	"encoding/json"
	"errors"
	"fmt"

	"github.com/getcrew44/crew44/daemon/internal/app"
)

var errInvalidParams = errors.New("invalid params")

const Version = "2.0"

const (
	CodeParseError     = -32700
	CodeInvalidRequest = -32600
	CodeMethodNotFound = -32601
	CodeInvalidParams  = -32602
	CodeInternalError  = -32603
	CodeBadRequest     = -32000
	CodeNotFound       = -32004
	CodeConflict       = -32009
	CodeUnauthorized   = -32001
)

type Request struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type Response struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  any             `json:"result,omitempty"`
	Error   *Error          `json:"error,omitempty"`
}

type Error struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func newResultResponse(id json.RawMessage, result any) Response {
	return Response{
		JSONRPC: Version,
		ID:      normalizeID(id),
		Result:  result,
	}
}

func newErrorResponse(id json.RawMessage, err *Error) Response {
	return Response{
		JSONRPC: Version,
		ID:      normalizeID(id),
		Error:   err,
	}
}

func notification(method string, params any) map[string]any {
	return map[string]any{
		"jsonrpc": Version,
		"method":  method,
		"params":  params,
	}
}

func normalizeID(id json.RawMessage) json.RawMessage {
	if len(id) == 0 {
		return json.RawMessage("null")
	}
	return id
}

func rpcError(code int, message string) *Error {
	return &Error{Code: code, Message: message}
}

func mapError(err error) *Error {
	if err == nil {
		return nil
	}
	switch {
	case errors.Is(err, app.ErrBadRequest):
		return rpcError(CodeBadRequest, err.Error())
	case errors.Is(err, app.ErrNotFound):
		return rpcError(CodeNotFound, err.Error())
	case errors.Is(err, app.ErrConflict):
		return rpcError(CodeConflict, err.Error())
	case errors.Is(err, app.ErrUnauthorized):
		return rpcError(CodeUnauthorized, err.Error())
	default:
		return rpcError(CodeInternalError, err.Error())
	}
}

func decodeParams(params json.RawMessage, out any) error {
	if len(params) == 0 || string(params) == "null" {
		params = json.RawMessage("{}")
	}
	if err := json.Unmarshal(params, out); err != nil {
		return fmt.Errorf("%w: %v", errInvalidParams, err)
	}
	return nil
}

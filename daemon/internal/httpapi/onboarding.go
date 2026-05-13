package httpapi

import (
	"net/http"
)

func (s *Server) handleGetOnboarding(w http.ResponseWriter, r *http.Request) {
	status, err := s.app.GetOnboardingStatus()
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, status)
}

func (s *Server) handleCompleteOnboarding(w http.ResponseWriter, r *http.Request) {
	status, err := s.app.CompleteOnboarding()
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, status)
}

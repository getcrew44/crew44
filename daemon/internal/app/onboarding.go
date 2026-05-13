package app

import (
	"errors"

	"github.com/sqtech/crew-ai/crewai-repo/internal/model"
	"github.com/sqtech/crew-ai/crewai-repo/internal/store"
)

const currentOnboardingVersion = "1"
const corruptAppStateOnboardingVersion = "corrupt_app_state"

func (a *App) GetOnboardingStatus() (model.OnboardingStatus, error) {
	state, err := a.store.GetAppState()
	if err != nil {
		if errors.Is(err, store.ErrAppStateCorrupt) {
			// TODO: Replace this cold-path fail-open with a dedicated app-state
			// repair prompt once we have a settings/recovery surface.
			return onboardingStatusFromState(model.AppState{
				LastOnboardingVersion: corruptAppStateOnboardingVersion,
			}), nil
		}
		return model.OnboardingStatus{}, err
	}
	return onboardingStatusFromState(state), nil
}

func (a *App) CompleteOnboarding() (model.OnboardingStatus, error) {
	state, err := a.store.GetAppState()
	if err != nil {
		if !errors.Is(err, store.ErrAppStateCorrupt) {
			return model.OnboardingStatus{}, err
		}
		state = model.AppState{}
	}
	state.LastOnboardingVersion = currentOnboardingVersion
	if err := a.store.SaveAppState(state); err != nil {
		return model.OnboardingStatus{}, err
	}
	return onboardingStatusFromState(state), nil
}

func onboardingStatusFromState(state model.AppState) model.OnboardingStatus {
	return model.OnboardingStatus{
		LastOnboardingVersion: state.LastOnboardingVersion,
		OnboardingRequired:    state.LastOnboardingVersion == "",
	}
}

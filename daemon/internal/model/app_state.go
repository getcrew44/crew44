package model

type AppState struct {
	LastOnboardingVersion string `json:"last_onboarding_version"`
}

type OnboardingStatus struct {
	LastOnboardingVersion string `json:"last_onboarding_version"`
	OnboardingRequired    bool   `json:"onboarding_required"`
}

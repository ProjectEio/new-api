package openaicompat

import (
	"testing"

	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/setting/model_setting"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// setGlobalChatToResponsesPolicy swaps the process-wide policy for the duration
// of a test and restores it afterwards, so the "auto" cases are deterministic.
func setGlobalChatToResponsesPolicy(t *testing.T, policy model_setting.ChatCompletionsToResponsesPolicy) {
	t.Helper()
	g := model_setting.GetGlobalSettings()
	require.NotNil(t, g)
	original := g.ChatCompletionsToResponsesPolicy
	t.Cleanup(func() { g.ChatCompletionsToResponsesPolicy = original })
	g.ChatCompletionsToResponsesPolicy = policy
}

// The per-channel protocol must win over the global policy: a legacy-only
// channel never upconverts, a responses-native channel always does, and only an
// "auto" channel defers to the global chat→responses policy.
func TestShouldChatCompletionsUseResponses_ChannelProtocolOverridesGlobal(t *testing.T) {
	// Global policy that would upconvert everything, so "auto" resolves to true.
	setGlobalChatToResponsesPolicy(t, model_setting.ChatCompletionsToResponsesPolicy{
		Enabled:       true,
		AllChannels:   true,
		ModelPatterns: []string{".*"},
	})

	cases := []struct {
		name            string
		channelProtocol string
		want            bool
	}{
		{"legacy channel never upconverts despite enabled global policy", dto.OpenAIProtocolChatCompletions, false},
		{"responses channel always upconverts", dto.OpenAIProtocolResponses, true},
		{"auto channel defers to enabled global policy", dto.OpenAIProtocolAuto, true},
		{"unknown value is treated as auto", "something-else", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := ShouldChatCompletionsUseResponses(tc.channelProtocol, 7, 1, "gpt-4o")
			assert.Equal(t, tc.want, got)
		})
	}
}

// When the global policy is disabled, only a responses-native channel forces
// the responses path; auto and legacy channels stay on chat completions.
func TestShouldChatCompletionsUseResponses_AutoDefersToDisabledGlobal(t *testing.T) {
	setGlobalChatToResponsesPolicy(t, model_setting.ChatCompletionsToResponsesPolicy{Enabled: false})

	assert.False(t, ShouldChatCompletionsUseResponses(dto.OpenAIProtocolAuto, 7, 1, "gpt-4o"))
	assert.True(t, ShouldChatCompletionsUseResponses(dto.OpenAIProtocolResponses, 7, 1, "gpt-4o"))
	assert.False(t, ShouldChatCompletionsUseResponses(dto.OpenAIProtocolChatCompletions, 7, 1, "gpt-4o"))
}

// Only a legacy-only channel ("chat") downconverts incoming /v1/responses traffic to Chat
// Completions; responses-native and auto channels keep speaking responses upstream.
func TestShouldResponsesDowngradeToChatCompletions(t *testing.T) {
	assert.True(t, ShouldResponsesDowngradeToChatCompletions(dto.OpenAIProtocolChatCompletions))
	assert.False(t, ShouldResponsesDowngradeToChatCompletions(dto.OpenAIProtocolResponses))
	assert.False(t, ShouldResponsesDowngradeToChatCompletions(dto.OpenAIProtocolAuto))
	assert.False(t, ShouldResponsesDowngradeToChatCompletions("something-else"))
}

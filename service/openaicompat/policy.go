package openaicompat

import (
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/setting/model_setting"
)

func ShouldChatCompletionsUseResponsesPolicy(policy model_setting.ChatCompletionsToResponsesPolicy, channelID int, channelType int, model string) bool {
	if !policy.IsChannelEnabled(channelID, channelType) {
		return false
	}
	return matchAnyRegex(policy.ModelPatterns, model)
}

func ShouldChatCompletionsUseResponsesGlobal(channelID int, channelType int, model string) bool {
	return ShouldChatCompletionsUseResponsesPolicy(
		model_setting.GetGlobalSettings().ChatCompletionsToResponsesPolicy,
		channelID,
		channelType,
		model,
	)
}

// ShouldChatCompletionsUseResponses decides whether an incoming Chat Completions
// request should be sent upstream via the Responses API, honoring the channel's
// declared upstream protocol before falling back to the global policy:
//   - "chat"      → legacy-only upstream, never upconvert.
//   - "responses" → responses-native upstream, always route chat via responses.
//   - "" (auto)   → defer to the global chat→responses policy.
func ShouldChatCompletionsUseResponses(channelProtocol string, channelID int, channelType int, model string) bool {
	switch channelProtocol {
	case dto.OpenAIProtocolChatCompletions:
		return false
	case dto.OpenAIProtocolResponses:
		return true
	default:
		return ShouldChatCompletionsUseResponsesGlobal(channelID, channelType, model)
	}
}

// ShouldResponsesDowngradeToChatCompletions reports whether an incoming
// Responses API request must be downgraded to Chat Completions because the
// channel's upstream only speaks the legacy protocol.
func ShouldResponsesDowngradeToChatCompletions(channelProtocol string) bool {
	return channelProtocol == dto.OpenAIProtocolChatCompletions
}

package service

import (
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
)

const (
	responsesStateKeyPrefix = "responses_state:"
	// responsesStateTTL is a sliding window: a conversation stays alive as long as it is used at
	// least once per hour; an idle conversation expires after an hour.
	responsesStateTTL = time.Hour
	// responsesStateMaxBytes guards Redis against unbounded growth from pathological conversations.
	responsesStateMaxBytes = 1 << 20 // 1 MiB
)

// responsesConversationState is the Redis payload backing previous_response_id chaining on the
// legacy-chat downgrade path. Messages is the full non-system conversation snapshot (input turns
// plus assistant outputs) that produced the response.
type responsesConversationState struct {
	UserId             int           `json:"user_id"`
	Model              string        `json:"model"`
	PreviousResponseID string        `json:"previous_response_id,omitempty"`
	Messages           []dto.Message `json:"messages"`
}

func responsesStateKey(responseID string) string {
	return responsesStateKeyPrefix + responseID
}

// encodeResponsesConversation serializes a snapshot for storage, returning false when it fails to
// marshal or exceeds the size guard.
func encodeResponsesConversation(userID int, model string, previousResponseID string, messages []dto.Message) (string, bool) {
	payload, err := common.Marshal(responsesConversationState{
		UserId:             userID,
		Model:              model,
		PreviousResponseID: previousResponseID,
		Messages:           messages,
	})
	if err != nil || len(payload) > responsesStateMaxBytes {
		return "", false
	}
	return string(payload), true
}

// decodeResponsesConversation deserializes a stored snapshot and enforces user isolation: a
// snapshot is only returned to the user that created it, so a guessed response id cannot read
// another user's conversation.
func decodeResponsesConversation(raw string, userID int) ([]dto.Message, bool) {
	if raw == "" {
		return nil, false
	}
	var state responsesConversationState
	if err := common.UnmarshalJsonStr(raw, &state); err != nil {
		return nil, false
	}
	if state.UserId != userID {
		return nil, false
	}
	return state.Messages, true
}

// SaveResponsesConversation persists a response's non-system message snapshot so a later request
// can chain onto it via previous_response_id. Best-effort: it silently no-ops when Redis is
// disabled, the id/messages are empty, or the payload exceeds the size guard.
func SaveResponsesConversation(responseID string, userID int, model string, previousResponseID string, messages []dto.Message) {
	if !common.RedisEnabled || common.RDB == nil || responseID == "" || len(messages) == 0 {
		return
	}
	payload, ok := encodeResponsesConversation(userID, model, previousResponseID, messages)
	if !ok {
		return
	}
	if err := common.RedisSet(responsesStateKey(responseID), payload, responsesStateTTL); err != nil {
		common.SysError(fmt.Sprintf("failed to save responses conversation state %s: %s", responseID, err.Error()))
	}
}

// LoadResponsesConversation returns a previous response's non-system message snapshot and refreshes
// its sliding TTL. Returns false when Redis is disabled, the id is unknown/expired, or the stored
// state belongs to a different user.
func LoadResponsesConversation(responseID string, userID int) ([]dto.Message, bool) {
	if !common.RedisEnabled || common.RDB == nil || responseID == "" {
		return nil, false
	}
	raw, err := common.RedisGet(responsesStateKey(responseID))
	if err != nil || raw == "" {
		return nil, false
	}
	messages, ok := decodeResponsesConversation(raw, userID)
	if !ok {
		return nil, false
	}
	_ = common.RedisExpire(responsesStateKey(responseID), responsesStateTTL)
	return messages, true
}

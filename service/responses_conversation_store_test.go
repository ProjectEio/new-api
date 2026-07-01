package service

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// A stored snapshot round-trips only for the user that created it; a different user id must be
// treated as a miss so a guessed response id cannot read another user's conversation.
func TestResponsesConversation_EncodeDecodeUserIsolation(t *testing.T) {
	messages := []dto.Message{
		{Role: "user", Content: "hi"},
		{Role: "assistant", Content: "hello"},
	}

	payload, ok := encodeResponsesConversation(7, "gpt-4o", "resp_prev", messages)
	require.True(t, ok)

	got, ok := decodeResponsesConversation(payload, 7)
	require.True(t, ok)
	require.Len(t, got, 2)
	assert.Equal(t, "user", got[0].Role)
	assert.Equal(t, "hi", got[0].StringContent())
	assert.Equal(t, "assistant", got[1].Role)
	assert.Equal(t, "hello", got[1].StringContent())

	_, ok = decodeResponsesConversation(payload, 8)
	assert.False(t, ok, "another user must not resolve the snapshot")

	_, ok = decodeResponsesConversation("", 7)
	assert.False(t, ok)
	_, ok = decodeResponsesConversation("not-json", 7)
	assert.False(t, ok)
}

// An oversized snapshot must not be stored, protecting Redis from unbounded growth.
func TestResponsesConversation_EncodeRejectsOversized(t *testing.T) {
	huge := make([]byte, responsesStateMaxBytes+1)
	for i := range huge {
		huge[i] = 'a'
	}
	_, ok := encodeResponsesConversation(1, "gpt-4o", "", []dto.Message{{Role: "user", Content: string(huge)}})
	assert.False(t, ok)
}

// With Redis disabled (single-node SQLite deployments), the store degrades to a no-op instead of
// crashing, and previous_response_id resolution simply misses.
func TestResponsesConversation_RedisDisabledNoOp(t *testing.T) {
	original := common.RedisEnabled
	t.Cleanup(func() { common.RedisEnabled = original })
	common.RedisEnabled = false

	SaveResponsesConversation("resp_1", 7, "gpt-4o", "", []dto.Message{{Role: "user", Content: "hi"}})
	_, ok := LoadResponsesConversation("resp_1", 7)
	assert.False(t, ok)
}

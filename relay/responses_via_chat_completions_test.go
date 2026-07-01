package relay

import (
	"encoding/json"
	"testing"

	"github.com/QuantumNous/new-api/dto"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// System/developer prompts are re-supplied each turn and must be separated from the conversation
// turns that get persisted for previous_response_id chaining.
func TestSplitSystemMessages(t *testing.T) {
	messages := []dto.Message{
		{Role: "system", Content: "sys"},
		{Role: "user", Content: "hi"},
		{Role: "assistant", Content: "hello"},
		{Role: "developer", Content: "dev"},
		{Role: "tool", Content: "result", ToolCallId: "c1"},
	}

	system, rest := splitSystemMessages(messages)
	require.Len(t, system, 2)
	assert.Equal(t, "system", system[0].Role)
	assert.Equal(t, "developer", system[1].Role)

	require.Len(t, rest, 3)
	assert.Equal(t, "user", rest[0].Role)
	assert.Equal(t, "assistant", rest[1].Role)
	assert.Equal(t, "tool", rest[2].Role)
}

// Only an explicit "store": false opts out of persistence; absent or any other value stores.
func TestResponsesStoreDisabled(t *testing.T) {
	assert.False(t, responsesStoreDisabled(nil))
	assert.False(t, responsesStoreDisabled(json.RawMessage(`true`)))
	assert.True(t, responsesStoreDisabled(json.RawMessage(`false`)))
	// Non-bool values (e.g. an object) are not an opt-out.
	assert.False(t, responsesStoreDisabled(json.RawMessage(`{"foo":1}`)))
}

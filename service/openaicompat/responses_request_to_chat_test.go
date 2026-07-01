package openaicompat

import (
	"encoding/json"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func mustRaw(t *testing.T, v any) json.RawMessage {
	t.Helper()
	b, err := common.Marshal(v)
	require.NoError(t, err)
	return b
}

// A plain-string input plus instructions must become a leading system message followed by a
// single user message, so a stateless chat upstream sees the same prompt.
func TestResponsesRequestToChatCompletionsRequest_StringInputAndInstructions(t *testing.T) {
	req := &dto.OpenAIResponsesRequest{
		Model:        "gpt-4o",
		Instructions: mustRaw(t, "be terse"),
		Input:        mustRaw(t, "hello there"),
	}

	got, err := ResponsesRequestToChatCompletionsRequest(req)
	require.NoError(t, err)
	require.Len(t, got.Messages, 2)
	assert.Equal(t, "system", got.Messages[0].Role)
	assert.Equal(t, "be terse", got.Messages[0].StringContent())
	assert.Equal(t, "user", got.Messages[1].Role)
	assert.Equal(t, "hello there", got.Messages[1].StringContent())
}

// Array input items carry roles and multimodal parts that must be preserved when rebuilding
// Chat Completions messages.
func TestResponsesRequestToChatCompletionsRequest_ArrayInputPreservesRolesAndMedia(t *testing.T) {
	req := &dto.OpenAIResponsesRequest{
		Model: "gpt-4o",
		Input: mustRaw(t, []map[string]any{
			{"type": "message", "role": "system", "content": "sys"},
			{"role": "user", "content": []map[string]any{
				{"type": "input_text", "text": "look:"},
				{"type": "input_image", "image_url": "https://img/1.png"},
			}},
		}),
	}

	got, err := ResponsesRequestToChatCompletionsRequest(req)
	require.NoError(t, err)
	require.Len(t, got.Messages, 2)

	assert.Equal(t, "system", got.Messages[0].Role)
	assert.Equal(t, "sys", got.Messages[0].StringContent())

	user := got.Messages[1]
	assert.Equal(t, "user", user.Role)
	// The upstream chat request must carry the text part and the image as {"url": ...}.
	userJSON, err := common.Marshal(user)
	require.NoError(t, err)
	assert.Contains(t, string(userJSON), `"type":"text"`)
	assert.Contains(t, string(userJSON), `"look:"`)
	assert.Contains(t, string(userJSON), `"type":"image_url"`)
	assert.Contains(t, string(userJSON), `"url":"https://img/1.png"`)
}

// Consecutive function_call items belong to one assistant turn; function_call_output becomes a
// tool message. This protects the tool-call/tool-result contract chat upstreams enforce.
func TestResponsesRequestToChatCompletionsRequest_FunctionCallsGroupedThenToolOutputs(t *testing.T) {
	req := &dto.OpenAIResponsesRequest{
		Model: "gpt-4o",
		Input: mustRaw(t, []map[string]any{
			{"role": "user", "content": "weather?"},
			{"type": "function_call", "call_id": "c1", "name": "get_weather", "arguments": `{"city":"NYC"}`},
			{"type": "function_call", "call_id": "c2", "name": "get_weather", "arguments": `{"city":"LA"}`},
			{"type": "function_call_output", "call_id": "c1", "output": "sunny"},
			{"type": "function_call_output", "call_id": "c2", "output": "rainy"},
		}),
	}

	got, err := ResponsesRequestToChatCompletionsRequest(req)
	require.NoError(t, err)
	require.Len(t, got.Messages, 4)

	assert.Equal(t, "user", got.Messages[0].Role)

	assistant := got.Messages[1]
	assert.Equal(t, "assistant", assistant.Role)
	toolCalls := assistant.ParseToolCalls()
	require.Len(t, toolCalls, 2)
	assert.Equal(t, "c1", toolCalls[0].ID)
	assert.Equal(t, "get_weather", toolCalls[0].Function.Name)
	assert.Equal(t, `{"city":"NYC"}`, toolCalls[0].Function.Arguments)
	assert.Equal(t, "c2", toolCalls[1].ID)

	assert.Equal(t, "tool", got.Messages[2].Role)
	assert.Equal(t, "c1", got.Messages[2].ToolCallId)
	assert.Equal(t, "sunny", got.Messages[2].StringContent())
	assert.Equal(t, "tool", got.Messages[3].Role)
	assert.Equal(t, "c2", got.Messages[3].ToolCallId)
}

// Sampling params, tools, tool_choice, text.format and reasoning must be mapped onto their Chat
// Completions equivalents.
func TestResponsesRequestToChatCompletionsRequest_ParamsAndToolsMapped(t *testing.T) {
	maxOut := uint(256)
	temp := 0.3
	req := &dto.OpenAIResponsesRequest{
		Model:           "gpt-4o",
		Input:           mustRaw(t, "hi"),
		MaxOutputTokens: &maxOut,
		Temperature:     &temp,
		Reasoning:       &dto.Reasoning{Effort: "high"},
		Tools: mustRaw(t, []map[string]any{
			{"type": "function", "name": "get_weather", "description": "weather", "parameters": map[string]any{"type": "object"}},
			{"type": "web_search_preview", "search_context_size": "high"},
			{"type": "file_search"},
		}),
		ToolChoice: mustRaw(t, map[string]any{"type": "function", "name": "get_weather"}),
		Text:       mustRaw(t, map[string]any{"format": map[string]any{"type": "json_schema", "name": "s", "schema": map[string]any{"type": "object"}}}),
	}

	got, err := ResponsesRequestToChatCompletionsRequest(req)
	require.NoError(t, err)

	require.NotNil(t, got.MaxCompletionTokens)
	assert.Equal(t, uint(256), *got.MaxCompletionTokens)
	assert.Equal(t, "high", got.ReasoningEffort)
	require.NotNil(t, got.Temperature)
	assert.Equal(t, 0.3, *got.Temperature)

	// Function tools survive; file_search has no chat equivalent and is dropped.
	require.Len(t, got.Tools, 1)
	assert.Equal(t, "function", got.Tools[0].Type)
	assert.Equal(t, "get_weather", got.Tools[0].Function.Name)

	// web_search_preview maps onto chat web_search_options.
	require.NotNil(t, got.WebSearchOptions)
	assert.Equal(t, "high", got.WebSearchOptions.SearchContextSize)

	// Responses {"type":"function","name":...} → Chat {"type":"function","function":{"name":...}}
	tc, ok := got.ToolChoice.(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "function", tc["type"])
	fn, ok := tc["function"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "get_weather", fn["name"])

	require.NotNil(t, got.ResponseFormat)
	assert.Equal(t, "json_schema", got.ResponseFormat.Type)
	assert.Contains(t, string(got.ResponseFormat.JsonSchema), `"name":"s"`)
}

func TestResponsesRequestToChatCompletionsRequest_Errors(t *testing.T) {
	_, err := ResponsesRequestToChatCompletionsRequest(nil)
	assert.Error(t, err)

	_, err = ResponsesRequestToChatCompletionsRequest(&dto.OpenAIResponsesRequest{})
	assert.Error(t, err)
}

// A plain text chat answer must surface as a single assistant message output_text item, with
// chat usage mapped onto the input/output token fields billing reads.
func TestChatCompletionsResponseToResponsesResponse_Text(t *testing.T) {
	resp := &dto.OpenAITextResponse{
		Model: "gpt-4o",
		Choices: []dto.OpenAITextResponseChoice{
			{Index: 0, Message: dto.Message{Role: "assistant", Content: "hi!"}, FinishReason: "stop"},
		},
		Usage: dto.Usage{PromptTokens: 10, CompletionTokens: 5, TotalTokens: 15},
	}

	got := ChatCompletionsResponseToResponsesResponse(resp, "resp_abc", "gpt-4o")
	assert.Equal(t, "resp_abc", got.ID)
	assert.Equal(t, "response", got.Object)
	require.Len(t, got.Output, 1)
	assert.Equal(t, "message", got.Output[0].Type)
	assert.Equal(t, "assistant", got.Output[0].Role)
	require.Len(t, got.Output[0].Content, 1)
	assert.Equal(t, "output_text", got.Output[0].Content[0].Type)
	assert.Equal(t, "hi!", got.Output[0].Content[0].Text)

	require.NotNil(t, got.Usage)
	assert.Equal(t, 10, got.Usage.InputTokens)
	assert.Equal(t, 5, got.Usage.OutputTokens)
	assert.Equal(t, 15, got.Usage.TotalTokens)
}

// Tool calls must surface as function_call output items whose arguments round-trip back to the
// original JSON string a chat client would have produced.
func TestChatCompletionsResponseToResponsesResponse_ToolCalls(t *testing.T) {
	msg := dto.Message{Role: "assistant"}
	msg.SetToolCalls([]dto.ToolCallRequest{
		{ID: "call_1", Type: "function", Function: dto.FunctionRequest{Name: "get_weather", Arguments: `{"city":"NYC"}`}},
	})
	resp := &dto.OpenAITextResponse{
		Model:   "gpt-4o",
		Choices: []dto.OpenAITextResponseChoice{{Index: 0, Message: msg, FinishReason: "tool_calls"}},
		Usage:   dto.Usage{PromptTokens: 3, CompletionTokens: 7, TotalTokens: 10},
	}

	got := ChatCompletionsResponseToResponsesResponse(resp, "resp_x", "gpt-4o")
	require.Len(t, got.Output, 1)
	fc := got.Output[0]
	assert.Equal(t, "function_call", fc.Type)
	assert.Equal(t, "call_1", fc.CallId)
	assert.Equal(t, "get_weather", fc.Name)
	assert.Equal(t, `{"city":"NYC"}`, fc.ArgumentsString())
}

// Reasoning models answering through a chat upstream must surface their thinking as a Responses
// reasoning item preceding the assistant message.
func TestChatCompletionsResponseToResponsesResponse_Reasoning(t *testing.T) {
	reasoning := "let me think..."
	resp := &dto.OpenAITextResponse{
		Model: "deepseek-reasoner",
		Choices: []dto.OpenAITextResponseChoice{
			{Index: 0, Message: dto.Message{Role: "assistant", Content: "answer", ReasoningContent: &reasoning}, FinishReason: "stop"},
		},
		Usage: dto.Usage{PromptTokens: 5, CompletionTokens: 8, TotalTokens: 13},
	}

	got := ChatCompletionsResponseToResponsesResponse(resp, "resp_r", "deepseek-reasoner")
	require.Len(t, got.Output, 2)
	assert.Equal(t, "reasoning", got.Output[0].Type)
	assert.Contains(t, string(got.Output[0].Summary), "let me think...")
	assert.Contains(t, string(got.Output[0].Summary), "summary_text")
	assert.Equal(t, "message", got.Output[1].Type)
	require.Len(t, got.Output[1].Content, 1)
	assert.Equal(t, "answer", got.Output[1].Content[0].Text)
}

package openaicompat

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
)

// ChatCompletionsResponseToResponsesResponse converts a Chat Completions response into an
// OpenAI Responses API response, so a legacy chat-only upstream can answer a /v1/responses
// client. It is the inverse of ResponsesResponseToChatCompletionsResponse.
func ChatCompletionsResponseToResponsesResponse(resp *dto.OpenAITextResponse, responseID string, model string) *dto.OpenAIResponsesResponse {
	out := &dto.OpenAIResponsesResponse{
		ID:                responseID,
		Object:            "response",
		Status:            json.RawMessage(`"completed"`),
		Model:             model,
		Output:            []dto.ResponsesOutput{},
		ParallelToolCalls: true,
	}
	if resp == nil {
		return out
	}
	if resp.Model != "" {
		out.Model = resp.Model
	}
	out.CreatedAt = createdAtToInt(resp.Created)

	if len(resp.Choices) > 0 {
		message := resp.Choices[0].Message
		toolCalls := message.ParseToolCalls()
		text := message.StringContent()

		outputs := make([]dto.ResponsesOutput, 0, len(toolCalls)+2)
		if reasoning := message.GetReasoningContent(); reasoning != "" {
			outputs = append(outputs, dto.ResponsesOutput{
				Type:    "reasoning",
				ID:      "rs_" + responseID,
				Status:  "completed",
				Summary: reasoningSummaryRaw(reasoning),
			})
		}
		if text != "" || len(toolCalls) == 0 {
			outputs = append(outputs, dto.ResponsesOutput{
				Type:   "message",
				ID:     "msg_" + responseID,
				Status: "completed",
				Role:   "assistant",
				Content: []dto.ResponsesOutputContent{
					{Type: "output_text", Text: text, Annotations: []interface{}{}},
				},
			})
		}
		for i, tc := range toolCalls {
			callID := tc.ID
			itemID := callID
			if itemID == "" {
				itemID = fmt.Sprintf("fc_%s_%d", responseID, i)
			}
			outputs = append(outputs, dto.ResponsesOutput{
				Type:      "function_call",
				ID:        itemID,
				Status:    "completed",
				CallId:    callID,
				Name:      tc.Function.Name,
				Arguments: argumentsStringToRaw(tc.Function.Arguments),
			})
		}
		out.Output = outputs
	}

	out.Usage = chatUsageToResponsesUsage(resp.Usage)
	return out
}

// chatUsageToResponsesUsage mirrors a Chat Completions usage onto the input/output token
// fields the Responses API (and downstream billing) reads.
func chatUsageToResponsesUsage(usage dto.Usage) *dto.Usage {
	if usage.TotalTokens == 0 && usage.PromptTokens == 0 && usage.CompletionTokens == 0 &&
		usage.InputTokens == 0 && usage.OutputTokens == 0 {
		return nil
	}
	out := usage
	if out.InputTokens == 0 {
		out.InputTokens = usage.PromptTokens
	}
	if out.OutputTokens == 0 {
		out.OutputTokens = usage.CompletionTokens
	}
	if out.PromptTokens == 0 {
		out.PromptTokens = usage.InputTokens
	}
	if out.CompletionTokens == 0 {
		out.CompletionTokens = usage.OutputTokens
	}
	if out.TotalTokens == 0 {
		out.TotalTokens = out.PromptTokens + out.CompletionTokens
	}
	return &out
}

func argumentsStringToRaw(arguments string) json.RawMessage {
	if strings.TrimSpace(arguments) == "" {
		arguments = ""
	}
	// Responses function_call arguments is a JSON string.
	if b, err := common.Marshal(arguments); err == nil {
		return b
	}
	return nil
}

// reasoningSummaryRaw renders chat reasoning text as a Responses reasoning `summary` array.
func reasoningSummaryRaw(text string) json.RawMessage {
	if b, err := common.Marshal([]map[string]any{{"type": "summary_text", "text": text}}); err == nil {
		return b
	}
	return nil
}

func createdAtToInt(created any) int {
	switch v := created.(type) {
	case int:
		return v
	case int64:
		return int(v)
	case float64:
		return int(v)
	case json.Number:
		if n, err := v.Int64(); err == nil {
			return int(n)
		}
	}
	return 0
}

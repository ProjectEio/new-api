package openai

import (
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/logger"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
)

func responsesResponseID(c *gin.Context) string {
	return "resp_" + c.GetString(common.RequestIdKey)
}

// normalizeResponsesUsage keeps the Chat (prompt/completion) and Responses (input/output) token
// fields in sync so both billing and the /v1/responses client see consistent counts.
func normalizeResponsesUsage(u *dto.Usage) {
	if u == nil {
		return
	}
	if u.InputTokens == 0 {
		u.InputTokens = u.PromptTokens
	}
	if u.OutputTokens == 0 {
		u.OutputTokens = u.CompletionTokens
	}
	if u.PromptTokens == 0 {
		u.PromptTokens = u.InputTokens
	}
	if u.CompletionTokens == 0 {
		u.CompletionTokens = u.OutputTokens
	}
	if u.TotalTokens == 0 {
		u.TotalTokens = u.PromptTokens + u.CompletionTokens
	}
}

// OaiChatToResponsesHandler reads a non-streaming Chat Completions upstream response and
// rewrites it as an OpenAI Responses API response for a /v1/responses client. It also returns the
// assistant output message so the caller can persist conversation state for previous_response_id.
func OaiChatToResponsesHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *dto.Message, *types.NewAPIError) {
	if resp == nil || resp.Body == nil {
		return nil, nil, types.NewOpenAIError(fmt.Errorf("invalid response"), types.ErrorCodeBadResponse, http.StatusInternalServerError)
	}
	defer service.CloseResponseBodyGracefully(resp)

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, nil, types.NewOpenAIError(err, types.ErrorCodeReadResponseBodyFailed, http.StatusInternalServerError)
	}

	var chatResp dto.OpenAITextResponse
	if err := common.Unmarshal(body, &chatResp); err != nil {
		return nil, nil, types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusInternalServerError)
	}
	if oaiError := chatResp.GetOpenAIError(); oaiError != nil && oaiError.Type != "" {
		return nil, nil, types.WithOpenAIError(*oaiError, resp.StatusCode)
	}

	responseID := responsesResponseID(c)
	responsesResp := service.ChatCompletionsResponseToResponsesResponse(&chatResp, responseID, info.UpstreamModelName)

	usage := &chatResp.Usage
	if usage.TotalTokens == 0 {
		text := service.ExtractOutputTextFromResponses(responsesResp)
		usage = service.ResponseText2Usage(c, text, info.UpstreamModelName, info.GetEstimatePromptTokens())
	}
	normalizeResponsesUsage(usage)
	responsesResp.Usage = usage

	responseBody, err := common.Marshal(responsesResp)
	if err != nil {
		return nil, nil, types.NewOpenAIError(err, types.ErrorCodeJsonMarshalFailed, http.StatusInternalServerError)
	}
	service.IOCopyBytesGracefully(c, resp, responseBody)

	var assistant *dto.Message
	if len(chatResp.Choices) > 0 {
		assistant = &chatResp.Choices[0].Message
	}
	return usage, assistant, nil
}

type responsesToolAccumulator struct {
	outputIndex int
	itemID      string
	callID      string
	name        string
	args        strings.Builder
	added       bool
}

// OaiChatToResponsesStreamHandler consumes a Chat Completions SSE stream from the upstream and
// re-emits it as an OpenAI Responses API event stream, so a legacy chat-only channel can serve
// a streaming /v1/responses request. It also returns the assembled assistant output message so the
// caller can persist conversation state for previous_response_id.
func OaiChatToResponsesStreamHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *dto.Message, *types.NewAPIError) {
	if resp == nil || resp.Body == nil {
		return nil, nil, types.NewOpenAIError(fmt.Errorf("invalid response"), types.ErrorCodeBadResponse, http.StatusInternalServerError)
	}

	responseID := responsesResponseID(c)
	createdAt := time.Now().Unix()
	model := info.UpstreamModelName

	var (
		usage       = &dto.Usage{}
		usageSeen   bool
		streamErr   *types.NewAPIError
		seq         int
		createdSent bool

		reasoningAdded       bool
		reasoningItemID      string
		reasoningOutputIndex = -1
		reasoningBuilder     strings.Builder

		messageAdded       bool
		messageItemID      string
		messageOutputIndex = -1
		textBuilder        strings.Builder

		toolsByIndex    = make(map[int]*responsesToolAccumulator)
		toolOrder       []int
		nextOutputIndex int
		usageText       strings.Builder
	)

	emit := func(payload map[string]any) bool {
		eventType, _ := payload["type"].(string)
		payload["sequence_number"] = seq
		seq++
		jsonData, err := common.Marshal(payload)
		if err != nil {
			streamErr = types.NewOpenAIError(err, types.ErrorCodeJsonMarshalFailed, http.StatusInternalServerError)
			return false
		}
		helper.ResponseChunkData(c, dto.ResponsesStreamResponse{Type: eventType}, string(jsonData))
		return true
	}

	ensureCreated := func() bool {
		if createdSent {
			return true
		}
		createdSent = true
		return emit(map[string]any{
			"type": "response.created",
			"response": map[string]any{
				"id": responseID, "object": "response", "created_at": createdAt,
				"status": "in_progress", "model": model, "output": []any{},
			},
		})
	}

	ensureReasoningStarted := func() bool {
		if reasoningAdded {
			return true
		}
		if !ensureCreated() {
			return false
		}
		reasoningOutputIndex = nextOutputIndex
		nextOutputIndex++
		reasoningItemID = "rs_" + responseID
		if !emit(map[string]any{
			"type":         "response.output_item.added",
			"output_index": reasoningOutputIndex,
			"item": map[string]any{
				"id": reasoningItemID, "type": "reasoning", "status": "in_progress", "summary": []any{},
			},
		}) {
			return false
		}
		reasoningAdded = true
		return emit(map[string]any{
			"type":          "response.reasoning_summary_part.added",
			"item_id":       reasoningItemID,
			"output_index":  reasoningOutputIndex,
			"summary_index": 0,
			"part":          map[string]any{"type": "summary_text", "text": ""},
		})
	}

	sendReasoningDelta := func(delta string) bool {
		if delta == "" {
			return true
		}
		if !ensureReasoningStarted() {
			return false
		}
		reasoningBuilder.WriteString(delta)
		usageText.WriteString(delta)
		return emit(map[string]any{
			"type":          "response.reasoning_summary_text.delta",
			"item_id":       reasoningItemID,
			"output_index":  reasoningOutputIndex,
			"summary_index": 0,
			"delta":         delta,
		})
	}

	ensureMessageStarted := func() bool {
		if messageAdded {
			return true
		}
		if !ensureCreated() {
			return false
		}
		messageOutputIndex = nextOutputIndex
		nextOutputIndex++
		messageItemID = "msg_" + responseID
		if !emit(map[string]any{
			"type":         "response.output_item.added",
			"output_index": messageOutputIndex,
			"item": map[string]any{
				"id": messageItemID, "type": "message", "status": "in_progress",
				"role": "assistant", "content": []any{},
			},
		}) {
			return false
		}
		messageAdded = true
		return emit(map[string]any{
			"type":          "response.content_part.added",
			"item_id":       messageItemID,
			"output_index":  messageOutputIndex,
			"content_index": 0,
			"part":          map[string]any{"type": "output_text", "text": "", "annotations": []any{}},
		})
	}

	sendTextDelta := func(delta string) bool {
		if delta == "" {
			return true
		}
		if !ensureMessageStarted() {
			return false
		}
		textBuilder.WriteString(delta)
		usageText.WriteString(delta)
		return emit(map[string]any{
			"type":          "response.output_text.delta",
			"item_id":       messageItemID,
			"output_index":  messageOutputIndex,
			"content_index": 0,
			"delta":         delta,
		})
	}

	handleToolDelta := func(tc dto.ToolCallResponse) bool {
		idx := 0
		if tc.Index != nil {
			idx = *tc.Index
		}
		acc, ok := toolsByIndex[idx]
		if !ok {
			if !ensureCreated() {
				return false
			}
			acc = &responsesToolAccumulator{outputIndex: nextOutputIndex, callID: tc.ID}
			nextOutputIndex++
			toolsByIndex[idx] = acc
			toolOrder = append(toolOrder, idx)
		}
		if tc.ID != "" {
			acc.callID = tc.ID
		}
		if tc.Function.Name != "" {
			acc.name = tc.Function.Name
		}
		if acc.itemID == "" {
			acc.itemID = acc.callID
			if acc.itemID == "" {
				acc.itemID = fmt.Sprintf("fc_%s_%d", responseID, acc.outputIndex)
			}
		}
		if !acc.added {
			if !emit(map[string]any{
				"type":         "response.output_item.added",
				"output_index": acc.outputIndex,
				"item": map[string]any{
					"id": acc.itemID, "type": "function_call", "status": "in_progress",
					"call_id": acc.callID, "name": acc.name, "arguments": "",
				},
			}) {
				return false
			}
			acc.added = true
		}
		if tc.Function.Arguments != "" {
			acc.args.WriteString(tc.Function.Arguments)
			usageText.WriteString(tc.Function.Arguments)
			return emit(map[string]any{
				"type":         "response.function_call_arguments.delta",
				"item_id":      acc.itemID,
				"output_index": acc.outputIndex,
				"delta":        tc.Function.Arguments,
			})
		}
		return true
	}

	captureUsage := func(u *dto.Usage) {
		if u == nil {
			return
		}
		usageSeen = true
		usage.PromptTokens = u.PromptTokens
		usage.CompletionTokens = u.CompletionTokens
		usage.TotalTokens = u.TotalTokens
		if usage.TotalTokens == 0 {
			usage.TotalTokens = usage.PromptTokens + usage.CompletionTokens
		}
		usage.PromptTokensDetails = u.PromptTokensDetails
		usage.CompletionTokenDetails = u.CompletionTokenDetails
	}

	helper.StreamScannerHandler(c, resp, info, func(data string, sr *helper.StreamResult) {
		if streamErr != nil {
			sr.Stop(streamErr)
			return
		}
		var chunk dto.ChatCompletionsStreamResponse
		if err := common.UnmarshalJsonStr(data, &chunk); err != nil {
			logger.LogError(c, "failed to unmarshal chat stream chunk: "+err.Error())
			sr.Error(err)
			return
		}
		if chunk.Model != "" {
			model = chunk.Model
		}
		if chunk.Created != 0 {
			createdAt = chunk.Created
		}
		if chunk.Usage != nil {
			captureUsage(chunk.Usage)
		}
		if !ensureCreated() {
			sr.Stop(streamErr)
			return
		}
		for _, choice := range chunk.Choices {
			if reasoning := choice.Delta.GetReasoningContent(); reasoning != "" {
				if !sendReasoningDelta(reasoning) {
					sr.Stop(streamErr)
					return
				}
			}
			if choice.Delta.Content != nil {
				if !sendTextDelta(*choice.Delta.Content) {
					sr.Stop(streamErr)
					return
				}
			}
			for _, tc := range choice.Delta.ToolCalls {
				if !handleToolDelta(tc) {
					sr.Stop(streamErr)
					return
				}
			}
		}
	})

	if streamErr != nil {
		return nil, nil, streamErr
	}

	if !ensureCreated() {
		return nil, nil, streamErr
	}

	// finalize reasoning item
	if reasoningAdded {
		fullReasoning := reasoningBuilder.String()
		if !emit(map[string]any{
			"type": "response.reasoning_summary_text.done", "item_id": reasoningItemID,
			"output_index": reasoningOutputIndex, "summary_index": 0, "text": fullReasoning,
		}) {
			return nil, nil, streamErr
		}
		if !emit(map[string]any{
			"type": "response.reasoning_summary_part.done", "item_id": reasoningItemID,
			"output_index": reasoningOutputIndex, "summary_index": 0,
			"part": map[string]any{"type": "summary_text", "text": fullReasoning},
		}) {
			return nil, nil, streamErr
		}
		if !emit(map[string]any{
			"type": "response.output_item.done", "output_index": reasoningOutputIndex,
			"item": map[string]any{
				"id": reasoningItemID, "type": "reasoning", "status": "completed",
				"summary": []map[string]any{{"type": "summary_text", "text": fullReasoning}},
			},
		}) {
			return nil, nil, streamErr
		}
	}

	// finalize message item
	if messageAdded {
		fullText := textBuilder.String()
		if !emit(map[string]any{
			"type": "response.output_text.done", "item_id": messageItemID,
			"output_index": messageOutputIndex, "content_index": 0, "text": fullText,
		}) {
			return nil, nil, streamErr
		}
		if !emit(map[string]any{
			"type": "response.content_part.done", "item_id": messageItemID,
			"output_index": messageOutputIndex, "content_index": 0,
			"part": map[string]any{"type": "output_text", "text": fullText, "annotations": []any{}},
		}) {
			return nil, nil, streamErr
		}
		if !emit(map[string]any{
			"type": "response.output_item.done", "output_index": messageOutputIndex,
			"item": map[string]any{
				"id": messageItemID, "type": "message", "status": "completed", "role": "assistant",
				"content": []map[string]any{{"type": "output_text", "text": fullText, "annotations": []any{}}},
			},
		}) {
			return nil, nil, streamErr
		}
	}

	// finalize function_call items
	for _, idx := range toolOrder {
		acc := toolsByIndex[idx]
		args := acc.args.String()
		if !emit(map[string]any{
			"type": "response.function_call_arguments.done", "item_id": acc.itemID,
			"output_index": acc.outputIndex, "arguments": args,
		}) {
			return nil, nil, streamErr
		}
		if !emit(map[string]any{
			"type": "response.output_item.done", "output_index": acc.outputIndex,
			"item": map[string]any{
				"id": acc.itemID, "type": "function_call", "status": "completed",
				"call_id": acc.callID, "name": acc.name, "arguments": args,
			},
		}) {
			return nil, nil, streamErr
		}
	}

	if !usageSeen || usage.TotalTokens == 0 {
		usage = service.ResponseText2Usage(c, usageText.String(), info.UpstreamModelName, info.GetEstimatePromptTokens())
	}
	normalizeResponsesUsage(usage)

	completed := map[string]any{
		"id": responseID, "object": "response", "created_at": createdAt,
		"status": "completed", "model": model,
		"output": assembleResponsesOutput(responsesOutputState{
			responseID:           responseID,
			reasoningAdded:       reasoningAdded,
			reasoningItemID:      reasoningItemID,
			reasoningOutputIndex: reasoningOutputIndex,
			reasoningText:        reasoningBuilder.String(),
			messageAdded:         messageAdded,
			messageItemID:        messageItemID,
			messageOutputIndex:   messageOutputIndex,
			messageText:          textBuilder.String(),
			toolOrder:            toolOrder,
			toolsByIndex:         toolsByIndex,
			nextOutputIndex:      nextOutputIndex,
		}),
		"usage": usage,
	}
	if !emit(map[string]any{"type": "response.completed", "response": completed}) {
		return nil, nil, streamErr
	}

	return usage, buildStreamAssistantMessage(&textBuilder, &reasoningBuilder, toolOrder, toolsByIndex), nil
}

// buildStreamAssistantMessage assembles the assistant turn accumulated across a chat stream so it
// can be persisted as conversation state for previous_response_id chaining.
func buildStreamAssistantMessage(textBuilder, reasoningBuilder *strings.Builder, toolOrder []int, toolsByIndex map[int]*responsesToolAccumulator) *dto.Message {
	msg := &dto.Message{Role: "assistant"}
	if textBuilder.Len() > 0 {
		msg.SetStringContent(textBuilder.String())
	} else {
		msg.Content = ""
	}
	if reasoningBuilder.Len() > 0 {
		reasoning := reasoningBuilder.String()
		msg.ReasoningContent = &reasoning
	}
	if len(toolOrder) > 0 {
		toolCalls := make([]dto.ToolCallRequest, 0, len(toolOrder))
		for _, idx := range toolOrder {
			acc := toolsByIndex[idx]
			toolCalls = append(toolCalls, dto.ToolCallRequest{
				ID:       acc.callID,
				Type:     "function",
				Function: dto.FunctionRequest{Name: acc.name, Arguments: acc.args.String()},
			})
		}
		msg.SetToolCalls(toolCalls)
	}
	return msg
}

type responsesOutputState struct {
	responseID           string
	reasoningAdded       bool
	reasoningItemID      string
	reasoningOutputIndex int
	reasoningText        string
	messageAdded         bool
	messageItemID        string
	messageOutputIndex   int
	messageText          string
	toolOrder            []int
	toolsByIndex         map[int]*responsesToolAccumulator
	nextOutputIndex      int
}

func assembleResponsesOutput(s responsesOutputState) []map[string]any {
	byIndex := make(map[int]map[string]any, s.nextOutputIndex)
	if s.reasoningAdded {
		byIndex[s.reasoningOutputIndex] = map[string]any{
			"id": s.reasoningItemID, "type": "reasoning", "status": "completed",
			"summary": []map[string]any{{"type": "summary_text", "text": s.reasoningText}},
		}
	}
	if s.messageAdded {
		byIndex[s.messageOutputIndex] = map[string]any{
			"id": s.messageItemID, "type": "message", "status": "completed", "role": "assistant",
			"content": []map[string]any{{"type": "output_text", "text": s.messageText, "annotations": []any{}}},
		}
	}
	for _, idx := range s.toolOrder {
		acc := s.toolsByIndex[idx]
		byIndex[acc.outputIndex] = map[string]any{
			"id": acc.itemID, "type": "function_call", "status": "completed",
			"call_id": acc.callID, "name": acc.name, "arguments": acc.args.String(),
		}
	}
	out := make([]map[string]any, 0, s.nextOutputIndex)
	for i := 0; i < s.nextOutputIndex; i++ {
		if item, ok := byIndex[i]; ok {
			out = append(out, item)
		}
	}
	return out
}

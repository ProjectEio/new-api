package openaicompat

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
)

// ResponsesRequestToChatCompletionsRequest converts an OpenAI Responses API request into an
// equivalent Chat Completions request, so a /v1/responses request can be relayed to a
// legacy chat-only upstream. It is the inverse of ChatCompletionsRequestToResponsesRequest.
//
// previous_response_id has no equivalent on a stateless chat upstream and is dropped.
func ResponsesRequestToChatCompletionsRequest(req *dto.OpenAIResponsesRequest) (*dto.GeneralOpenAIRequest, error) {
	if req == nil {
		return nil, errors.New("request is nil")
	}
	if req.Model == "" {
		return nil, errors.New("model is required")
	}

	out := &dto.GeneralOpenAIRequest{
		Model:         req.Model,
		Stream:        req.Stream,
		StreamOptions: req.StreamOptions,
		Temperature:   req.Temperature,
		TopP:          req.TopP,
		User:          req.User,
		Metadata:      req.Metadata,
		Store:         req.Store,
	}

	messages := make([]dto.Message, 0)
	if instructions := responsesInstructionsToString(req.Instructions); instructions != "" {
		messages = append(messages, dto.Message{Role: "system", Content: instructions})
	}
	inputMessages, err := responsesInputToChatMessages(req.Input)
	if err != nil {
		return nil, err
	}
	out.Messages = append(messages, inputMessages...)

	if req.MaxOutputTokens != nil {
		out.MaxCompletionTokens = req.MaxOutputTokens
	}
	if req.Reasoning != nil && req.Reasoning.Effort != "" {
		out.ReasoningEffort = req.Reasoning.Effort
	}
	if len(req.ParallelToolCalls) > 0 {
		var b bool
		if err := common.Unmarshal(req.ParallelToolCalls, &b); err == nil {
			out.ParallelTooCalls = &b
		}
	}
	tools, webSearch := responsesToolsToChat(req.Tools)
	if len(tools) > 0 {
		out.Tools = tools
	}
	if webSearch != nil {
		out.WebSearchOptions = webSearch
	}
	if toolChoice := responsesToolChoiceToChat(req.ToolChoice); toolChoice != nil {
		out.ToolChoice = toolChoice
	}
	if responseFormat := responsesTextToChatResponseFormat(req.Text); responseFormat != nil {
		out.ResponseFormat = responseFormat
	}

	return out, nil
}

func responsesInstructionsToString(raw json.RawMessage) string {
	if len(raw) == 0 || common.GetJsonType(raw) != "string" {
		return ""
	}
	var s string
	if err := common.Unmarshal(raw, &s); err != nil {
		return ""
	}
	return strings.TrimSpace(s)
}

// responsesInputToChatMessages reconstructs Chat Completions messages from the Responses
// `input` field. Consecutive function_call items are grouped into a single assistant
// message so parallel tool calls stay attached to one turn, matching OpenAI semantics.
func responsesInputToChatMessages(raw json.RawMessage) ([]dto.Message, error) {
	if len(raw) == 0 {
		return nil, nil
	}

	if common.GetJsonType(raw) == "string" {
		var s string
		if err := common.Unmarshal(raw, &s); err != nil {
			return nil, err
		}
		return []dto.Message{{Role: "user", Content: s}}, nil
	}

	var items []map[string]any
	if err := common.Unmarshal(raw, &items); err != nil {
		return nil, fmt.Errorf("invalid responses input: %w", err)
	}

	messages := make([]dto.Message, 0, len(items))
	var pendingToolCalls []dto.ToolCallRequest

	flushToolCalls := func() {
		if len(pendingToolCalls) == 0 {
			return
		}
		msg := dto.Message{Role: "assistant", Content: ""}
		msg.SetToolCalls(pendingToolCalls)
		messages = append(messages, msg)
		pendingToolCalls = nil
	}

	for _, item := range items {
		itemType, _ := item["type"].(string)
		if itemType == "" {
			if _, ok := item["role"]; ok {
				itemType = "message"
			}
		}

		switch itemType {
		case "function_call":
			name := stringFromMap(item, "name")
			if name == "" {
				continue
			}
			callID := stringFromMap(item, "call_id")
			if callID == "" {
				callID = stringFromMap(item, "id")
			}
			pendingToolCalls = append(pendingToolCalls, dto.ToolCallRequest{
				ID:   callID,
				Type: "function",
				Function: dto.FunctionRequest{
					Name:      name,
					Arguments: responsesAnyToString(item["arguments"]),
				},
			})
		case "function_call_output":
			flushToolCalls()
			callID := stringFromMap(item, "call_id")
			if callID == "" {
				callID = stringFromMap(item, "id")
			}
			messages = append(messages, dto.Message{
				Role:       "tool",
				ToolCallId: callID,
				Content:    responsesAnyToString(item["output"]),
			})
		case "message":
			flushToolCalls()
			role := stringFromMap(item, "role")
			if role == "" {
				role = "user"
			}
			msg := dto.Message{Role: role}
			content, ok := item["content"]
			if !ok || content == nil {
				msg.Content = ""
			} else {
				applyResponsesContentToMessage(&msg, content)
			}
			messages = append(messages, msg)
		default:
			// reasoning items and unknown types have no chat-completions equivalent.
			continue
		}
	}
	flushToolCalls()
	return messages, nil
}

func applyResponsesContentToMessage(msg *dto.Message, content any) {
	switch v := content.(type) {
	case string:
		msg.SetStringContent(v)
	case []any:
		parts := make([]dto.MediaContent, 0, len(v))
		var textBuilder strings.Builder
		onlyText := true
		for _, partAny := range v {
			part, ok := partAny.(map[string]any)
			if !ok {
				continue
			}
			switch stringFromMap(part, "type") {
			case "input_text", "output_text", "text":
				text := stringFromMap(part, "text")
				parts = append(parts, dto.MediaContent{Type: dto.ContentTypeText, Text: text})
				textBuilder.WriteString(text)
			case "input_image", "image_url":
				onlyText = false
				parts = append(parts, dto.MediaContent{
					Type:     dto.ContentTypeImageURL,
					ImageUrl: normalizeResponsesImageURL(part["image_url"]),
				})
			case "input_file", "file":
				onlyText = false
				parts = append(parts, dto.MediaContent{Type: dto.ContentTypeFile, File: part["file"]})
			case "input_audio":
				onlyText = false
				parts = append(parts, dto.MediaContent{Type: dto.ContentTypeInputAudio, InputAudio: part["input_audio"]})
			case "input_video", "video_url":
				onlyText = false
				parts = append(parts, dto.MediaContent{Type: dto.ContentTypeVideoUrl, VideoUrl: part["video_url"]})
			default:
				if text := stringFromMap(part, "text"); text != "" {
					parts = append(parts, dto.MediaContent{Type: dto.ContentTypeText, Text: text})
					textBuilder.WriteString(text)
				}
			}
		}
		if onlyText {
			msg.SetStringContent(textBuilder.String())
		} else {
			msg.SetMediaContent(parts)
		}
	default:
		if b, err := common.Marshal(content); err == nil {
			msg.SetStringContent(string(b))
		}
	}
}

// normalizeResponsesImageURL converts a Responses input_image image_url (a bare URL string
// or an object) into the Chat Completions {"url": ...} object shape.
func normalizeResponsesImageURL(v any) any {
	switch vv := v.(type) {
	case string:
		return map[string]any{"url": vv}
	case map[string]any:
		return vv
	default:
		return v
	}
}

// responsesToolsToChat converts Responses `tools` into Chat Completions tools. Function tools
// map 1:1; a web_search built-in tool maps onto chat web_search_options (honored by search-capable
// providers). Other built-ins (file_search, code_interpreter, image_generation) have no chat
// equivalent and are dropped.
func responsesToolsToChat(raw json.RawMessage) ([]dto.ToolCallRequest, *dto.WebSearchOptions) {
	if len(raw) == 0 {
		return nil, nil
	}
	var rawTools []map[string]any
	if err := common.Unmarshal(raw, &rawTools); err != nil {
		return nil, nil
	}
	tools := make([]dto.ToolCallRequest, 0, len(rawTools))
	var webSearch *dto.WebSearchOptions
	for _, t := range rawTools {
		toolType := stringFromMap(t, "type")
		switch {
		case toolType == "function" || toolType == "":
			name := stringFromMap(t, "name")
			if name == "" {
				continue
			}
			tools = append(tools, dto.ToolCallRequest{
				Type: "function",
				Function: dto.FunctionRequest{
					Name:        name,
					Description: stringFromMap(t, "description"),
					Parameters:  t["parameters"],
				},
			})
		case strings.HasPrefix(toolType, "web_search"):
			opts := &dto.WebSearchOptions{SearchContextSize: stringFromMap(t, "search_context_size")}
			if loc, ok := t["user_location"]; ok && loc != nil {
				if b, err := common.Marshal(loc); err == nil {
					opts.UserLocation = b
				}
			}
			webSearch = opts
		default:
			// file_search, code_interpreter, image_generation: no chat-completions equivalent.
			continue
		}
	}
	return tools, webSearch
}

func responsesToolChoiceToChat(raw json.RawMessage) any {
	if len(raw) == 0 {
		return nil
	}
	if common.GetJsonType(raw) == "string" {
		var s string
		if err := common.Unmarshal(raw, &s); err != nil {
			return nil
		}
		return s
	}
	var m map[string]any
	if err := common.Unmarshal(raw, &m); err != nil {
		return nil
	}
	// Responses: {"type":"function","name":"..."} → Chat: {"type":"function","function":{"name":"..."}}
	if stringFromMap(m, "type") == "function" {
		if name := stringFromMap(m, "name"); name != "" {
			return map[string]any{
				"type":     "function",
				"function": map[string]any{"name": name},
			}
		}
	}
	return m
}

// responsesTextToChatResponseFormat converts the Responses `text.format` object into a Chat
// Completions `response_format`. It is the inverse of convertChatResponseFormatToResponsesText:
// Responses flattens json_schema fields under `format`, while Chat nests them under json_schema.
func responsesTextToChatResponseFormat(raw json.RawMessage) *dto.ResponseFormat {
	if len(raw) == 0 {
		return nil
	}
	var textObj map[string]any
	if err := common.Unmarshal(raw, &textObj); err != nil {
		return nil
	}
	format, ok := textObj["format"].(map[string]any)
	if !ok {
		return nil
	}
	formatType := stringFromMap(format, "type")
	if formatType == "" {
		return nil
	}
	responseFormat := &dto.ResponseFormat{Type: formatType}
	if formatType == "json_schema" {
		schema := make(map[string]any, len(format))
		for k, v := range format {
			if k == "type" {
				continue
			}
			schema[k] = v
		}
		if len(schema) > 0 {
			if b, err := common.Marshal(schema); err == nil {
				responseFormat.JsonSchema = b
			}
		}
	}
	return responseFormat
}

func stringFromMap(m map[string]any, key string) string {
	if m == nil {
		return ""
	}
	if v, ok := m[key].(string); ok {
		return v
	}
	return ""
}

// responsesAnyToString renders a Responses field (function call arguments, tool output) as the
// string Chat Completions expects: strings pass through, everything else is JSON-encoded.
func responsesAnyToString(v any) string {
	switch vv := v.(type) {
	case nil:
		return ""
	case string:
		return vv
	default:
		if b, err := common.Marshal(vv); err == nil {
			return string(b)
		}
		return fmt.Sprintf("%v", vv)
	}
}

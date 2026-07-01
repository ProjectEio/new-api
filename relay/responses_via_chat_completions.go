package relay

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/relay/channel"
	openaichannel "github.com/QuantumNous/new-api/relay/channel/openai"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
)

// responsesViaChatCompletions downconverts an incoming /v1/responses request into a Chat
// Completions request, relays it to a legacy chat-only upstream, and rewrites the upstream
// chat response back into the Responses API format for the client. It is the mirror of
// chatCompletionsViaResponses.
//
// Because a chat upstream is stateless, previous_response_id is resolved locally: the prior
// conversation snapshot is loaded from Redis and spliced in, and the new turn is persisted so a
// follow-up request can chain onto it.
func responsesViaChatCompletions(c *gin.Context, info *relaycommon.RelayInfo, adaptor channel.Adaptor, responsesReq *dto.OpenAIResponsesRequest) (*dto.Usage, *types.NewAPIError) {
	chatReq, err := service.ResponsesRequestToChatCompletionsRequest(responsesReq)
	if err != nil {
		return nil, types.NewErrorWithStatusCode(err, types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}
	info.AppendRequestConversion(types.RelayFormatOpenAI)

	userID := c.GetInt("id")
	responseID := "resp_" + c.GetString(common.RequestIdKey)

	// Splice any stored previous_response_id history between the system prompt and this turn's
	// messages, so instructions stay first and tool-call/tool-output pairs remain adjacent.
	systemMsgs, turnMsgs := splitSystemMessages(chatReq.Messages)
	var priorMsgs []dto.Message
	if responsesReq.PreviousResponseID != "" {
		if loaded, ok := service.LoadResponsesConversation(responsesReq.PreviousResponseID, userID); ok {
			priorMsgs = loaded
		}
	}
	nonSystemMsgs := append(append([]dto.Message{}, priorMsgs...), turnMsgs...)
	chatReq.Messages = append(append([]dto.Message{}, systemMsgs...), nonSystemMsgs...)

	savedRelayMode := info.RelayMode
	savedRequestURLPath := info.RequestURLPath
	defer func() {
		info.RelayMode = savedRelayMode
		info.RequestURLPath = savedRequestURLPath
	}()

	info.RelayMode = relayconstant.RelayModeChatCompletions
	info.RequestURLPath = "/v1/chat/completions"

	convertedRequest, err := adaptor.ConvertOpenAIRequest(c, info, chatReq)
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeConvertRequestFailed, types.ErrOptionWithSkipRetry())
	}
	relaycommon.AppendRequestConversionFromRequest(info, convertedRequest)

	jsonData, err := common.Marshal(convertedRequest)
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeConvertRequestFailed, types.ErrOptionWithSkipRetry())
	}

	jsonData, err = relaycommon.RemoveDisabledFields(jsonData, info.ChannelOtherSettings, info.ChannelSetting.PassThroughBodyEnabled)
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeConvertRequestFailed, types.ErrOptionWithSkipRetry())
	}

	if len(info.ParamOverride) > 0 {
		jsonData, err = relaycommon.ApplyParamOverrideWithRelayInfo(jsonData, info)
		if err != nil {
			return nil, newAPIErrorFromParamOverride(err)
		}
	}

	body, size, closer, err := relaycommon.NewOutboundJSONBody(jsonData)
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeConvertRequestFailed, types.ErrOptionWithSkipRetry())
	}
	defer closer.Close()
	jsonData = nil
	info.UpstreamRequestBodySize = size
	var requestBody io.Reader = body

	resp, err := adaptor.DoRequest(c, info, requestBody)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeDoRequestFailed, http.StatusInternalServerError)
	}
	if resp == nil {
		return nil, types.NewOpenAIError(nil, types.ErrorCodeBadResponse, http.StatusInternalServerError)
	}

	statusCodeMappingStr := c.GetString("status_code_mapping")

	httpResp := resp.(*http.Response)
	info.IsStream = info.IsStream || strings.HasPrefix(httpResp.Header.Get("Content-Type"), "text/event-stream")
	if httpResp.StatusCode != http.StatusOK {
		newApiErr := service.RelayErrorHandler(c.Request.Context(), httpResp, false)
		service.ResetStatusCode(newApiErr, statusCodeMappingStr)
		return nil, newApiErr
	}

	var (
		usage     *dto.Usage
		assistant *dto.Message
		newApiErr *types.NewAPIError
	)
	if info.IsStream {
		usage, assistant, newApiErr = openaichannel.OaiChatToResponsesStreamHandler(c, info, httpResp)
	} else {
		usage, assistant, newApiErr = openaichannel.OaiChatToResponsesHandler(c, info, httpResp)
	}
	if newApiErr != nil {
		service.ResetStatusCode(newApiErr, statusCodeMappingStr)
		return nil, newApiErr
	}

	if assistant != nil && !responsesStoreDisabled(responsesReq.Store) {
		snapshot := append(append([]dto.Message{}, nonSystemMsgs...), *assistant)
		service.SaveResponsesConversation(responseID, userID, chatReq.Model, responsesReq.PreviousResponseID, snapshot)
	}
	return usage, nil
}

// splitSystemMessages separates leading system/developer prompts (re-supplied each turn) from the
// conversation turns that make up persistable state.
func splitSystemMessages(messages []dto.Message) (system []dto.Message, rest []dto.Message) {
	for _, m := range messages {
		if m.Role == "system" || m.Role == "developer" {
			system = append(system, m)
		} else {
			rest = append(rest, m)
		}
	}
	return system, rest
}

// responsesStoreDisabled reports whether the request explicitly opted out of storage via
// "store": false. Absent or any other value defaults to storing.
func responsesStoreDisabled(raw json.RawMessage) bool {
	if len(raw) == 0 {
		return false
	}
	var enabled bool
	if err := common.Unmarshal(raw, &enabled); err == nil {
		return !enabled
	}
	return false
}

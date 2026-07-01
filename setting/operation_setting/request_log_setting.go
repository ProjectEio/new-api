package operation_setting

import "github.com/QuantumNous/new-api/setting/config"

// IP 解析来源
const (
	// IpSourceAuto 信任反向代理转发头（X-Forwarded-For / X-Real-IP），适用于站点前置了反向代理的场景
	IpSourceAuto = "auto"
	// IpSourceReal 直接使用 TCP 连接的对端地址（真实网络），忽略转发头
	IpSourceReal = "real"
)

// RequestLogSetting 控制在消费/错误日志中如何记录客户端 IP 与 User-Agent。
// CDN 并非每个部署都有，因此相关能力默认关闭、可按需开启。
type RequestLogSetting struct {
	// Enabled 全局记录请求 IP / User-Agent（与用户级 record_ip_log 取并集）
	Enabled bool `json:"enabled"`
	// IpSource IP 解析来源：auto（信任反代转发头）| real（直连真实网络）
	IpSource string `json:"ip_source"`
	// CdnRealIpHeader CDN 回源时携带真实客户端 IP 的请求头（如 CF-Connecting-IP）。
	// 为空表示未使用 CDN；配置后将从该头取真实来源，并把回源边缘 IP 标记为 CDN 来源。
	CdnRealIpHeader string `json:"cdn_real_ip_header"`
	// RecordUserAgent 记录 IP 时是否同时记录 User-Agent
	RecordUserAgent bool `json:"record_user_agent"`
}

var requestLogSetting = RequestLogSetting{
	Enabled:         true,
	IpSource:        IpSourceAuto,
	CdnRealIpHeader: "",
	RecordUserAgent: true,
}

func init() {
	config.GlobalConfig.Register("request_log_setting", &requestLogSetting)
}

func GetRequestLogSetting() *RequestLogSetting {
	return &requestLogSetting
}

// UseRealNetworkIp 是否直接使用真实网络（TCP 对端）地址而非转发头
func (s *RequestLogSetting) UseRealNetworkIp() bool {
	return s.IpSource == IpSourceReal
}

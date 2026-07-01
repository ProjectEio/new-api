package constant

type MultiKeyMode string

const (
	MultiKeyModeRandom  MultiKeyMode = "random"  // 随机
	MultiKeyModePolling MultiKeyMode = "polling" // 轮询
	MultiKeyModeSticky  MultiKeyMode = "sticky"  // 粘性：每个用户粘住一个密钥，出错才切换；密钥在健康集合中均匀分配以负载均衡
)

// Sticky 模式默认配置
const (
	DefaultMultiKeyErrorThreshold   = 3   // 连续出错多少次后禁用该密钥
	DefaultMultiKeyRecoverySeconds  = 300 // 被禁用密钥的恢复探测间隔（秒）
	DefaultMultiKeyMaxRecoveryFails = 3   // 恢复探测连续失败多少次后永久禁用（需人工恢复）
)

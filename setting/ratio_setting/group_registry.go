package ratio_setting

import (
	"errors"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/types"
)

// GroupEntry 中央分组注册表条目：一处定义分组的显示名、计费倍率与是否禁止余额消费。
// 账号（可访问组）、套餐（授予组）、计费与鉴权都引用注册表中的分组名。
type GroupEntry struct {
	DisplayName string  `json:"display_name"`
	Ratio       float64 `json:"ratio"`
	// DisableBalanceConsume 为 true 时，使用该分组的请求只能用套餐额度支付，不能扣钱包余额；
	// 无可用套餐额度时请求被拒绝并提示“无可用套餐”。
	DisableBalanceConsume bool `json:"disable_balance_consume"`
}

var defaultGroupRegistry = map[string]GroupEntry{
	"default": {DisplayName: "默认分组", Ratio: 1},
	"vip":     {DisplayName: "VIP分组", Ratio: 1},
}

var groupRegistryMap = types.NewRWMap[string, GroupEntry]()

func init() {
	groupRegistryMap.AddAll(defaultGroupRegistry)
}

// GetGroupRegistryCopy 返回注册表的快照（分组名 -> 条目）。
func GetGroupRegistryCopy() map[string]GroupEntry {
	return groupRegistryMap.ReadAll()
}

// GroupExists 分组是否在注册表中定义。
func GroupExists(name string) bool {
	_, ok := groupRegistryMap.Get(name)
	return ok
}

// GroupDisablesBalanceConsume 该分组是否禁止余额消费（仅可用套餐额度）。
func GroupDisablesBalanceConsume(name string) bool {
	e, ok := groupRegistryMap.Get(name)
	return ok && e.DisableBalanceConsume
}

// GetGroupDisplayName 返回分组显示名，未配置时回退为分组名本身。
func GetGroupDisplayName(name string) string {
	if e, ok := groupRegistryMap.Get(name); ok && e.DisplayName != "" {
		return e.DisplayName
	}
	return name
}

// GetGroupEntry 返回分组条目。
func GetGroupEntry(name string) (GroupEntry, bool) {
	return groupRegistryMap.Get(name)
}

func GroupRegistry2JSONString() string {
	return groupRegistryMap.MarshalJSONString()
}

func UpdateGroupRegistryByJSONString(jsonStr string) error {
	return types.LoadFromJsonString(groupRegistryMap, jsonStr)
}

// CheckGroupRegistry 校验注册表 JSON：分组名非空、倍率非负。
func CheckGroupRegistry(jsonStr string) error {
	m := make(map[string]GroupEntry)
	if err := common.UnmarshalJsonStr(jsonStr, &m); err != nil {
		return err
	}
	for name, e := range m {
		if strings.TrimSpace(name) == "" {
			return errors.New("group name must not be empty")
		}
		if e.Ratio < 0 {
			return errors.New("group ratio must be not less than 0: " + name)
		}
	}
	return nil
}

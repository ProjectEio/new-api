package ratio_setting

import (
	"errors"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/types"
)

// 分组访问/计费模式
const (
	GroupAccessOpen        = "open"         // 默认：所有人可用，走钱包余额
	GroupAccessPlanOnly    = "plan_only"    // 仅套餐：需授权来源才能访问，扣套餐额度
	GroupAccessBalanceOnly = "balance_only" // 仅余额：所有人可用，只走余额，不动套餐额度
)

// GroupEntry 中央分组注册表条目：一处定义分组的显示名、计费倍率、访问模式与绑定套餐。
type GroupEntry struct {
	DisplayName string  `json:"display_name"`
	Ratio       float64 `json:"ratio"`
	// AccessMode：open(默认) / plan_only(仅套餐) / balance_only(仅余额)。空视为 open。
	AccessMode string `json:"access_mode"`
	// Plans 绑定的套餐 ID 列表（可多个）。plan_only 时，持有其中任一套餐的订阅即被授权访问并从其额度扣费。
	Plans []int `json:"plans"`
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

// GetGroupAccessMode 返回分组访问模式（空视为 open）。
func GetGroupAccessMode(name string) string {
	e, ok := groupRegistryMap.Get(name)
	if !ok || strings.TrimSpace(e.AccessMode) == "" {
		return GroupAccessOpen
	}
	return e.AccessMode
}

// GroupIsPlanOnly 该分组是否仅套餐可用（访问需授权、扣套餐额度）。
func GroupIsPlanOnly(name string) bool {
	return GetGroupAccessMode(name) == GroupAccessPlanOnly
}

// GroupIsBalanceOnly 该分组是否仅余额可用（不动套餐额度）。
func GroupIsBalanceOnly(name string) bool {
	return GetGroupAccessMode(name) == GroupAccessBalanceOnly
}

// GetGroupPlans 返回分组绑定的套餐 ID 列表。
func GetGroupPlans(name string) []int {
	if e, ok := groupRegistryMap.Get(name); ok {
		return e.Plans
	}
	return nil
}

// GroupsAuthorizedByPlan 反查：绑定了指定套餐的所有分组名（用于订阅激活/到期维护授权表）。
func GroupsAuthorizedByPlan(planId int) []string {
	if planId <= 0 {
		return nil
	}
	groups := make([]string, 0)
	for name, e := range groupRegistryMap.ReadAll() {
		for _, p := range e.Plans {
			if p == planId {
				groups = append(groups, name)
				break
			}
		}
	}
	return groups
}

// BindGroupToPlans 设置分组的访问模式与绑定套餐（不存在则新建）。用于默认播种等场景。
func BindGroupToPlans(name string, mode string, planIds []int) {
	e, ok := groupRegistryMap.Get(name)
	if !ok {
		e = GroupEntry{DisplayName: name, Ratio: 1}
	}
	e.AccessMode = mode
	e.Plans = planIds
	groupRegistryMap.AddAll(map[string]GroupEntry{name: e})
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

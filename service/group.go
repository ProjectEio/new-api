package service

import (
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
)

// GetUserUsableGroups 返回系统中定义的分组目录（中央分组注册表）+ 用户自身分组。
// 实际访问权限由 auth 依据账号 AccessibleGroups 强制，此处仅用于分组目录展示/自动分组候选。
func GetUserUsableGroups(userGroup string) map[string]string {
	groups := make(map[string]string)
	for name, entry := range ratio_setting.GetGroupRegistryCopy() {
		if entry.DisplayName != "" {
			groups[name] = entry.DisplayName
		} else {
			groups[name] = name
		}
	}
	if userGroup != "" {
		if _, ok := groups[userGroup]; !ok {
			groups[userGroup] = "用户分组"
		}
	}
	return groups
}

func GroupInUserUsableGroups(userGroup, groupName string) bool {
	_, ok := GetUserUsableGroups(userGroup)[groupName]
	return ok
}

// GetUserAutoGroup 根据用户分组获取自动分组设置
func GetUserAutoGroup(userGroup string) []string {
	groups := GetUserUsableGroups(userGroup)
	autoGroups := make([]string, 0)
	for _, group := range setting.GetAutoGroups() {
		if _, ok := groups[group]; ok {
			autoGroups = append(autoGroups, group)
		}
	}
	return autoGroups
}

// GetUserGroupRatio 获取用户使用某个分组的倍率
// userGroup 用户分组
// group 需要获取倍率的分组
func GetUserGroupRatio(userGroup, group string) float64 {
	ratio, ok := ratio_setting.GetGroupGroupRatio(userGroup, group)
	if ok {
		return ratio
	}
	return ratio_setting.GetGroupRatio(group)
}

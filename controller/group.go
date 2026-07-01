package controller

import (
	"net/http"

	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/ratio_setting"

	"github.com/gin-gonic/gin"
)

func GetGroups(c *gin.Context) {
	groupNames := make([]string, 0)
	for groupName := range ratio_setting.GetGroupRegistryCopy() {
		groupNames = append(groupNames, groupName)
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    groupNames,
	})
}

func GetUserGroups(c *gin.Context) {
	usableGroups := make(map[string]map[string]interface{})
	userId := c.GetInt("id")
	userGroup, _ := model.GetUserGroup(userId, false)
	for groupName, desc := range service.GetUserUsableGroups(userGroup) {
		usableGroups[groupName] = map[string]interface{}{
			"ratio": service.GetUserGroupRatio(userGroup, groupName),
			"desc":  desc,
		}
	}
	// auto 为自动分组特殊选项，始终可选
	usableGroups["auto"] = map[string]interface{}{
		"ratio": "自动",
		"desc":  "自动选择",
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    usableGroups,
	})
}

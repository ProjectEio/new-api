package model

import (
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newStickyMultiKeyChannel(id int, keys []string) *Channel {
	return &Channel{
		Id:  id,
		Key: strings.Join(keys, "\n"),
		ChannelInfo: ChannelInfo{
			IsMultiKey:   true,
			MultiKeyMode: constant.MultiKeyModeSticky,
		},
	}
}

// useMemoryCache forces the sticky selection path to skip its SaveChannelInfo DB
// write so the tests stay hermetic in-memory unit tests.
func useMemoryCache(t *testing.T) {
	t.Helper()
	prev := common.MemoryCacheEnabled
	common.MemoryCacheEnabled = true
	t.Cleanup(func() { common.MemoryCacheEnabled = prev })
}

func TestGetNextEnabledKeySticky_LoadBalancesNewUsersAndReusesAffinity(t *testing.T) {
	useMemoryCache(t)

	const channelId = 900001
	keys := []string{"k0", "k1", "k2"}
	ch := newStickyMultiKeyChannel(channelId, keys)

	users := []int{1001, 1002, 1003}
	for _, u := range users {
		ClearStickyKeyForUser(channelId, u)
	}
	t.Cleanup(func() {
		for _, u := range users {
			ClearStickyKeyForUser(channelId, u)
		}
	})

	// New users are spread round-robin across every enabled key for load balancing.
	assigned := make([]int, 0, len(users))
	for _, u := range users {
		key, idx, err := ch.GetNextEnabledKey(u, nil)
		require.Nil(t, err)
		require.Equal(t, keys[idx], key)
		assigned = append(assigned, idx)
	}
	assert.Equal(t, []int{0, 1, 2}, assigned, "three new users should each land on a distinct key")

	// A returning user sticks to its previously assigned key.
	for i, u := range users {
		want := assigned[i]
		key, idx, err := ch.GetNextEnabledKey(u, nil)
		require.Nil(t, err)
		assert.Equal(t, want, idx, "user %d should reuse its sticky key", u)
		assert.Equal(t, keys[want], key)
	}
}

func TestGetNextEnabledKeySticky_ExcludesTriedIndexes(t *testing.T) {
	useMemoryCache(t)

	const channelId = 900002
	const userId = 2001
	keys := []string{"k0", "k1", "k2"}
	ch := newStickyMultiKeyChannel(channelId, keys)
	ClearStickyKeyForUser(channelId, userId)
	t.Cleanup(func() { ClearStickyKeyForUser(channelId, userId) })

	// First hit lands on key0 (polling index starts at 0) and becomes the sticky key.
	_, first, err := ch.GetNextEnabledKey(userId, nil)
	require.Nil(t, err)
	require.Equal(t, 0, first)

	// A retry that already tried key0 must move off it even though it is the sticky key.
	_, retryIdx, err := ch.GetNextEnabledKey(userId, []int{0})
	require.Nil(t, err)
	assert.NotEqual(t, 0, retryIdx, "retry must skip the already-tried key")
	assert.Equal(t, 2, retryIdx)

	// When every enabled key was already tried, fall back to the full set instead of erroring.
	_, fallbackIdx, err := ch.GetNextEnabledKey(userId, []int{0, 1, 2})
	require.Nil(t, err)
	assert.Contains(t, []int{0, 1, 2}, fallbackIdx)
}

func TestGetNextEnabledKeySticky_ErrorsWhenAllKeysDisabled(t *testing.T) {
	useMemoryCache(t)

	const channelId = 900007
	keys := []string{"k0", "k1"}
	ch := newStickyMultiKeyChannel(channelId, keys)
	ch.ChannelInfo.MultiKeyMaxRecoveryFails = 3
	ch.ChannelInfo.MultiKeyStatusList = map[int]int{
		0: common.ChannelStatusAutoDisabled,
		1: common.ChannelStatusAutoDisabled,
	}
	// Both keys are permanently disabled (recovery exhausted) so the reactive
	// recovery pass cannot re-enable them.
	ch.ChannelInfo.MultiKeyRecoveryFails = map[int]int{0: 3, 1: 3}

	_, _, err := ch.GetNextEnabledKey(3001, nil)
	require.NotNil(t, err, "no enabled keys should surface an error, not a disabled key")
}

func TestHandlerMultiKeyUpdateSticky_ThresholdDisableAndReset(t *testing.T) {
	const channelId = 900003
	keys := []string{"k0", "k1"}
	ch := newStickyMultiKeyChannel(channelId, keys)
	ch.ChannelInfo.MultiKeyErrorThreshold = 2

	// First error stays under the threshold: key remains enabled, error counted.
	handlerMultiKeyUpdate(ch, "k0", common.ChannelStatusAutoDisabled, "boom")
	_, disabled := ch.ChannelInfo.MultiKeyStatusList[0]
	assert.False(t, disabled, "key0 should still be enabled below threshold")
	assert.Equal(t, 1, ch.ChannelInfo.MultiKeyErrorCount[0])
	assert.Equal(t, 0, ch.ChannelInfo.MultiKeyRecoveryFails[0])

	// Second error reaches the threshold: key disabled, error count cleared, recovery cycle counted.
	handlerMultiKeyUpdate(ch, "k0", common.ChannelStatusAutoDisabled, "boom again")
	assert.Equal(t, common.ChannelStatusAutoDisabled, ch.ChannelInfo.MultiKeyStatusList[0])
	_, hasErrCount := ch.ChannelInfo.MultiKeyErrorCount[0]
	assert.False(t, hasErrCount, "error count should reset once the key is disabled")
	assert.Equal(t, 1, ch.ChannelInfo.MultiKeyRecoveryFails[0])
	assert.NotZero(t, ch.ChannelInfo.MultiKeyDisabledTime[0])

	// A healthy call clears the sticky counters and re-enables the key.
	handlerMultiKeyUpdate(ch, "k0", common.ChannelStatusEnabled, "")
	_, stillDisabled := ch.ChannelInfo.MultiKeyStatusList[0]
	assert.False(t, stillDisabled, "healthy call should re-enable key0")
	_, hasFails := ch.ChannelInfo.MultiKeyRecoveryFails[0]
	assert.False(t, hasFails, "recovery fails should reset on success")
}

func TestRecoverStickyKeys(t *testing.T) {
	keys := []string{"k0", "k1"}
	now := common.GetTimestamp()

	t.Run("re-enables after cooldown elapses", func(t *testing.T) {
		ch := newStickyMultiKeyChannel(900004, keys)
		ch.ChannelInfo.MultiKeyRecoverySeconds = 100
		ch.ChannelInfo.MultiKeyStatusList = map[int]int{0: common.ChannelStatusAutoDisabled}
		ch.ChannelInfo.MultiKeyDisabledTime = map[int]int64{0: now - 200}

		changed := ch.recoverStickyKeys(keys)
		assert.True(t, changed)
		_, stillDisabled := ch.ChannelInfo.MultiKeyStatusList[0]
		assert.False(t, stillDisabled, "elapsed cooldown should re-enable the key")
	})

	t.Run("keeps disabled during cooldown", func(t *testing.T) {
		ch := newStickyMultiKeyChannel(900005, keys)
		ch.ChannelInfo.MultiKeyRecoverySeconds = 100
		ch.ChannelInfo.MultiKeyStatusList = map[int]int{0: common.ChannelStatusAutoDisabled}
		ch.ChannelInfo.MultiKeyDisabledTime = map[int]int64{0: now}

		changed := ch.recoverStickyKeys(keys)
		assert.False(t, changed)
		assert.Equal(t, common.ChannelStatusAutoDisabled, ch.ChannelInfo.MultiKeyStatusList[0], "key must stay disabled within cooldown")
	})

	t.Run("stays disabled past max recovery fails", func(t *testing.T) {
		ch := newStickyMultiKeyChannel(900006, keys)
		ch.ChannelInfo.MultiKeyRecoverySeconds = 100
		ch.ChannelInfo.MultiKeyMaxRecoveryFails = 3
		ch.ChannelInfo.MultiKeyStatusList = map[int]int{0: common.ChannelStatusAutoDisabled}
		ch.ChannelInfo.MultiKeyDisabledTime = map[int]int64{0: now - 200}
		ch.ChannelInfo.MultiKeyRecoveryFails = map[int]int{0: 3}

		changed := ch.recoverStickyKeys(keys)
		assert.False(t, changed, "key at max recovery fails must not auto-recover")
		assert.Equal(t, common.ChannelStatusAutoDisabled, ch.ChannelInfo.MultiKeyStatusList[0])
	})
}

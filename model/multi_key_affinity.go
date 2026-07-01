package model

import (
	"strconv"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/pkg/cachex"

	"github.com/samber/hot"
)

// Per-user sticky key affinity for multi-key channels running in "sticky" mode.
// Maps (channelId, userId) -> keyIndex so a user keeps hitting the same key until
// it errors, while users are spread across healthy keys for load balancing.

const multiKeyAffinityNamespace = "new-api:multi_key_affinity:v1"

const multiKeyAffinityTTL = 2 * time.Hour

var (
	multiKeyAffinityCacheOnce sync.Once
	multiKeyAffinityCache     *cachex.HybridCache[int]
)

func getMultiKeyAffinityCache() *cachex.HybridCache[int] {
	multiKeyAffinityCacheOnce.Do(func() {
		multiKeyAffinityCache = cachex.NewHybridCache[int](cachex.HybridCacheConfig[int]{
			Namespace: cachex.Namespace(multiKeyAffinityNamespace),
			Redis:     common.RDB,
			RedisEnabled: func() bool {
				return common.RedisEnabled && common.RDB != nil
			},
			RedisCodec: cachex.IntCodec{},
			Memory: func() *hot.HotCache[string, int] {
				return hot.NewHotCache[string, int](hot.LRU, 200_000).
					WithTTL(multiKeyAffinityTTL).
					WithJanitor().
					Build()
			},
		})
	})
	return multiKeyAffinityCache
}

func multiKeyAffinityKey(channelId, userId int) string {
	return strconv.Itoa(channelId) + ":" + strconv.Itoa(userId)
}

func getStickyKeyIndex(channelId, userId int) (int, bool) {
	if userId <= 0 {
		return 0, false
	}
	idx, found, err := getMultiKeyAffinityCache().Get(multiKeyAffinityKey(channelId, userId))
	if err != nil || !found {
		return 0, false
	}
	return idx, true
}

func setStickyKeyIndex(channelId, userId, keyIndex int) {
	if userId <= 0 {
		return
	}
	_ = getMultiKeyAffinityCache().SetWithTTL(multiKeyAffinityKey(channelId, userId), keyIndex, multiKeyAffinityTTL)
}

// ClearStickyKeyForUser drops a user's sticky key assignment so the next request
// (e.g. an auto-retry after the current key errored) is routed to another key.
func ClearStickyKeyForUser(channelId, userId int) {
	if userId <= 0 {
		return
	}
	_, _ = getMultiKeyAffinityCache().DeleteMany([]string{multiKeyAffinityKey(channelId, userId)})
}

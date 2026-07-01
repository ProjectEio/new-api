# new-api 跨机房高可用部署(3 主机 + CDN,两层故障切换)

> 目标:**CDN 负责全局均衡与机房级容灾**;每机房 **nginx 负责节点级秒切新流量**;任一机房 / 主机(含 nginx)整体宕机时,CDN 自动把新流量路由到存活机房。

---

## 1. 架构总览

```
                        ┌───────────────────────────────┐
            用户 ──────▶ │   CDN(全局均衡 + 机房级容灾)   │
                        │  Anycast · TLS · WAF/DDoS      │
                        │  origin 健康探测 · 故障转移      │
                        └──┬────────────┬────────────┬───┘
                  就近/健康 │            │            │
                 ┌─────────▼──┐  ┌──────▼─────┐  ┌───▼────────┐
                 │  DC-A 主    │  │  DC-B 从    │  │  DC-C 从    │
                 │  nginx  ┐   │  │  nginx  ┐   │  │  nginx  ┐   │
                 │  秒切   │   │  │  秒切   │   │  │  秒切   │   │
                 │  new-api▼   │  │  new-api▼   │  │  new-api▼   │
                 │ (master)    │  │ (slave)     │  │ (slave)     │
                 └────┬───────┘  └────┬───────┘  └────┬───────┘
                      │               │               │
                      └──── 跨 WAN:周期 sync + 批量写 ─┘
                      │
              ┌───────▼────────────────────────────┐
              │ 主 MySQL/PG  (+ 跨机房 standby)      │  ← 唯一真相源,需 HA
              │ (可选) Redis:仅锁 / master 协调       │
              │ 独立日志库 / ClickHouse (LOG_SQL_DSN) │
              └────────────────────────────────────┘
```

---

## 2. 组件职责

| 组件 | 角色 | 关键行为 |
|---|---|---|
| **CDN**(全局唯一入口) | 全局均衡 + 机房级容灾 | Anycast 就近接入、TLS 卸载、WAF/DDoS;对 3 个机房做 origin 健康探测,探测失败即摘除并把新流量转到存活机房 |
| **nginx**(每机房一套) | 节点级反代 + 秒切 | 反代本机房 new-api;被动健康检查 + `proxy_next_upstream` 重试;后端崩溃时亚秒~数秒切到备份 upstream |
| **new-api 节点** | 无状态应用 | 热路径读本地内存缓存;master 跑迁移+单例定时任务,slave 只接流量 |
| **主 MySQL/PG** | 唯一真相源 | 所有写入最终落此;**必须做跨机房 standby + 故障切换** |
| **Redis(可选)** | 锁 / master 协调 | 只放主机房内网,**不要放到每请求热路径**(否则远端机房每请求跨 WAN) |
| **独立日志库** | 高频日志下沉 | 把最大写量从主库/WAN 剥离(高量选 ClickHouse) |

---

## 3. 两层故障切换(核心)

### Tier 1 — nginx 节点级(机房内,秒切)
- **被动健康检查**:`max_fails` / `fail_timeout` 标记坏后端,新请求不再分配。
- **失败重试**:`proxy_next_upstream` 把失败请求立刻转到备份 upstream。
- **生效速度**:app 崩溃 / 无响应 → **亚秒 ~ 数秒**。
- **前提**:nginx 自身存活(与 app 同机时,进程崩溃它能切;**整机宕机它切不了** → 交给 Tier 2)。

### Tier 2 — CDN 机房级(整机 / nginx 宕机)
- 把 3 个机房配成 **origin group / 负载均衡池**,开**主动健康探测**。
- 探测连续失败 → 摘除该 origin,新流量转其余机房。
- **生效速度**:受 **CDN 健康探测间隔**约束,通常 **~10–30s**。

| 故障场景 | 触发层 | 恢复时间 | 用户影响 |
|---|---|---|---|
| 某机房 new-api 进程崩溃(nginx 活) | nginx | 亚秒~数秒 | 该机房请求重试到备份后端,基本无感 |
| 某机房 nginx / 整机宕机 | CDN | ~10–30s(探测间隔) | 该机房被摘除,新流量转其余机房 |
| **主库(DC-A DB)宕机** | 需 DB 故障切换 | 取决于 standby 提升 | **全局写受阻**(见 §5,最需防的点) |
| master 节点宕机 | 锁/主从 | 定时任务暂停 | **在线服务不受影响** |

---

## 4. 为什么能随意重路由(无需会话保持)

- 会话是 **cookie + 共享 `SESSION_SECRET`/`CRYPTO_SECRET`**,任一节点都能校验。
- 任一节点读**共享 DB / 本地缓存**即可服务同一请求。
- → CDN 与 nginx 可**自由重路由,无需 sticky session**,这是两层秒切成立的前提。

---

## 5. 状态与数据约束(决定容灾边界)

- **单主库 = 真相源**:new-api 不是多主架构,跨机房只能是「1 主写机房 + 2 从缓存供流机房」。主库是锚点,也是最终单点 → **优先投入跨机房 DB HA**。
- **内存缓存供流**(`MEMORY_CACHE_ENABLED=true`):令牌/渠道/配置走本地 RAM,远端机房热路径不跨 WAN;代价是配置有 `~SYNC_FREQUENCY` 传播延迟、限流变**每节点**、额度弱一致。
- **批量写**(`BATCH_UPDATE`):额度/用量本地缓冲、周期刷库,降低跨 WAN 写频次。
- **主从**:仅 master 跑迁移与单例定时任务(日志清理/订阅重置/看板聚合/渠道测试)。

---

## 6. 节点配置(env,全部节点共享 secret)

```bash
# —— 所有节点相同 ——
SQL_DSN=mysql://user:pass@dc-a-db:3306/newapi   # 都指向主库(或经就近代理)
SESSION_SECRET=<同一随机串>                       # 跨节点会话/加密一致
CRYPTO_SECRET=<同一随机串>
MEMORY_CACHE_ENABLED=true                        # 热路径走本地内存,远端不跨 WAN
SYNC_FREQUENCY=30                                # 配置传播周期(按可接受延迟调)
BATCH_UPDATE_INTERVAL=5                          # 额度批量刷库,减少跨 WAN 写
LOG_SQL_DSN=<独立日志库或 ClickHouse DSN>         # 高频日志不压主库/WAN

# —— 差异 ——
# DC-A(主):不设 NODE_TYPE  → master
# DC-B / DC-C(从):NODE_TYPE=slave
# REDIS_CONN_STRING:如启用,仅指向主机房内网 Redis,用于锁/协调,勿上每请求路径
```

---

## 7. nginx 关键配置(秒切 + 流式透传)

```nginx
upstream newapi {
    server 127.0.0.1:3000        max_fails=1 fail_timeout=3s;   # 本机 new-api
    server 10.0.0.12:3000 backup;                              # (可选)同机房备份节点
    keepalive 64;
}

server {
    listen 443 ssl http2;

    location / {
        proxy_pass http://newapi;

        # —— 秒切:坏后端立即重试到下一个 upstream ——
        proxy_next_upstream error timeout http_502 http_503 http_504;
        proxy_next_upstream_tries   2;
        proxy_connect_timeout       2s;

        # —— 流式(SSE)透传:务必关缓冲,否则流式被打断 ——
        proxy_buffering  off;
        proxy_cache      off;
        proxy_read_timeout 1h;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
    }
}
```

> 被动健康检查(`max_fails`/`fail_timeout`)开源版即可;若要**主动探测**上游,用 nginx Plus 或 OpenResty/`ngx_http_upstream_check_module`。

---

## 8. CDN 关键配置

- **均衡 + 容灾**:3 机房 origin 配成负载均衡池 / origin group,开**主动健康探测**与**故障转移**(如 Cloudflare Load Balancing、CloudFront Origin Group、Fastly 等)。
- **API 透传不缓存**:relay 响应逐请求、不可缓存;只对**静态前端**做边缘缓存。
- **SSE 不缓冲(关键)**:关闭对流式响应的缓冲/聚合,拉长读超时,上线前**实测流式**。
- **安全**:TLS 卸载、WAF、DDoS、限速。
- **探测间隔**决定「整机宕机」的恢复时间,按 SLA 调小(注意误摘风险)。

---

## 9. 前置条件与风险(先拍板)

1. **弃用 SQLite** → 共享 MySQL≥5.7.8 / PostgreSQL;**主库必须跨机房 HA**(主 + standby + 故障切换),否则 3 台 app 只复制了便宜的部分,贵的单点没解决。
2. **限流粒度**:内存模式下全局限流变「每节点 × 3」;要么接受(上游厂商配额才是真上限),要么单独做限流层——别用共享 Redis 限流把跨机房 RTT 请回热路径。
3. **额度严格性**:跨机房 + 批量刷 → 超支窗口更大;WAN 分区时远端**写不进主库**,需决定「拦截扣费(fail-closed,计费安全)」还是「先服务后补账(fail-open)」。
4. **配置传播**:非秒级,`~SYNC_FREQUENCY` 内全网收敛;要秒级需自行加 Redis pub/sub(现无)。
5. **active-active 跨机房写**非本架构目标,如需要须换分布式 SQL(CockroachDB/Vitess/Galera),与本代码库未经验证。

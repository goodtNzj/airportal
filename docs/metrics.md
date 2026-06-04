# AirPortal Prometheus 指标文档

本文档描述 AirPortal 暴露的 Prometheus 指标，可用于 Grafana、Alertmanager 等
监控系统集成。所有指标的命名空间统一为 `airportal_`，避免与基础设施默认
指标冲突。

## 1. 快速开始

### 启用 / 关闭

默认开启。配置项位于 `config.json` 的 `metrics` 段，或使用环境变量覆盖：

| 配置项 (config.json) | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `metrics.enabled` | `METRICS_ENABLED` | `true` | 是否启用指标导出 |
| `metrics.path` | `METRICS_PATH` | `/metrics` | 指标暴露路径 |
| `metrics.collectNode` | `METRICS_COLLECT_NODE` | `true` | 是否同时采集 Node.js 运行时指标（CPU/内存/Event Loop/GC） |
| `metrics.publicAccess` | `METRICS_PUBLIC` | `false` | 是否允许公开访问（公网部署请配合 nginx ACL 限制来源 IP） |

### 抓取示例

```bash
# 本机直接抓取
curl http://localhost:3000/metrics

# Prometheus scrape config
scrape_configs:
  - job_name: airportal
    metrics_path: /metrics
    static_configs:
      - targets: ['airportal-node:3000']
```

### 公网部署的安全建议

`/metrics` 端点默认对所有可达客户端开放，可能泄露内部信息（如 API 路径
频次、错误码分布）。建议在反向上做访问控制：

```nginx
location = /metrics {
    # 仅允许内部 Prometheus 访问
    allow 10.0.0.0/8;
    allow 172.16.0.0/12;
    deny  all;

    proxy_pass http://node_app;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    access_log off;
}
```

---

## 2. 指标分类

| 分类 | 命名空间前缀 | 主题 |
| --- | --- | --- |
| 运行时 | `airportal_node_*` | 进程 CPU、内存、GC、Event Loop、文件描述符 |
| 服务信息 | `airportal_service_*` | 启动时间、版本、运行时长 |
| HTTP | `airportal_http_*` | 请求量、时延、错误码、并发数 |
| 业务 - 取件码 | `airportal_transfers_*` | 创建/领取、上传字节、活跃数 |
| 业务 - 鉴权 | `airportal_auth_*` | 登录/注册、失败次数、账户锁定 |
| 安全 | `airportal_security_*` | 封禁、扫描结果、IP 池大小、文件校验 |
| 清理 | `airportal_cleanup_*` | 清理任务运行情况、过期处理数 |
| 存储 | `airportal_storage_*` | 占用字节、文件计数 |
| P2P | `airportal_p2p_*` | 连接、房间、信令消息 |
| 限流 | `airportal_rate_limit_*` | 各作用域限流拒绝数 |

---

## 3. 完整指标清单

### 3.1 运行时（Node.js 默认指标，prefix=`airportal_node_`）

由 `prom-client` 的 `collectDefaultMetrics()` 产生，前缀为 `airportal_node_`。

| 指标 | 类型 | 说明 |
| --- | --- | --- |
| `airportal_node_process_cpu_user_seconds_total` | Counter | 进程用户态 CPU 时间（秒） |
| `airportal_node_process_cpu_system_seconds_total` | Counter | 进程内核态 CPU 时间（秒） |
| `airportal_node_process_cpu_seconds_total` | Counter | 进程总 CPU 时间（秒） |
| `airportal_node_process_start_time_seconds` | Gauge | 进程启动 Unix 时间（秒） |
| `airportal_node_process_resident_memory_bytes` | Gauge | 常驻内存 RSS（字节） |
| `airportal_node_process_virtual_memory_bytes` | Gauge | 虚拟内存（字节） |
| `airportal_node_process_heap_bytes` | Gauge | V8 堆总大小（字节） |
| `airportal_node_process_heap_used_bytes` | Gauge | V8 已用堆（字节） |
| `airportal_node_process_external_bytes` | Gauge | 外部（C++ 绑定）占用（字节） |
| `airportal_node_process_open_fds` | Gauge | 当前打开的文件描述符数 |
| `airportal_node_process_max_fds` | Gauge | 最大允许文件描述符数 |
| `airportal_node_nodejs_eventloop_lag_seconds` | Gauge | Event Loop 滞后（秒，0.05 精度） |
| `airportal_node_nodejs_eventloop_lag_p99_seconds` | Gauge | Event Loop 滞后 P99（5 分钟窗口） |
| `airportal_node_nodejs_active_handles` | Gauge | 当前活跃句柄数 |
| `airportal_node_nodejs_active_requests` | Gauge | 当前活跃请求数 |
| `airportal_node_nodejs_heap_size_total_bytes` | Gauge | V8 堆总大小（字节） |
| `airportal_node_nodejs_heap_size_used_bytes` | Gauge | V8 堆已用（字节） |
| `airportal_node_nodejs_heap_space_size_total_bytes{space}` | Gauge | 各堆空间总大小 |
| `airportal_node_nodejs_heap_space_size_used_bytes{space}` | Gauge | 各堆空间已用 |
| `airportal_node_nodejs_heap_space_size_available_bytes{space}` | Gauge | 各堆空间可用 |
| `airportal_node_nodejs_gc_duration_seconds{kind,gc}` | Histogram | 各代 GC 耗时 |
| `airportal_node_nodejs_version_info` | Gauge | Node.js 版本（label 携带版本号，恒为 1） |

> 可通过 `METRICS_COLLECT_NODE=false` 关闭，关闭后这些指标将不再导出。

### 3.2 服务信息

| 指标 | 类型 | 标签 | 说明 |
| --- | --- | --- | --- |
| `airportal_service_info` | Gauge | `version`, `node_env`, `pid` | 静态服务元信息，值恒为 1 |
| `airportal_service_start_time_seconds` | Gauge | — | 进程启动 Unix 时间（秒） |
| `airportal_service_uptime_seconds` | Gauge | — | 进程已运行时长（秒），每 5 秒刷新一次 |

### 3.3 HTTP 流量

> 所有指标的 `route` 标签使用 **Fastify 路由模板**（如 `/api/transfers/:code`），
> 不会包含动态参数，避免因取件码造成的高基数问题。未匹配路由归一为
> `unmatched`，状态码归一为 `1xx/2xx/3xx/4xx/5xx` 的 `status_class`，
> 精确状态码仅出现在 `airportal_http_request_errors_total` 上以控制基数。

| 指标 | 类型 | 标签 | 说明 |
| --- | --- | --- | --- |
| `airportal_http_requests_total` | Counter | `method`, `route`, `status_class` | HTTP 请求总数 |
| `airportal_http_request_errors_total` | Counter | `method`, `route`, `status_code` | 状态码 ≥ 400 的响应总数 |
| `airportal_http_request_duration_seconds` | Histogram | `method`, `route`, `status_class` | 请求耗时（秒） |
| `airportal_http_requests_in_flight` | Gauge | `method` | 当前正在处理的请求数 |
| `airportal_http_response_size_bytes` | Histogram | `method`, `route`, `status_class` | 响应体大小（字节） |

**Buckets：**

- `request_duration_seconds`: `0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10`
- `response_size_bytes`: `1KiB, 10KiB, 100KiB, 1MiB, 10MiB, 50MiB, 100MiB, 500MiB`

### 3.4 取件码（transfer）业务

| 指标 | 类型 | 标签 | 说明 |
| --- | --- | --- | --- |
| `airportal_transfers_created_total` | Counter | `content_type`, `auth`, `result` | 创建计数。`content_type` ∈ {text, file, folder}；`auth` ∈ {user, anonymous}；`result` ∈ {success, rejected} |
| `airportal_transfers_claimed_total` | Counter | `content_type`, `result` | 领取计数。`result` ∈ {success, not_found, expired, max_downloads, owner_only, login_required, other} |
| `airportal_transfer_upload_bytes` | Histogram | `content_type` | 上传文件/文件夹字节分布（仅成功创建时记录） |
| `airportal_transfer_text_length_chars` | Histogram | — | 文本取件码字符长度分布 |
| `airportal_transfers_active` | Gauge | `status` | 当前活跃/已过期记录数（按状态） |
| `airportal_transfers_expired_total` | Counter | — | 清理任务处理过的过期数（已过期累计） |

**Buckets：**

- `transfer_upload_bytes`: `1KiB, 10KiB, 100KiB, 1MiB, 10MiB, 50MiB, 100MiB, 500MiB`
- `transfer_text_length_chars`: `10, 50, 100, 500, 1k, 5k, 10k`

### 3.5 鉴权

| 指标 | 类型 | 标签 | 说明 |
| --- | --- | --- | --- |
| `airportal_auth_attempts_total` | Counter | `action`, `result` | 鉴权尝试计数。`action` ∈ {register, login}；`result` ∈ {success, failure} |
| `airportal_auth_account_locks_total` | Counter | — | 账户因连续失败被锁定的次数 |

### 3.6 安全

| 指标 | 类型 | 标签 | 说明 |
| --- | --- | --- | --- |
| `airportal_security_blocked_total` | Counter | `reason` | 安全子系统触发的拦截计数。`reason` ∈ {auto, malicious, behavior, manual} |
| `airportal_security_ip_records` | Gauge | `state` | IP 黑名单池中条目数。`state` ∈ {active, blocked} |
| `airportal_security_scans_total` | Counter | `plugin`, `verdict` | 安全插件扫描计数。`plugin` ∈ {heuristic-scanner, behavior-tracker}；`verdict` ∈ {clean, suspicious, malicious} |
| `airportal_security_scan_duration_seconds` | Histogram | `plugin`, `target_type` | 扫描耗时（秒） |
| `airportal_security_plugin_errors_total` | Counter | `plugin`, `op` | 插件执行错误。`op` ∈ {scanFile, scanText, init, shutdown} |
| `airportal_file_validation_total` | Counter | `result`, `reason` | Magic number 文件校验结果。`result` ∈ {accept, reject}；`reason` ∈ {mismatch, dangerous, ok} |
| `airportal_rate_limit_rejections_total` | Counter | `scope` | 限流拒绝。`scope` ∈ {global, upload, auth, ip_management} |

**Buckets：**

- `security_scan_duration_seconds`: `0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5`

### 3.7 清理任务

| 指标 | 类型 | 标签 | 说明 |
| --- | --- | --- | --- |
| `airportal_cleanup_runs_total` | Counter | `result` | 清理任务运行次数。`result` ∈ {success, skipped, error} |
| `airportal_cleanup_duration_seconds` | Histogram | `result` | 清理任务耗时（秒） |
| `airportal_cleanup_items_total` | Counter | `type`, `result` | 处理项目。`type` ∈ {file, record}；`result` ∈ {success, failure, delete} |
| `airportal_cleanup_last_success_timestamp_seconds` | Gauge | — | 最近一次成功清理的 Unix 时间（秒） |

**Buckets：**

- `cleanup_duration_seconds`: `0.05, 0.1, 0.5, 1, 5, 10, 30, 60, 300`

### 3.8 存储

| 指标 | 类型 | 标签 | 说明 |
| --- | --- | --- | --- |
| `airportal_storage_bytes` | Gauge | `type` | 当前已用存储字节数。`type` ∈ {file, folder, text} |
| `airportal_storage_files` | Gauge | `type` | 当前文件/文件夹计数。`type` ∈ {file, folder, text} |

> 这两个指标由 `metricsRefreshService` 每 15 秒从数据库聚合刷新一次。

### 3.9 P2P

| 指标 | 类型 | 标签 | 说明 |
| --- | --- | --- | --- |
| `airportal_p2p_connections_total` | Counter | `result` | WS 连接尝试结果。`result` ∈ {accepted, rejected_blocked, rejected_origin, rejected_auth, rejected_limit, rejected_other} |
| `airportal_p2p_connections_active` | Gauge | `state` | 当前活跃连接数。`state` ∈ {total, transferring} |
| `airportal_p2p_rooms_active` | Gauge | `state` | 当前活跃房间数（state=active） |
| `airportal_p2p_signaling_messages_total` | Counter | `type`, `result` | 信令消息。`type` 为消息类型（offer/answer/ice-candidate/transfer-request/...）；`result` ∈ {forwarded, rejected, error} |
| `airportal_p2p_pending_transfers` | Gauge | `state` | 待处理的 P2P 传输请求数（state=pending） |

---

## 4. 推荐告警规则（Prometheus 样例）

```yaml
groups:
  - name: airportal.rules
    rules:
      # 进程重启（基于 service_info 标签里的 pid 变化不易检测；使用 start_time）
      - alert: AirPortalDown
        expr: up{job="airportal"} == 0
        for: 2m
        labels: { severity: critical }
        annotations:
          summary: "AirPortal instance is down"

      - alert: AirPortalHighErrorRate
        expr: |
          sum by (route) (
            rate(airportal_http_request_errors_total[5m])
          ) / sum by (route) (
            rate(airportal_http_requests_total[5m])
          ) > 0.05
        for: 5m
        labels: { severity: warning }
        annotations:
          summary: "AirPortal HTTP error rate > 5% for route {{ $labels.route }}"

      - alert: AirPortalSlowRequests
        expr: |
          histogram_quantile(0.95,
            sum by (le, route) (rate(airportal_http_request_duration_seconds_bucket[5m]))
          ) > 1
        for: 10m
        labels: { severity: warning }
        annotations:
          summary: "P95 latency > 1s for route {{ $labels.route }}"

      - alert: AirPortalHighMemory
        expr: airportal_node_process_resident_memory_bytes > 800 * 1024 * 1024
        for: 15m
        labels: { severity: warning }
        annotations:
          summary: "AirPortal RSS > 800MB"

      - alert: AirPortalEventLoopLag
        expr: airportal_node_nodejs_eventloop_lag_p99_seconds > 1
        for: 5m
        labels: { severity: warning }
        annotations:
          summary: "AirPortal event loop P99 lag > 1s"

      - alert: AirPortalStorageNearQuota
        expr: |
          sum(airportal_storage_bytes) /
          (1024 * 1024 * 1024) > 0.9
        for: 15m
        labels: { severity: warning }
        annotations:
          summary: "AirPortal storage usage > 90% of 1GiB"

      - alert: AirPortalCleanupFailing
        expr: increase(airportal_cleanup_runs_total{result="error"}[1h]) > 0
        for: 5m
        labels: { severity: warning }
        annotations:
          summary: "AirPortal cleanup job failing"

      - alert: AirPortalManyBlocked
        expr: airportal_security_ip_records{state="blocked"} > 100
        for: 5m
        labels: { severity: info }
        annotations:
          summary: "More than 100 IPs currently blocked"
```

---

## 5. 推荐 Grafana 面板

### Service overview（总览）

- `up{job="airportal"}` (Stat)
- `airportal_node_process_resident_memory_bytes / 1024 / 1024` (MB，Stat)
- `airportal_node_nodejs_eventloop_lag_p99_seconds` (Stat)
- `airportal_node_process_cpu_seconds_total` (rate，TimeSeries)
- `airportal_service_uptime_seconds / 3600` (小时，Stat)
- `airportal_http_requests_in_flight` (TimeSeries)

### HTTP traffic

- 请求量：`sum by (route) (rate(airportal_http_requests_total[1m]))` (TimeSeries)
- 错误率：`sum by (status_class) (rate(airportal_http_request_errors_total[1m]))` (Stacked)
- 耗时分布：`histogram_quantile(0.95/0.99, sum by (le, route) (rate(airportal_http_request_duration_seconds_bucket[5m])))` (TimeSeries)
- 状态码分布：`sum by (status_class) (rate(airportal_http_requests_total[1m]))` (Pie)

### Transfers

- 创建速率：`sum by (content_type) (rate(airportal_transfers_created_total{result="success"}[5m]))` (TimeSeries)
- 拒绝速率：`sum by (content_type, reason) (rate(airportal_transfers_created_total{result="rejected"}[5m]))`
- 领取结果：`sum by (result) (rate(airportal_transfers_claimed_total[5m]))` (Stacked)
- 活跃取件码：`airportal_transfers_active` (Stat)
- 上传字节 P95：`histogram_quantile(0.95, sum by (le, content_type) (rate(airportal_transfer_upload_bytes_bucket[10m])))`

### Security

- 封禁事件：`sum by (reason) (rate(airportal_security_blocked_total[5m]))`
- 扫描速率：`sum by (verdict) (rate(airportal_security_scans_total[5m]))`
- 扫描耗时：`histogram_quantile(0.95, sum by (le, plugin) (rate(airportal_security_scan_duration_seconds_bucket[5m])))`
- 当前封禁 IP 数：`airportal_security_ip_records{state="blocked"}` (Stat)

### Storage / P2P / Cleanup

- 存储占用：`airportal_storage_bytes / 1024 / 1024` (TimeSeries by type)
- 清理耗时 P95：`histogram_quantile(0.95, sum by (le) (rate(airportal_cleanup_duration_seconds_bucket[1h])))`
- 清理成功率：`rate(airportal_cleanup_runs_total{result="success"}[1h]) / rate(airportal_cleanup_runs_total[1h])`
- P2P 连接：`airportal_p2p_connections_active` (TimeSeries)
- P2P 房间：`airportal_p2p_rooms_active` (Stat)

---

## 6. 排错与验证

```bash
# 检查指标是否暴露
curl -s http://localhost:3000/metrics | head -20

# 验证格式（应包含 TYPE 与 HELP 行）
curl -s http://localhost:3000/metrics | grep '^# TYPE' | head -5

# 关闭指标（重启用）
METRICS_ENABLED=false pnpm dev
```

如需扩展指标，建议参考 `src/services/metrics.service.ts` 集中定义，
并在路由/服务中调用 `metricsService.xxx(...)`。新增指标务必避免高基数
标签（如：取件码、用户名、IP、原始 URL）。

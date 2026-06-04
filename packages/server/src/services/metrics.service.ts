import {
  Registry,
  Counter,
  Gauge,
  Histogram,
  collectDefaultMetrics,
} from 'prom-client';
import { getConfig } from '../config/index.js';
import { logger } from './logger.service.js';

const DEFAULT_DURATION_BUCKETS_SECONDS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
];

const DEFAULT_SIZE_BUCKETS_BYTES = [
  1024, 10 * 1024, 100 * 1024, 1024 * 1024,
  10 * 1024 * 1024, 50 * 1024 * 1024, 100 * 1024 * 1024, 524288000,
];

/**
 * 路由规范化 — 防止高基数
 * - 使用 Fastify 的路由模板（routeOptions.url），如 `/api/transfers/:code`
 * - 移除查询字符串
 * - 未匹配路由归一为 `unmatched`
 */
function normalizeRoute(rawUrl: string, routeUrl?: string): string {
  if (routeUrl && routeUrl.length > 0) {
    return routeUrl.startsWith('/') ? routeUrl : `/${routeUrl}`;
  }
  if (!rawUrl) return 'unmatched';
  const path = rawUrl.split('?')[0];
  if (!path || path === '/') return path || '/';
  if (
    path === '/api/transfers/config' ||
    path === '/api/health' ||
    path === '/metrics' ||
    path === '/api/auth/register' ||
    path === '/api/auth/login' ||
    path === '/api/auth/logout' ||
    path === '/api/auth/me' ||
    path === '/api/transfers/history' ||
    path === '/api/security/ip/stats' ||
    path === '/api/security/ip/blocked'
  ) {
    return path;
  }
  if (/^\/api\/transfers\/[A-Za-z0-9]+$/.test(path)) {
    return '/api/transfers/:code';
  }
  if (/^\/api\/security\/ip\/(block|unblock)$/.test(path)) {
    return `/api/security/ip/${path.split('/').pop()}`;
  }
  return 'unmatched';
}

function statusClass(code: number): string {
  if (code >= 500) return '5xx';
  if (code >= 400) return '4xx';
  if (code >= 300) return '3xx';
  if (code >= 200) return '2xx';
  return '1xx';
}

class MetricsService {
  readonly registry: Registry;
  private enabled = true;
  private collectNode = true;
  private defaultMetricsStarted = false;

  // HTTP metrics
  readonly httpRequestsTotal: Counter<'method' | 'route' | 'status_class'>;
  readonly httpRequestErrors: Counter<'method' | 'route' | 'status_code'>;
  readonly httpRequestDurationSeconds: Histogram<'method' | 'route' | 'status_class'>;
  readonly httpRequestsInFlight: Gauge<'method'>;
  readonly httpResponseSizeBytes: Histogram<'method' | 'route' | 'status_class'>;

  // Transfer / pickup code metrics
  readonly transfersCreatedTotal: Counter<'content_type' | 'auth' | 'result'>;
  readonly transfersClaimedTotal: Counter<'content_type' | 'result'>;
  readonly transferUploadBytes: Histogram<'content_type'>;
  readonly transferActiveGauge: Gauge<'status'>;
  readonly transferTextLength: Histogram<string>;
  readonly transferExpiredTotal: Counter<string>;

  // Auth metrics
  readonly authAttemptsTotal: Counter<'action' | 'result'>;
  readonly authAccountLocks: Counter<string>;

  // Security / IP blacklist metrics
  readonly securityBlockedTotal: Counter<'reason'>;
  readonly securityIpRecords: Gauge<'state'>;
  readonly securityScansTotal: Counter<'plugin' | 'verdict'>;
  readonly securityScanDurationSeconds: Histogram<'plugin' | 'target_type'>;
  readonly securityPluginErrors: Counter<'plugin' | 'op'>;

  // File validation metrics
  readonly fileValidationTotal: Counter<'result' | 'reason'>;

  // Cleanup metrics
  readonly cleanupRunsTotal: Counter<string>;
  readonly cleanupDurationSeconds: Histogram<string>;
  readonly cleanupItemsTotal: Counter<'type' | 'result'>;
  readonly cleanupLastSuccessTimestamp: Gauge<string>;

  // Storage metrics
  readonly storageBytes: Gauge<string>;
  readonly storageFiles: Gauge<string>;

  // Service health
  readonly serviceInfo: Gauge<'version' | 'node_env' | 'pid'>;
  readonly serviceStartTime: Gauge<string>;
  readonly serviceUptimeSeconds: Gauge<string>;

  // Rate limiting
  readonly rateLimitRejections: Counter<'scope'>;

  constructor() {
    this.registry = new Registry();

    this.httpRequestsTotal = new Counter({
      name: 'airportal_http_requests_total',
      help: 'Total number of HTTP requests processed, partitioned by method, route and status class.',
      labelNames: ['method', 'route', 'status_class'] as const,
      registers: [this.registry],
    });

    this.httpRequestErrors = new Counter({
      name: 'airportal_http_request_errors_total',
      help: 'Total number of HTTP responses with status >= 400, labeled with the exact status code.',
      labelNames: ['method', 'route', 'status_code'] as const,
      registers: [this.registry],
    });

    this.httpRequestDurationSeconds = new Histogram({
      name: 'airportal_http_request_duration_seconds',
      help: 'HTTP request duration in seconds, from request received to response finished.',
      labelNames: ['method', 'route', 'status_class'] as const,
      buckets: DEFAULT_DURATION_BUCKETS_SECONDS,
      registers: [this.registry],
    });

    this.httpRequestsInFlight = new Gauge({
      name: 'airportal_http_requests_in_flight',
      help: 'Current number of HTTP requests being processed.',
      labelNames: ['method'] as const,
      registers: [this.registry],
    });

    this.httpResponseSizeBytes = new Histogram({
      name: 'airportal_http_response_size_bytes',
      help: 'Size of HTTP response payloads in bytes.',
      labelNames: ['method', 'route', 'status_class'] as const,
      buckets: DEFAULT_SIZE_BUCKETS_BYTES,
      registers: [this.registry],
    });

    this.transfersCreatedTotal = new Counter({
      name: 'airportal_transfers_created_total',
      help: 'Total number of transfers created.',
      labelNames: ['content_type', 'auth', 'result'] as const,
      registers: [this.registry],
    });

    this.transfersClaimedTotal = new Counter({
      name: 'airportal_transfers_claimed_total',
      help: 'Total number of transfer download attempts by result.',
      labelNames: ['content_type', 'result'] as const,
      registers: [this.registry],
    });

    this.transferUploadBytes = new Histogram({
      name: 'airportal_transfer_upload_bytes',
      help: 'Distribution of transfer upload sizes in bytes.',
      labelNames: ['content_type'] as const,
      buckets: DEFAULT_SIZE_BUCKETS_BYTES,
      registers: [this.registry],
    });

    this.transferActiveGauge = new Gauge({
      name: 'airportal_transfers_active',
      help: 'Current number of active transfers grouped by status.',
      labelNames: ['status'] as const,
      registers: [this.registry],
    });

    this.transferTextLength = new Histogram({
      name: 'airportal_transfer_text_length_chars',
      help: 'Distribution of text transfer payload lengths in characters.',
      buckets: [10, 50, 100, 500, 1000, 5000, 10000],
      registers: [this.registry],
    });

    this.transferExpiredTotal = new Counter({
      name: 'airportal_transfers_expired_total',
      help: 'Total number of transfers that have been expired by the cleanup process.',
      registers: [this.registry],
    });

    this.authAttemptsTotal = new Counter({
      name: 'airportal_auth_attempts_total',
      help: 'Total authentication attempts (register/login) by action and result.',
      labelNames: ['action', 'result'] as const,
      registers: [this.registry],
    });

    this.authAccountLocks = new Counter({
      name: 'airportal_auth_account_locks_total',
      help: 'Total number of times an account was locked due to too many failed attempts.',
      registers: [this.registry],
    });

    this.securityBlockedTotal = new Counter({
      name: 'airportal_security_blocked_total',
      help: 'Total number of requests blocked by a security subsystem.',
      labelNames: ['reason'] as const,
      registers: [this.registry],
    });

    this.securityIpRecords = new Gauge({
      name: 'airportal_security_ip_records',
      help: 'Current number of IP records tracked by the blacklist service.',
      labelNames: ['state'] as const,
      registers: [this.registry],
    });

    this.securityScansTotal = new Counter({
      name: 'airportal_security_scans_total',
      help: 'Total number of security plugin scans by plugin name and verdict.',
      labelNames: ['plugin', 'verdict'] as const,
      registers: [this.registry],
    });

    this.securityScanDurationSeconds = new Histogram({
      name: 'airportal_security_scan_duration_seconds',
      help: 'Security plugin scan duration in seconds.',
      labelNames: ['plugin', 'target_type'] as const,
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
      registers: [this.registry],
    });

    this.securityPluginErrors = new Counter({
      name: 'airportal_security_plugin_errors_total',
      help: 'Number of errors raised by security plugins during scanning.',
      labelNames: ['plugin', 'op'] as const,
      registers: [this.registry],
    });

    this.fileValidationTotal = new Counter({
      name: 'airportal_file_validation_total',
      help: 'File validation outcomes.',
      labelNames: ['result', 'reason'] as const,
      registers: [this.registry],
    });

    this.cleanupRunsTotal = new Counter({
      name: 'airportal_cleanup_runs_total',
      help: 'Total cleanup runs grouped by outcome.',
      labelNames: ['result'] as const,
      registers: [this.registry],
    });

    this.cleanupDurationSeconds = new Histogram({
      name: 'airportal_cleanup_duration_seconds',
      help: 'Cleanup job duration in seconds.',
      labelNames: ['result'] as const,
      buckets: [0.05, 0.1, 0.5, 1, 5, 10, 30, 60, 300],
      registers: [this.registry],
    });

    this.cleanupItemsTotal = new Counter({
      name: 'airportal_cleanup_items_total',
      help: 'Items handled by cleanup grouped by type and outcome.',
      labelNames: ['type', 'result'] as const,
      registers: [this.registry],
    });

    this.cleanupLastSuccessTimestamp = new Gauge({
      name: 'airportal_cleanup_last_success_timestamp_seconds',
      help: 'Unix timestamp (seconds) of the last successful cleanup run.',
      registers: [this.registry],
    });

    this.storageBytes = new Gauge({
      name: 'airportal_storage_bytes',
      help: 'Total storage in use in bytes, grouped by type.',
      labelNames: ['type'] as const,
      registers: [this.registry],
    });

    this.storageFiles = new Gauge({
      name: 'airportal_storage_files',
      help: 'Number of stored items grouped by type.',
      labelNames: ['type'] as const,
      registers: [this.registry],
    });

    this.serviceInfo = new Gauge({
      name: 'airportal_service_info',
      help: 'Static service information; value is always 1, labels carry build info.',
      labelNames: ['version', 'node_env', 'pid'] as const,
      registers: [this.registry],
    });

    this.serviceStartTime = new Gauge({
      name: 'airportal_service_start_time_seconds',
      help: 'Unix timestamp (seconds) marking process start.',
      registers: [this.registry],
    });

    this.serviceUptimeSeconds = new Gauge({
      name: 'airportal_service_uptime_seconds',
      help: 'Seconds since the process started.',
      registers: [this.registry],
    });

    this.rateLimitRejections = new Counter({
      name: 'airportal_rate_limit_rejections_total',
      help: 'Number of requests rejected by the rate limiter, grouped by scope.',
      labelNames: ['scope'] as const,
      registers: [this.registry],
    });
  }

  init(): void {
    let metricsCfg: { enabled?: boolean; collectNode?: boolean } | null = null;
    try {
      const cfg = getConfig();
      metricsCfg = (cfg as unknown as { metrics?: { enabled?: boolean; collectNode?: boolean } })
        .metrics ?? null;
    } catch {
      metricsCfg = null;
    }

    this.enabled = metricsCfg?.enabled ?? true;
    this.collectNode = metricsCfg?.collectNode ?? true;

    if (!this.enabled) {
      logger.info('Metrics service initialized in disabled mode');
      return;
    }

    const version = this.readPackageVersion();
    const nodeEnv = process.env.NODE_ENV || 'development';
    this.serviceInfo.labels(version, nodeEnv, String(process.pid)).set(1);
    this.serviceStartTime.set(Date.now() / 1000);
    this.serviceUptimeSeconds.set(0);

    if (this.collectNode && !this.defaultMetricsStarted) {
      collectDefaultMetrics({
        register: this.registry,
        prefix: 'airportal_node_',
        eventLoopMonitoringPrecision: 50,
      });
      this.defaultMetricsStarted = true;
    }

    setInterval(() => {
      try {
        this.serviceUptimeSeconds.set(process.uptime());
      } catch {
        // ignore
      }
    }, 5000).unref();

    logger.info('Metrics service initialized', {
      enabled: this.enabled,
      collectNode: this.collectNode,
    });
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async contentType(): Promise<string> {
    return this.registry.contentType;
  }

  async render(): Promise<string> {
    return this.registry.metrics();
  }

  resetForTests(): void {
    this.registry.resetMetrics();
  }

  observeHttp(
    method: string,
    rawUrl: string,
    routeUrl: string | undefined,
    statusCode: number,
    durationSeconds: number,
    responseSize: number
  ): void {
    if (!this.enabled) return;
    const route = normalizeRoute(rawUrl, routeUrl);
    const klass = statusClass(statusCode);
    this.httpRequestsTotal.inc({ method, route, status_class: klass });
    this.httpRequestDurationSeconds.observe(
      { method, route, status_class: klass },
      durationSeconds
    );
    if (responseSize > 0) {
      this.httpResponseSizeBytes.observe(
        { method, route, status_class: klass },
        responseSize
      );
    }
    if (statusCode >= 400) {
      this.httpRequestErrors.inc({
        method,
        route,
        status_code: String(statusCode),
      });
    }
  }

  startHttp(method: string): () => void {
    if (!this.enabled) return () => {};
    this.httpRequestsInFlight.inc({ method });
    return () => this.httpRequestsInFlight.dec({ method });
  }

  recordTransferCreated(
    contentType: 'text' | 'file' | 'folder',
    isAuth: boolean,
    result: 'success' | 'rejected',
    sizeBytes?: number
  ): void {
    if (!this.enabled) return;
    this.transfersCreatedTotal.inc({
      content_type: contentType,
      auth: isAuth ? 'user' : 'anonymous',
      result,
    });
    if (result === 'success' && typeof sizeBytes === 'number' && sizeBytes > 0) {
      this.transferUploadBytes.observe({ content_type: contentType }, sizeBytes);
    }
  }

  recordTransferClaimed(
    contentType: 'text' | 'file' | 'folder',
    result: 'success' | 'not_found' | 'expired' | 'max_downloads' | 'owner_only' | 'login_required' | 'other'
  ): void {
    if (!this.enabled) return;
    this.transfersClaimedTotal.inc({ content_type: contentType, result });
  }

  recordTransferTextLength(length: number): void {
    if (!this.enabled) return;
    this.transferTextLength.observe(length);
  }

  recordAuthAttempt(action: 'register' | 'login', result: 'success' | 'failure'): void {
    if (!this.enabled) return;
    this.authAttemptsTotal.inc({ action, result });
  }

  recordAuthAccountLock(): void {
    if (!this.enabled) return;
    this.authAccountLocks.inc();
  }

  recordSecurityBlock(reason: 'auto' | 'malicious' | 'behavior' | 'manual'): void {
    if (!this.enabled) return;
    this.securityBlockedTotal.inc({ reason });
  }

  recordRateLimitRejection(scope: 'global' | 'upload' | 'auth' | 'ip_management'): void {
    if (!this.enabled) return;
    this.rateLimitRejections.inc({ scope });
  }

  recordFileValidation(
    result: 'accept' | 'reject',
    reason: 'mismatch' | 'dangerous' | 'invalid' | 'ok'
  ): void {
    if (!this.enabled) return;
    this.fileValidationTotal.inc({ result, reason });
  }

  recordSecurityScan(
    plugin: string,
    targetType: 'file' | 'text',
    verdict: 'clean' | 'suspicious' | 'malicious',
    durationSeconds: number
  ): void {
    if (!this.enabled) return;
    this.securityScansTotal.inc({ plugin, verdict });
    this.securityScanDurationSeconds.observe(
      { plugin, target_type: targetType },
      durationSeconds
    );
  }

  recordSecurityPluginError(plugin: string, op: 'scanFile' | 'scanText' | 'init' | 'shutdown'): void {
    if (!this.enabled) return;
    this.securityPluginErrors.inc({ plugin, op });
  }

  recordCleanupStart(): number {
    return Date.now();
  }

  recordCleanupFinish(
    startMs: number,
    result: 'success' | 'skipped' | 'error',
    filesDeleted = 0,
    filesFailed = 0,
    recordsUpdated = 0,
    recordsDeleted = 0
  ): void {
    if (!this.enabled) return;
    const duration = (Date.now() - startMs) / 1000;
    this.cleanupRunsTotal.inc({ result });
    this.cleanupDurationSeconds.observe({ result }, duration);
    if (filesDeleted > 0) this.cleanupItemsTotal.inc({ type: 'file', result: 'success' }, filesDeleted);
    if (filesFailed > 0) this.cleanupItemsTotal.inc({ type: 'file', result: 'failure' }, filesFailed);
    if (recordsUpdated > 0) this.cleanupItemsTotal.inc({ type: 'record', result: 'success' }, recordsUpdated);
    if (recordsDeleted > 0) this.cleanupItemsTotal.inc({ type: 'record', result: 'delete' }, recordsDeleted);
    if (result === 'success') {
      this.cleanupLastSuccessTimestamp.set(Date.now() / 1000);
    }
  }

  recordCleanupScan(_found: number, expired: number): void {
    if (!this.enabled) return;
    this.transferExpiredTotal.inc(expired);
  }

  setSecurityIpRecords(active: number, blocked: number): void {
    if (!this.enabled) return;
    this.securityIpRecords.set({ state: 'active' }, active);
    this.securityIpRecords.set({ state: 'blocked' }, blocked);
  }

  setStorageStats(bytesByType: { file: number; folder: number; text: number }, countByType: { file: number; folder: number; text: number }): void {
    if (!this.enabled) return;
    this.storageBytes.set({ type: 'file' }, bytesByType.file);
    this.storageBytes.set({ type: 'folder' }, bytesByType.folder);
    this.storageBytes.set({ type: 'text' }, bytesByType.text);
    this.storageFiles.set({ type: 'file' }, countByType.file);
    this.storageFiles.set({ type: 'folder' }, countByType.folder);
    this.storageFiles.set({ type: 'text' }, countByType.text);
  }

  setTransferStats(stats: { active: number; expired: number }): void {
    if (!this.enabled) return;
    this.transferActiveGauge.set({ status: 'active' }, stats.active);
    this.transferActiveGauge.set({ status: 'expired' }, stats.expired);
  }

  private readPackageVersion(): string {
    try {
      const pkg = (
        globalThis as unknown as { __airportal_version?: string }
      ).__airportal_version;
      if (pkg) return pkg;
    } catch {
      // ignore
    }
    return 'unknown';
  }
}

export const metricsService = new MetricsService();

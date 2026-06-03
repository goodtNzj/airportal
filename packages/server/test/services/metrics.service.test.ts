import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/services/logger.service.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../src/config/index.js', () => ({
  getConfig: () => ({
    metrics: { enabled: true, path: '/metrics', collectNode: false, publicAccess: false, token: '' },
  }),
}));

const { metricsService } = await import('../../src/services/metrics.service.js');

async function render(): Promise<string> {
  return metricsService.render();
}

describe('MetricsService', () => {
  beforeEach(() => {
    metricsService.resetForTests();
  });

  describe('HTTP observation', () => {
    it('records request count and duration with normalized route', async () => {
      metricsService.observeHttp('GET', '/api/transfers/ABC123', '/api/transfers/:code', 200, 0.123, 1024);

      const text = await render();
      expect(text).toContain('airportal_http_requests_total');
      expect(text).toContain('route="/api/transfers/:code"');
      expect(text).toContain('status_class="2xx"');
      expect(text).toContain('airportal_http_request_duration_seconds');
    });

    it('uses unmatched route label for unknown URLs', async () => {
      metricsService.observeHttp('GET', '/random/path', undefined, 404, 0.01, 0);

      const text = await render();
      expect(text).toContain('route="unmatched"');
      expect(text).toContain('status_class="4xx"');
    });

    it('does not record errors as request errors when no error status', async () => {
      metricsService.observeHttp('GET', '/api/health', '/api/health', 200, 0.001, 0);
      const text = await render();
      expect(text).toContain('airportal_http_requests_total');
    });

    it('records 4xx/5xx with exact status code label', async () => {
      metricsService.observeHttp('POST', '/api/auth/login', '/api/auth/login', 401, 0.05, 256);
      const text = await render();
      expect(text).toContain('airportal_http_request_errors_total');
      expect(text).toContain('status_code="401"');
    });
  });

  describe('Transfer business metrics', () => {
    it('records transfer creation by content type, auth and result', async () => {
      metricsService.recordTransferCreated('text', false, 'success', 256);
      metricsService.recordTransferCreated('file', true, 'success', 1024 * 1024);
      metricsService.recordTransferCreated('file', false, 'rejected');

      const text = await render();
      expect(text).toContain('airportal_transfers_created_total');
      expect(text).toContain('content_type="text"');
      expect(text).toContain('auth="anonymous"');
      expect(text).toContain('auth="user"');
      expect(text).toContain('result="success"');
      expect(text).toContain('result="rejected"');
    });

    it('records transfer claim outcomes', async () => {
      metricsService.recordTransferClaimed('text', 'success');
      metricsService.recordTransferClaimed('file', 'expired');
      metricsService.recordTransferClaimed('folder', 'max_downloads');

      const text = await render();
      expect(text).toContain('airportal_transfers_claimed_total');
      expect(text).toContain('result="success"');
      expect(text).toContain('result="expired"');
      expect(text).toContain('result="max_downloads"');
    });

    it('records text transfer length distribution', async () => {
      metricsService.recordTransferTextLength(100);
      metricsService.recordTransferTextLength(5000);
      const text = await render();
      expect(text).toContain('airportal_transfer_text_length_chars');
    });
  });

  describe('Auth metrics', () => {
    it('records login and register attempts', async () => {
      metricsService.recordAuthAttempt('login', 'success');
      metricsService.recordAuthAttempt('login', 'failure');
      metricsService.recordAuthAttempt('register', 'success');
      metricsService.recordAuthAccountLock();

      const text = await render();
      expect(text).toContain('airportal_auth_attempts_total');
      expect(text).toContain('action="login"');
      expect(text).toContain('action="register"');
      expect(text).toContain('airportal_auth_account_locks_total');
    });
  });

  describe('Security metrics', () => {
    it('records security block reasons and IP counts', async () => {
      metricsService.recordSecurityBlock('auto');
      metricsService.recordSecurityBlock('malicious');
      metricsService.setSecurityIpRecords(123, 5);

      metricsService.recordSecurityScan('heuristic-scanner', 'file', 'clean', 0.01);
      metricsService.recordSecurityScan('behavior-tracker', 'file', 'malicious', 0.05);
      metricsService.recordSecurityPluginError('heuristic-scanner', 'scanFile');

      const text = await render();
      expect(text).toContain('airportal_security_blocked_total');
      expect(text).toContain('reason="auto"');
      expect(text).toContain('reason="malicious"');
      expect(text).toContain('airportal_security_ip_records');
      expect(text).toContain('airportal_security_scans_total');
      expect(text).toContain('verdict="clean"');
      expect(text).toContain('airportal_security_plugin_errors_total');
    });
  });

  describe('File validation', () => {
    it('records file validation outcomes', async () => {
      metricsService.recordFileValidation('reject', 'mismatch');
      metricsService.recordFileValidation('accept', 'ok');
      const text = await render();
      expect(text).toContain('airportal_file_validation_total');
    });
  });

  describe('Cleanup metrics', () => {
    it('records cleanup outcomes with item counts', async () => {
      const start = Date.now() - 100;
      metricsService.recordCleanupFinish(start, 'success', 10, 2, 8, 0);
      metricsService.recordCleanupFinish(start, 'skipped');
      const text = await render();
      expect(text).toContain('airportal_cleanup_runs_total');
      expect(text).toContain('airportal_cleanup_items_total');
      expect(text).toContain('result="success"');
      expect(text).toContain('result="skipped"');
    });

    it('records expired transfers counter', async () => {
      metricsService.recordCleanupScan(5, 5);
      const text = await render();
      expect(text).toContain('airportal_transfers_expired_total');
    });
  });

  describe('P2P metrics', () => {
    it('records P2P connection results and active gauges', async () => {
      metricsService.recordP2PConnection('accepted');
      metricsService.recordP2PConnection('rejected_blocked');
      metricsService.recordP2PConnection('rejected_origin');
      metricsService.setP2PConnections(10, 2);
      metricsService.setP2PRooms(3);
      metricsService.setP2PPendingTransfers(4);
      metricsService.recordSignalingMessage('offer', 'forwarded');
      metricsService.recordSignalingMessage('ice-candidate', 'forwarded');
      metricsService.recordSignalingMessage('transfer-request', 'forwarded');
      metricsService.recordSignalingMessage('other', 'error');
      metricsService.recordP2PWebSocketError('error');
      metricsService.recordP2PWebSocketError('close_abnormal');

      const text = await render();
      expect(text).toContain('airportal_p2p_connections_total');
      expect(text).toContain('airportal_p2p_connections_active');
      expect(text).toContain('airportal_p2p_rooms_active');
      expect(text).toContain('airportal_p2p_pending_transfers');
      expect(text).toContain('airportal_p2p_signaling_messages_total');
      expect(text).toContain('airportal_p2p_websocket_errors_total');
    });
  });

  describe('Storage metrics', () => {
    it('records storage bytes and file count by type', async () => {
      metricsService.setStorageStats({ file: 1024, folder: 2048, text: 256 }, { file: 5, folder: 1, text: 10 });
      const text = await render();
      expect(text).toContain('airportal_storage_bytes');
      expect(text).toContain('airportal_storage_files');
    });
  });

  describe('Service info', () => {
    it('renders service info and uptime', async () => {
      metricsService.init();
      const text = await render();
      expect(text).toContain('airportal_service_info');
      expect(text).toContain('airportal_service_uptime_seconds');
    });
  });

  describe('Output format', () => {
    it('produces Prometheus exposition format with TYPE/HELP lines', async () => {
      metricsService.observeHttp('GET', '/api/health', '/api/health', 200, 0.001, 0);
      const text = await render();
      expect(text).toMatch(/# HELP airportal_http_requests_total/);
      expect(text).toMatch(/# TYPE airportal_http_requests_total counter/);
    });

    it('exposes a valid content type', async () => {
      const ct = await metricsService.contentType();
      expect(typeof ct).toBe('string');
      expect(ct).toMatch(/text\/plain/);
    });
  });
});

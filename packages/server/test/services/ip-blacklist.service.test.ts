import { describe, it, expect, beforeEach, vi, beforeAll } from 'vitest';

vi.mock('../../src/services/config.service.js', () => ({
  getConfig: () => ({
    security: {
      ipBlacklist: {
        enabled: true,
        autoBlockThreshold: 3,
        autoBlockWindow: 60,
        autoBlockDuration: 3600,
        maxIpRecords: 100,
        whitelist: ['127.0.0.1', '::1'],
        blacklist: ['10.0.0.1'],
      },
    },
    log: { level: 'error' },
  }),
}));

vi.mock('../../src/services/logger.service.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { ipBlacklistService } = await import('../../src/services/ip-blacklist.service.js');

describe('IPBlacklistService', () => {
  beforeAll(() => {
    ipBlacklistService.init();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isBlocked', () => {
    it('should not block whitelisted IPs', () => {
      expect(ipBlacklistService.isBlocked('127.0.0.1')).toBe(false);
      expect(ipBlacklistService.isBlocked('::1')).toBe(false);
    });

    it('should block blacklisted IPs', () => {
      expect(ipBlacklistService.isBlocked('10.0.0.1')).toBe(true);
    });

    it('should not block normal IPs by default', () => {
      expect(ipBlacklistService.isBlocked('192.168.1.1')).toBe(false);
    });
  });

  describe('isWhitelisted', () => {
    it('should identify whitelisted IPs', () => {
      expect(ipBlacklistService.isWhitelisted('127.0.0.1')).toBe(true);
    });
  });

  describe('recordFailedAttempt — window with firstFailedAt', () => {
    it('should auto-block after threshold', () => {
      const testIP = '192.168.100.50';
      ipBlacklistService.recordFailedAttempt(testIP, 'fail1');
      ipBlacklistService.recordFailedAttempt(testIP, 'fail2');
      expect(ipBlacklistService.isBlocked(testIP)).toBe(false);
      ipBlacklistService.recordFailedAttempt(testIP, 'fail3');
      expect(ipBlacklistService.isBlocked(testIP)).toBe(true);
      ipBlacklistService.unblockIP(testIP);
    });

    it('should not be reset by normal requests', () => {
      const testIP = '192.168.100.51';
      // Alternate normal requests + failures
      ipBlacklistService.recordRequest(testIP);
      ipBlacklistService.recordFailedAttempt(testIP, 'f1');
      ipBlacklistService.recordRequest(testIP);
      ipBlacklistService.recordFailedAttempt(testIP, 'f2');
      ipBlacklistService.recordRequest(testIP);
      ipBlacklistService.recordFailedAttempt(testIP, 'f3');
      // Should be blocked — normal requests don't reset the window
      expect(ipBlacklistService.isBlocked(testIP)).toBe(true);
      ipBlacklistService.unblockIP(testIP);
    });
  });

  describe('blockIP / unblockIP', () => {
    it('should block and unblock IP', () => {
      ipBlacklistService.blockIP('192.168.100.52', 'manual');
      expect(ipBlacklistService.isBlocked('192.168.100.52')).toBe(true);
      ipBlacklistService.unblockIP('192.168.100.52');
      expect(ipBlacklistService.isBlocked('192.168.100.52')).toBe(false);
    });

    it('should not block whitelisted IP', () => {
      ipBlacklistService.blockIP('127.0.0.1', 'try');
      expect(ipBlacklistService.isBlocked('127.0.0.1')).toBe(false);
    });
  });

  describe('getStats', () => {
    it('should return stats', () => {
      const stats = ipBlacklistService.getStats();
      expect(stats).toHaveProperty('totalRecords');
      expect(stats).toHaveProperty('blockedCount');
      expect(stats).toHaveProperty('topFailedIPs');
    });
  });

  describe('getBlockedIPs', () => {
    it('should return blocked IPs list', () => {
      const blocked = ipBlacklistService.getBlockedIPs();
      expect(Array.isArray(blocked)).toBe(true);
    });
  });

  describe('enforceLimit', () => {
    it('should not throw when under limit', () => {
      expect(() => ipBlacklistService.recordRequest('1.1.1.1')).not.toThrow();
    });
  });
});

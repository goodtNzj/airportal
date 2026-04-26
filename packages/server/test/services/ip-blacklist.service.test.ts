import { describe, it, expect, beforeEach, vi, beforeAll } from 'vitest';

// 模拟 config
vi.mock('../../src/services/config.service.js', () => ({
  getConfig: () => ({
    security: {
      ipBlacklist: {
        enabled: true,
        autoBlockThreshold: 3,
        autoBlockWindow: 60,
        autoBlockDuration: 3600,
        whitelist: ['127.0.0.1', '::1'],
        blacklist: ['10.0.0.1'],
      },
    },
    log: { level: 'error' },
  }),
}));

// 模拟 logger
vi.mock('../../src/services/logger.service.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// 在模拟后导入
const { ipBlacklistService } = await import('../../src/services/ip-blacklist.service.js');

describe('IPBlacklistService', () => {
  beforeAll(() => {
    ipBlacklistService.init();
  });

  beforeEach(() => {
    // 每个测试前重置状态
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
      expect(ipBlacklistService.isWhitelisted('::1')).toBe(true);
    });

    it('should not identify normal IPs as whitelisted', () => {
      expect(ipBlacklistService.isWhitelisted('192.168.1.1')).toBe(false);
    });
  });

  describe('recordFailedAttempt', () => {
    it('should not record attempts for whitelisted IPs', () => {
      ipBlacklistService.recordFailedAttempt('127.0.0.1', 'test');
      expect(ipBlacklistService.isBlocked('127.0.0.1')).toBe(false);
    });

    it('should auto-block after threshold', () => {
      const testIP = '192.168.100.50';

      // 记录 2 次失败
      ipBlacklistService.recordFailedAttempt(testIP, 'fail1');
      ipBlacklistService.recordFailedAttempt(testIP, 'fail2');
      expect(ipBlacklistService.isBlocked(testIP)).toBe(false);

      // 第 3 次应该触发自动封禁
      ipBlacklistService.recordFailedAttempt(testIP, 'fail3');
      expect(ipBlacklistService.isBlocked(testIP)).toBe(true);

      // 清理
      ipBlacklistService.unblockIP(testIP);
    });
  });

  describe('blockIP / unblockIP', () => {
    it('should block and unblock IP', () => {
      const testIP = '192.168.100.51';

      ipBlacklistService.blockIP(testIP, 'manual block');
      expect(ipBlacklistService.isBlocked(testIP)).toBe(true);

      ipBlacklistService.unblockIP(testIP);
      expect(ipBlacklistService.isBlocked(testIP)).toBe(false);
    });

    it('should not block whitelisted IP', () => {
      ipBlacklistService.blockIP('127.0.0.1', 'try to block localhost');
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
});

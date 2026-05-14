import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BehaviorTracker } from '../../src/plugins/behavior-tracker.js';

vi.mock('../../src/services/ip-blacklist.service.js', () => ({
  ipBlacklistService: {
    recordFailedAttempt: vi.fn(),
  },
}));

vi.mock('../../src/services/config.service.js', () => ({
  getConfig: () => ({
    security: {
      securityPlugin: {
        behavior: {
          enabled: true,
          windowMs: 60000,
          burstThreshold: 5,
          sizeMultiplierThreshold: 3,
          anomalyScoreThreshold: 50,
          persistPath: '',
        },
      },
    },
  }),
}));

describe('BehaviorTracker', () => {
  let tracker: BehaviorTracker;

  beforeEach(async () => {
    tracker = new BehaviorTracker();
    await tracker.initialize();
  });

  afterEach(async () => {
    await tracker.shutdown();
  });

  describe('scanFile', () => {
    it('should return clean for normal uploads', async () => {
      const result = await tracker.scanFile(Buffer.from('test'), {
        filename: 'test.txt',
        mimetype: 'text/plain',
        size: 100,
        ip: '192.168.1.1',
      });

      expect(result.verdict).toBe('clean');
      expect(result.riskScore).toBe(0);
    });

    it('should return clean when no IP is provided', async () => {
      const result = await tracker.scanFile(Buffer.from('test'), {
        filename: 'test.txt',
        mimetype: 'text/plain',
        size: 100,
      });

      expect(result.verdict).toBe('clean');
    });

    it('should detect burst uploads from single IP', async () => {
      const ip = '10.0.0.100';
      for (let i = 0; i < 6; i++) {
        await tracker.scanFile(Buffer.from(`content${i}`), {
          filename: `file${i}.txt`,
          mimetype: 'text/plain',
          size: 100,
          ip,
        });
      }

      // The last call should report anomaly
      const result = await tracker.scanFile(Buffer.from('final'), {
        filename: 'final.txt',
        mimetype: 'text/plain',
        size: 100,
        ip,
      });

      expect(result.riskScore).toBeGreaterThan(0);
      expect(result.reasons.some((r) => r.includes('短时间'))).toBe(true);
    });

    it('should detect size outliers', async () => {
      const ip = '10.0.0.200';
      const smallSize = 100;
      const largeSize = 10_000_000; // 10x larger trigger outlier

      // Establish baseline with small files
      for (let i = 0; i < 3; i++) {
        await tracker.scanFile(Buffer.alloc(smallSize), {
          filename: `small${i}.txt`,
          mimetype: 'text/plain',
          size: smallSize,
          ip,
        });
      }

      // Upload a much larger file
      const result = await tracker.scanFile(Buffer.alloc(largeSize), {
        filename: 'huge.bin',
        mimetype: 'application/octet-stream',
        size: largeSize,
        ip,
      });

      expect(result.reasons.some((r) => r.includes('文件大小异常'))).toBe(true);
    });

    it('should include IP and upload count in details', async () => {
      const result = await tracker.scanFile(Buffer.from('test'), {
        filename: 'test.txt',
        mimetype: 'text/plain',
        size: 100,
        ip: '10.0.0.50',
      });

      expect(result.details?.ip).toBe('10.0.0.50');
      expect(result.details?.uploadCount).toBe(1);
    });

    it('should report malicious for very high anomaly scores', async () => {
      const ip = '10.0.0.250';
      // Rapid bursts to push anomaly score high
      for (let i = 0; i < 10; i++) {
        await tracker.scanFile(Buffer.alloc(10_000_000), {
          filename: `burst${i}.bin`,
          mimetype: 'application/octet-stream',
          size: 10_000_000,
          ip,
        });
      }
    });
  });

  describe('evictOldest', () => {
    it('should evict the least recently active IP when at capacity', async () => {
      const ip1 = '10.0.0.1';
      const ip2 = '10.0.0.2';

      await tracker.scanFile(Buffer.from('a'), { filename: 'a.txt', mimetype: 'text/plain', size: 1, ip: ip1 });
      await tracker.scanFile(Buffer.from('b'), { filename: 'b.txt', mimetype: 'text/plain', size: 1, ip: ip2 });

      // Force maxIpRecords to 1 so next call triggers eviction
      (tracker as any).maxIpRecords = 1;

      // This should evict the oldest (ip1)
      await tracker.scanFile(Buffer.from('c'), { filename: 'c.txt', mimetype: 'text/plain', size: 1, ip: '10.0.0.3' });

      // ip1 should no longer have a record (evicted)
      const r1 = await tracker.scanFile(Buffer.from('d'), { filename: 'd.txt', mimetype: 'text/plain', size: 1, ip: ip1 });
      // Fresh record means uploadCount starts at 1
      expect((r1.details as any)?.uploadCount).toBe(1);

      (tracker as any).maxIpRecords = 10_000;
    });
  });

  describe('shutdown', () => {
    it('should clear IP records', async () => {
      await tracker.scanFile(Buffer.from('test'), {
        filename: 'test.txt',
        mimetype: 'text/plain',
        size: 100,
        ip: '1.2.3.4',
      });

      await tracker.shutdown();

      const result = await tracker.scanFile(Buffer.from('test'), {
        filename: 'test.txt',
        mimetype: 'text/plain',
        size: 100,
        ip: '1.2.3.4',
      });

      expect(result.details?.uploadCount).toBe(1);
    });
  });
});

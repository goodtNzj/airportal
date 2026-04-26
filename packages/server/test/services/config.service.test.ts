import { describe, it, expect, beforeAll } from 'vitest';
import { initConfig, getConfig } from '../../src/services/config.service.js';

describe('ConfigService', () => {
  beforeAll(async () => {
    await initConfig();
  });

  describe('getConfig', () => {
    it('should return config object', () => {
      const config = getConfig();
      expect(config).toBeDefined();
      expect(config.server).toBeDefined();
      expect(config.security).toBeDefined();
    });

    it('should have server config', () => {
      const config = getConfig();
      expect(config.server.port).toBeTypeOf('number');
      expect(config.server.host).toBeTypeOf('string');
    });

    it('should have security config', () => {
      const config = getConfig();
      expect(config.security.fileValidation).toBeDefined();
      expect(config.security.ipBlacklist).toBeDefined();
      expect(config.security.auditLog).toBeDefined();
      expect(config.security.rateLimit).toBeDefined();
    });

    it('should have transfer config', () => {
      const config = getConfig();
      expect(config.transfer.codeLength).toBe(6);
      expect(config.transfer.defaultExpiry).toBe(180);
      expect(config.transfer.maxExpiry).toBe(3600);
    });

    it('should have cleanup config', () => {
      const config = getConfig();
      expect(config.cleanup.interval).toBe(60);
      expect(config.cleanup.cleanFiles).toBe(true);
      expect(config.cleanup.cleanRecords).toBe(true);
    });

    it('should have log config', () => {
      const config = getConfig();
      expect(config.log.level).toBeTypeOf('string');
    });
  });

  describe('security config', () => {
    it('should have file validation settings', () => {
      const config = getConfig();
      expect(config.security.fileValidation.enabled).toBe(true);
    });

    it('should have IP blacklist settings', () => {
      const config = getConfig();
      expect(config.security.ipBlacklist.enabled).toBe(true);
      expect(config.security.ipBlacklist.autoBlockThreshold).toBe(10);
      expect(Array.isArray(config.security.ipBlacklist.whitelist)).toBe(true);
    });

    it('should have rate limit settings', () => {
      const config = getConfig();
      expect(config.security.rateLimit.globalMax).toBe(100);
      expect(config.security.rateLimit.uploadMax).toBe(10);
    });
  });
});

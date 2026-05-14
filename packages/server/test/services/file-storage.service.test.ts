import { describe, it, expect, beforeAll, vi } from 'vitest';
import path from 'path';

const mockUploadDir = '/tmp/test-uploads';

vi.mock('../../src/services/config.service.js', () => ({
  getConfig: () => ({
    security: {
      upload: { dir: mockUploadDir },
    },
  }),
}));

vi.mock('../../src/services/prisma.service.js', () => ({
  prisma: {
    transfer: {
      findMany: vi.fn().mockResolvedValue([]),
      aggregate: vi.fn().mockResolvedValue({ _sum: { fileSize: 0 } }),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  },
}));

vi.mock('../../src/services/logger.service.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { FileStorageService } from '../../src/services/file-storage.service.js';
import { AppError, ErrorCodes } from '../../src/services/errors.service.js';

describe('FileStorageService', () => {
  let storage: FileStorageService;

  beforeAll(async () => {
    storage = new FileStorageService();
    // Manually set uploadDir to bypass ensureUploadDir
    (storage as any).uploadDir = mockUploadDir;
  });

  describe('assertPathSafe', () => {
    it('should accept paths within upload dir', () => {
      const safe = path.join(mockUploadDir, 'file.txt');
      expect(() => (storage as any).assertPathSafe(safe)).not.toThrow();
    });

    it('should reject paths outside upload dir', () => {
      const unsafe = '/etc/passwd';
      expect(() => (storage as any).assertPathSafe(unsafe)).toThrow(AppError);
    });

    it('should reject path traversal with ..', () => {
      const traversed = path.join(mockUploadDir, '..', '..', 'etc', 'passwd');
      expect(() => (storage as any).assertPathSafe(traversed)).toThrow(AppError);
    });

    it('should reject absolute paths outside upload dir', () => {
      expect(() => (storage as any).assertPathSafe('/bin/sh')).toThrow(AppError);
    });

    it('should accept nested paths within upload dir', () => {
      const nested = path.join(mockUploadDir, 'sub', 'dir', 'file.txt');
      expect(() => (storage as any).assertPathSafe(nested)).not.toThrow();
    });
  });

  describe('generateSafeFileName', () => {
    it('should strip directory components', () => {
      const name = storage.generateSafeFileName('../etc/passwd');
      expect(name).not.toContain('..');
      expect(name).not.toContain('/');
    });

    it('should remove null bytes', () => {
      const name = storage.generateSafeFileName('file\x00.txt');
      expect(name).not.toContain('\x00');
    });

    it('should handle empty filename', () => {
      const name = storage.generateSafeFileName('');
      expect(name).toContain('unnamed_file');
    });

    it('should produce unique names', () => {
      const a = storage.generateSafeFileName('test.txt');
      const b = storage.generateSafeFileName('test.txt');
      expect(a).not.toBe(b);
    });
  });
});

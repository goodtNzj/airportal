import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn().mockResolvedValue('$2b$10$hashed'),
    compare: vi.fn(),
  },
  hash: vi.fn().mockResolvedValue('$2b$10$hashed'),
  compare: vi.fn(),
}));

vi.mock('../../src/services/prisma.service.js', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock('../../src/services/config.service.js', () => ({
  getConfig: () => ({
    jwt: { secret: 'test-secret', expiresIn: '7d' },
    security: {
      rateLimit: {
        authLockThreshold: 3,
        authLockWindowMs: 60000,
        authLockDurationMs: 60000,
      },
    },
  }),
}));

vi.mock('../../src/services/logger.service.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import bcrypt from 'bcryptjs';
import { AuthService } from '../../src/services/auth.service.js';
import { AppError, ErrorCodes } from '../../src/services/errors.service.js';

describe('AuthService — account lockout', () => {
  let auth: AuthService;

  beforeEach(() => {
    auth = new AuthService();
    vi.clearAllMocks();
    (bcrypt.compare as ReturnType<typeof vi.fn>).mockResolvedValue(false as never);
  });

  describe('login', () => {
    it('should lock account after threshold failures', async () => {
      const { prisma } = await import('../../src/services/prisma.service.js');
      (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 1, username: 'test', passwordHash: 'hash',
      });

      for (let i = 0; i < 3; i++) {
        await expect(auth.login('test', 'wrong')).rejects.toThrow(AppError);
      }

      await expect(auth.login('test', 'wrong')).rejects.toMatchObject({
        code: ErrorCodes.ACCOUNT_LOCKED,
      });
    });

    it('should reset lockout on successful login', async () => {
      const { prisma } = await import('../../src/services/prisma.service.js');
      (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 1, username: 'test', passwordHash: 'hash',
      });

      for (let i = 0; i < 2; i++) {
        await expect(auth.login('test', 'wrong')).rejects.toThrow(AppError);
      }

      (bcrypt.compare as ReturnType<typeof vi.fn>).mockResolvedValue(true as never);

      const result = await auth.login('test', 'correct');
      expect(result).toBeDefined();

      (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 1, username: 'test', passwordHash: 'hash',
      });
      (bcrypt.compare as ReturnType<typeof vi.fn>).mockResolvedValue(false as never);

      const err = await auth.login('test', 'wrong').catch(e => e);
      expect(err.code).not.toBe(ErrorCodes.ACCOUNT_LOCKED);
    });
  });

  describe('register', () => {
    it('should not lock account for registration', async () => {
      const { prisma } = await import('../../src/services/prisma.service.js');
      (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (prisma.user.create as ReturnType<typeof vi.fn>).mockRejectedValue({
        code: 'P2002',
      });

      await expect(auth.register('existing', 'pass123456')).rejects.toMatchObject({
        code: ErrorCodes.USER_EXISTS,
      });
    });
  });
});

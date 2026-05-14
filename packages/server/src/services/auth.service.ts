import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from './prisma.service.js';
import { getConfig } from '../config/index.js';
import { logger } from './logger.service.js';
import { AppError, ErrorCodes } from './errors.service.js';
import type { UserPayload } from '../types/index.js';

interface LockRecord {
  count: number;
  firstAttempt: number;
  lockedUntil: number;
}

export class AuthService {
  private lockMap = new Map<string, LockRecord>();

  private checkLock(username: string): void {
    const config = getConfig();
    const record = this.lockMap.get(username);
    if (!record) return;

    const now = Date.now();

    if (now < record.lockedUntil) {
      const remaining = Math.ceil((record.lockedUntil - now) / 1000);
      throw new AppError(ErrorCodes.ACCOUNT_LOCKED, `账户已被临时锁定，请 ${remaining} 秒后再试`, 429);
    }

    if (now - record.firstAttempt > config.security.rateLimit.authLockWindowMs) {
      // window expired, reset
      this.lockMap.delete(username);
    }
  }

  private recordFailure(username: string): void {
    const config = getConfig();
    const now = Date.now();
    const record = this.lockMap.get(username);

    if (!record || now - record.firstAttempt > config.security.rateLimit.authLockWindowMs) {
      this.lockMap.set(username, { count: 1, firstAttempt: now, lockedUntil: 0 });
      return;
    }

    record.count++;
    if (record.count >= config.security.rateLimit.authLockThreshold) {
      record.lockedUntil = now + config.security.rateLimit.authLockDurationMs;
      logger.warn('Account locked due to too many failures', { username, attempts: record.count });
      this.cleanupStaleLocks();
    }
  }

  private recordSuccess(username: string): void {
    this.lockMap.delete(username);
  }

  private cleanupStaleLocks(): void {
    const config = getConfig();
    const cutoff = Date.now() - config.security.rateLimit.authLockWindowMs;
    for (const [username, record] of this.lockMap) {
      if (record.firstAttempt < cutoff && Date.now() > record.lockedUntil) {
        this.lockMap.delete(username);
      }
    }
    if (this.lockMap.size > 10_000) {
      // Evict oldest entries instead of clearing all (prevents DoS unlock)
      const entries = Array.from(this.lockMap.entries())
        .sort((a, b) => a[1].firstAttempt - b[1].firstAttempt);
      const toRemove = entries.slice(0, this.lockMap.size - 8_000);
      for (const [username] of toRemove) {
        this.lockMap.delete(username);
      }
    }
  }

  async register(username: string, password: string) {
    let user;
    try {
      user = await prisma.user.create({
        data: { username, passwordHash: await bcrypt.hash(password, 10) },
      });
    } catch (error: unknown) {
      if ((error as Record<string, unknown>)?.code === 'P2002') {
        // Do NOT call recordFailure — registration should not trigger account lockout
        // (prevents attacker from locking out legitimate users via repeated registration)
        logger.warn('Registration failed: username exists', { username });
        throw new AppError(ErrorCodes.USER_EXISTS, '用户名已存在');
      }
      throw error;
    }

    this.recordSuccess(username);
    logger.info('User registered', { username, userId: user.id });
    return this.generateToken(user.id, user.username);
  }

  async login(username: string, password: string) {
    this.checkLock(username);

    const user = await prisma.user.findUnique({
      where: { username },
    });

    if (!user) {
      this.recordFailure(username);
      logger.warn('Login failed: user not found', { username });
      throw new AppError(ErrorCodes.INVALID_CREDENTIALS, '用户名或密码错误', 401);
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);

    if (!isValid) {
      this.recordFailure(username);
      logger.warn('Login failed: invalid password', { username });
      throw new AppError(ErrorCodes.INVALID_CREDENTIALS, '用户名或密码错误', 401);
    }

    this.recordSuccess(username);
    logger.info('User logged in', { username, userId: user.id });
    return this.generateToken(user.id, user.username);
  }

  async getUserById(userId: number) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, createdAt: true },
    });

    if (!user) {
      throw new AppError(ErrorCodes.USER_NOT_FOUND, '用户不存在', 404);
    }

    return user;
  }

  private generateToken(userId: number, username: string): { token: string; user: UserPayload } {
    const config = getConfig();
    const token = jwt.sign({ userId, username }, config.jwt.secret, { expiresIn: config.jwt.expiresIn as jwt.SignOptions['expiresIn'] });

    return {
      token,
      user: { userId, username },
    };
  }

  verifyToken(token: string): UserPayload {
    const config = getConfig();
    return jwt.verify(token, config.jwt.secret) as UserPayload;
  }
}

export const authService = new AuthService();

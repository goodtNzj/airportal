import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from './prisma.service.js';
import { getConfig } from '../config/index.js';
import { logger } from './logger.service.js';
import type { UserPayload } from '../types/index.js';

export class AuthService {
  async register(username: string, password: string) {
    const existing = await prisma.user.findUnique({
      where: { username },
    });

    if (existing) {
      logger.warn('Registration failed: username exists', { username });
      throw new Error('用户名已存在');
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        username,
        passwordHash,
      },
    });

    logger.info('User registered', { username, userId: user.id });

    return this.generateToken(user.id, user.username);
  }

  async login(username: string, password: string) {
    const user = await prisma.user.findUnique({
      where: { username },
    });

    if (!user) {
      logger.warn('Login failed: user not found', { username });
      throw new Error('用户名或密码错误');
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);

    if (!isValid) {
      logger.warn('Login failed: invalid password', { username });
      throw new Error('用户名或密码错误');
    }

    logger.info('User logged in', { username, userId: user.id });

    return this.generateToken(user.id, user.username);
  }

  async getUserById(userId: number) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, createdAt: true },
    });

    if (!user) {
      throw new Error('用户不存在');
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

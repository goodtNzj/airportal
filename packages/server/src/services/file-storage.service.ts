import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import { createWriteStream } from 'fs';
import { prisma } from './prisma.service.js';
import { getConfig } from '../config/index.js';
import { logger } from './logger.service.js';
import { AppError, ErrorCodes } from './errors.service.js';

export class FileStorageService {
  private uploadDir: string | null = null;
  private cleanupPromise: Promise<number> | null = null;

  async ensureUploadDir(): Promise<string> {
    const config = getConfig();
    this.uploadDir = path.resolve(config.security.upload.dir);
    await fs.mkdir(this.uploadDir, { recursive: true });

    const dataDir = path.dirname(config.database.url.replace('file:', ''));
    if (dataDir && dataDir !== '.') {
      await fs.mkdir(dataDir, { recursive: true });
    }

    return this.uploadDir;
  }

  getUploadDir(): string {
    if (!this.uploadDir) {
      throw new Error('FileStorage not initialized');
    }
    return this.uploadDir;
  }

  async checkDiskQuota(newFileSize: number): Promise<void> {
    const config = getConfig();
    const maxTotalStorage = config.security.upload.maxTotalStorage;
    if (!maxTotalStorage) return;

    const check = async (): Promise<boolean> => {
      const result = await prisma.transfer.aggregate({
        _sum: { fileSize: true },
        where: {
          status: 'active',
          contentType: { in: ['file', 'folder'] },
        },
      });
      const currentTotal = result._sum.fileSize || 0;
      return currentTotal + newFileSize <= maxTotalStorage;
    };

    try {
      if (await check()) return;

      const freed = await this.autoCleanupExpired();
      if (freed > 0) {
        logger.info('Disk quota degradation: cleaned expired files', { freedBytes: freed });
      }

      if (await check()) return;

      const result = await prisma.transfer.aggregate({
        _sum: { fileSize: true },
        where: { status: 'active', contentType: { in: ['file', 'folder'] } },
      });
      const usedMB = ((result._sum.fileSize || 0) / 1024 / 1024).toFixed(0);
      const limitMB = (maxTotalStorage / 1024 / 1024).toFixed(0);
      throw new AppError(ErrorCodes.STORAGE_EXCEEDED, `存储空间不足（已用 ${usedMB}MB / ${limitMB}MB），请稍后重试`);
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.warn('Disk quota check failed, allowing upload to proceed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async autoCleanupExpired(): Promise<number> {
    if (this.cleanupPromise) return this.cleanupPromise;

    this.cleanupPromise = this.executeCleanup().finally(() => {
      this.cleanupPromise = null;
    });
    return this.cleanupPromise;
  }

  private async executeCleanup(): Promise<number> {
    const expired = await prisma.transfer.findMany({
      where: {
        expiresAt: { lt: new Date() },
        status: 'active',
        filePath: { not: null },
      },
    });

    if (expired.length === 0) return 0;

    let freed = 0;
    const fileOps: Promise<void>[] = [];

    for (const t of expired) {
      fileOps.push(this.deleteFile(t.filePath));
      freed += t.fileSize || 0;
    }

    await Promise.all(fileOps);

    const result = await prisma.transfer.updateMany({
      where: {
        id: { in: expired.map(t => t.id) },
        status: 'active',
      },
      data: { status: 'expired' },
    });

    if (result.count !== expired.length) {
      logger.warn('Auto-cleanup: some records were already expired', {
        expected: expired.length,
        updated: result.count,
      });
    }

    if (result.count > 0) {
      logger.info('Auto-cleanup completed', {
        count: result.count,
        freedBytes: freed,
      });
    }

    return freed;
  }

  private assertPathSafe(filePath: string): string {
    const dir = this.getUploadDir();
    const resolved = path.resolve(filePath);
    const resolvedDir = path.resolve(dir) + path.sep;
    if (resolved !== path.resolve(dir) && !resolved.startsWith(resolvedDir)) {
      logger.error('Path traversal attempt blocked', { requested: filePath, resolved });
      throw new AppError(ErrorCodes.PATH_TRAVERSAL, '文件路径验证失败');
    }
    return resolved;
  }

  async writeFile(pickupCode: string, buffer: Buffer, originalFilename: string): Promise<string> {
    const dir = this.getUploadDir();
    const safeName = this.generateSafeFileName(originalFilename);
    const filePath = path.join(dir, `${pickupCode}_${safeName}`);

    const resolvedPath = this.assertPathSafe(filePath);

    const stream = createWriteStream(resolvedPath);
    await new Promise<void>((resolve, reject) => {
      stream.on('finish', resolve);
      stream.on('error', reject);
      const CHUNK = 1024 * 1024;
      for (let offset = 0; offset < buffer.length; offset += CHUNK) {
        stream.write(buffer.subarray(offset, Math.min(offset + CHUNK, buffer.length)));
      }
      stream.end();
    });

    return filePath;
  }

  async readFile(filePath: string): Promise<Buffer> {
    return fs.readFile(this.assertPathSafe(filePath));
  }

  async deleteFile(filePath?: string | null): Promise<void> {
    if (!filePath) return;
    await fs.unlink(this.assertPathSafe(filePath)).catch(() => {});
  }

  generateSafeFileName(originalName: string): string {
    let safeName = path.basename(originalName);
    safeName = safeName.replace(/[\x00-\x1f\x7f\x80-\x9f]/g, '');
    safeName = safeName.replace(/[/\\]/g, '_');
    safeName = safeName.replace(/^\.+/, '');
    const maxLen = 200;
    if (safeName.length > maxLen) {
      const ext = path.extname(safeName);
      safeName = safeName.slice(0, maxLen - ext.length) + ext;
    }
    if (!safeName) {
      safeName = 'unnamed_file';
    }
    const randomPrefix = crypto.randomBytes(4).toString('hex');
    return `${randomPrefix}_${safeName}`;
  }
}

export const fileStorageService = new FileStorageService();

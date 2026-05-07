import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import { prisma } from './prisma.service.js';
import { CodeService } from './code.service.js';
import { getConfig } from '../config/index.js';
import { logger } from './logger.service.js';
import type { TransferResult, FolderMetadata } from '../types/index.js';

export class TransferService {
  private uploadDir: string | null = null;

  async init() {
    const config = getConfig();
    this.uploadDir = path.resolve('./uploads');

    // 确保上传目录存在
    await fs.mkdir(this.uploadDir, { recursive: true });

    // 确保数据目录存在
    const dataDir = path.dirname(config.database.url.replace('file:', ''));
    if (dataDir && dataDir !== '.') {
      await fs.mkdir(dataDir, { recursive: true });
    }

    logger.info('Transfer service initialized', { uploadDir: this.uploadDir });
  }

  async createTextTransfer(
    textContent: string,
    expiresIn: number,
    userId?: number,
    maxDownloads: number = 1,
    ownerOnly: boolean = false
  ): Promise<TransferResult> {
    const config = getConfig();

    // 验证文本长度
    if (textContent.length > config.security.upload.maxTextLength) {
      throw new Error(`文本长度超过限制（最大 ${config.security.upload.maxTextLength} 字符）`);
    }

    // ownerOnly 需要登录
    if (ownerOnly && !userId) {
      throw new Error('仅限创建者领取功能需要登录');
    }

    // 限制有效期
    const actualExpiry = Math.min(expiresIn, config.transfer.maxExpiry);
    const expiresAt = new Date(Date.now() + actualExpiry * 1000);

    const pickupCode = await this.generateUniqueCode();

    await prisma.transfer.create({
      data: {
        pickupCode,
        contentType: 'text',
        textContent,
        expiresAt,
        userId: userId || null,
        maxDownloads: maxDownloads === 0 ? -1 : maxDownloads,
        ownerOnly,
      },
    });

    logger.info('Text transfer created', {
      pickupCode,
      length: textContent.length,
      expiresIn: actualExpiry,
      userId: userId || 'anonymous',
    });

    return { pickupCode, expiresAt, expiresIn: actualExpiry };
  }

  async createFileTransfer(
    file: {
      filename: string;
      mimetype: string;
      data: Buffer;
    },
    expiresIn: number,
    userId?: number,
    folderMetadata?: FolderMetadata,
    maxDownloads: number = 1,
    ownerOnly: boolean = false
  ): Promise<TransferResult> {
    const config = getConfig();

    // 验证文件大小
    if (file.data.length > config.security.upload.maxFileSize) {
      throw new Error(`文件大小超过限制（最大 ${config.security.upload.maxFileSize / 1024 / 1024}MB）`);
    }

    // 磁盘配额检查
    await this.checkDiskQuota(file.data.length);

    // 检查文件扩展名
    const ext = path.extname(file.filename).toLowerCase();
    if (config.security.upload.blockedExtensions.includes(ext)) {
      throw new Error('不支持的文件类型');
    }

    // ownerOnly 需要登录
    if (ownerOnly && !userId) {
      throw new Error('仅限创建者领取功能需要登录');
    }

    const pickupCode = await this.generateUniqueCode();
    const safeFileName = this.generateSafeFileName(file.filename);
    const filePath = path.join(this.uploadDir!, `${pickupCode}_${safeFileName}`);

    // 路径遍历最终检查
    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(path.resolve(this.uploadDir!))) {
      logger.error('Path traversal attempt blocked', { requested: filePath, resolved: resolvedPath });
      throw new Error('文件路径验证失败');
    }

    // 保存文件
    await fs.writeFile(filePath, file.data);

    // 限制有效期
    const actualExpiry = Math.min(expiresIn, config.transfer.maxExpiry);
    const expiresAt = new Date(Date.now() + actualExpiry * 1000);

    const isFolder = !!folderMetadata;

    await prisma.transfer.create({
      data: {
        pickupCode,
        contentType: isFolder ? 'folder' : 'file',
        fileName: isFolder ? folderMetadata.folderName : file.filename,
        fileSize: file.data.length,
        filePath,
        fileMimeType: file.mimetype,
        fileCount: folderMetadata?.fileCount ?? null,
        folderName: folderMetadata?.folderName ?? null,
        expiresAt,
        userId: userId || null,
        maxDownloads: maxDownloads === 0 ? -1 : maxDownloads,
        ownerOnly,
      },
    });

    logger.info(`${isFolder ? 'Folder' : 'File'} transfer created`, {
      pickupCode,
      fileName: file.filename,
      fileSize: file.data.length,
      fileCount: folderMetadata?.fileCount,
      expiresIn: actualExpiry,
      userId: userId || 'anonymous',
    });

    return {
      pickupCode,
      expiresAt,
      expiresIn: actualExpiry,
      fileCount: folderMetadata?.fileCount,
      folderName: folderMetadata?.folderName,
    };
  }

  /**
   * Check total storage quota before accepting a new upload.
   */
  private async checkDiskQuota(newFileSize: number): Promise<void> {
    const config = getConfig();
    const maxTotalStorage = config.security.upload.maxTotalStorage;
    if (!maxTotalStorage) return;

    try {
      const result = await prisma.transfer.aggregate({
        _sum: { fileSize: true },
        where: {
          status: 'active',
          contentType: { in: ['file', 'folder'] },
        },
      });

      const currentTotal = result._sum.fileSize || 0;
      if (currentTotal + newFileSize > maxTotalStorage) {
        const usedMB = (currentTotal / 1024 / 1024).toFixed(0);
        const limitMB = (maxTotalStorage / 1024 / 1024).toFixed(0);
        throw new Error(`存储空间不足（已用 ${usedMB}MB / ${limitMB}MB），请稍后重试`);
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('存储空间不足')) {
        throw error;
      }
      logger.warn('Disk quota check failed, allowing upload to proceed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async getTransfer(pickupCode: string, requestUserId?: number) {
    const transfer = await prisma.transfer.findUnique({
      where: { pickupCode },
      include: { user: { select: { username: true } } },
    });

    if (!transfer) {
      logger.warn('Transfer not found', { pickupCode });
      throw new Error('取件码不存在');
    }

    if (new Date() > transfer.expiresAt) {
      logger.info('Transfer expired on access', { pickupCode });
      this.deleteTransfer(transfer.id, transfer.filePath).catch((err) => {
        logger.error('Failed to cleanup expired transfer', {
          pickupCode,
          error: err instanceof Error ? err.message : String(err),
        });
      });
      throw new Error('取件码已过期');
    }

    // 检查 ownerOnly 权限
    if (transfer.ownerOnly) {
      if (!requestUserId) {
        throw new Error('此内容需要登录后领取');
      }
      if (requestUserId !== transfer.userId) {
        throw new Error('此内容仅限创建者领取');
      }
    }

    // maxDownloads=-1 表示不限次数
    if (transfer.maxDownloads > 0 && transfer.downloadCount >= transfer.maxDownloads) {
      logger.warn('Max downloads reached', { pickupCode, count: transfer.downloadCount });
      throw new Error('已达到最大下载次数');
    }

    logger.info('Transfer accessed', {
      pickupCode,
      contentType: transfer.contentType,
      downloadCount: transfer.downloadCount + 1,
    });

    return transfer;
  }

  async incrementDownloadCount(id: number) {
    await prisma.transfer.update({
      where: { id },
      data: { downloadCount: { increment: 1 } },
    });
  }

  async getUserHistory(userId: number) {
    const transfers = await prisma.transfer.findMany({
      where: {
        userId,
        status: 'active',
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    logger.debug('User history retrieved', { userId, count: transfers.length });
    return transfers;
  }

  async deleteTransfer(id: number, filePath?: string | null) {
    if (filePath) {
      await fs.unlink(filePath).catch(() => {});
      logger.debug('File deleted', { path: filePath });
    }

    await prisma.transfer.update({
      where: { id },
      data: { status: 'expired' },
    });

    logger.debug('Transfer marked as expired', { id });
  }

  private async generateUniqueCode(): Promise<string> {
    let code: string;
    let attempts = 0;
    const maxAttempts = 10;

    do {
      code = CodeService.generate();
      attempts++;

      const existing = await prisma.transfer.findUnique({
        where: { pickupCode: code },
      });

      if (!existing) {
        return code;
      }

      if (attempts >= maxAttempts) {
        logger.error('Failed to generate unique code', { attempts });
        throw new Error('无法生成唯一取件码，请稍后重试');
      }
    } while (true);
  }

  private generateSafeFileName(originalName: string): string {
    // Strip to basename only (removes directory traversal)
    let safeName = path.basename(originalName);

    // Remove null bytes and control characters
    safeName = safeName.replace(/[\x00-\x1f\x7f\x80-\x9f]/g, '');

    // Replace path separators with underscore
    safeName = safeName.replace(/[/\\]/g, '_');

    // Remove leading dots (hidden files on Unix)
    safeName = safeName.replace(/^\.+/, '');

    // Truncate to max length, preserving extension
    const maxLen = 200;
    if (safeName.length > maxLen) {
      const ext = path.extname(safeName);
      const base = safeName.slice(0, maxLen - ext.length);
      safeName = base + ext;
    }

    // If empty after sanitization, use a default name
    if (!safeName) {
      safeName = 'unnamed_file';
    }

    // Prefix with random bytes to prevent collisions
    const randomPrefix = crypto.randomBytes(4).toString('hex');
    return `${randomPrefix}_${safeName}`;
  }
}

export const transferService = new TransferService();

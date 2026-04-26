import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { CodeService } from './code.service.js';
import { getConfig } from '../config/index.js';
import { logger } from './logger.service.js';
import type { TransferResult } from '../types/index.js';

const prisma = new PrismaClient();

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
    userId?: number
  ): Promise<TransferResult> {
    const config = getConfig();

    // 验证文本长度
    if (textContent.length > config.security.upload.maxTextLength) {
      throw new Error(`文本长度超过限制（最大 ${config.security.upload.maxTextLength} 字符）`);
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
    userId?: number
  ): Promise<TransferResult> {
    const config = getConfig();

    // 验证文件大小
    if (file.data.length > config.security.upload.maxFileSize) {
      throw new Error(`文件大小超过限制（最大 ${config.security.upload.maxFileSize / 1024 / 1024}MB）`);
    }

    // 检查文件扩展名
    const ext = path.extname(file.filename).toLowerCase();
    if (config.security.upload.blockedExtensions.includes(ext)) {
      throw new Error('不支持的文件类型');
    }

    const pickupCode = await this.generateUniqueCode();
    const safeFileName = this.generateSafeFileName(file.filename);
    const filePath = path.join(this.uploadDir!, `${pickupCode}_${safeFileName}`);

    // 保存文件
    await fs.writeFile(filePath, file.data);

    // 限制有效期
    const actualExpiry = Math.min(expiresIn, config.transfer.maxExpiry);
    const expiresAt = new Date(Date.now() + actualExpiry * 1000);

    await prisma.transfer.create({
      data: {
        pickupCode,
        contentType: 'file',
        fileName: file.filename,
        fileSize: file.data.length,
        filePath,
        fileMimeType: file.mimetype,
        expiresAt,
        userId: userId || null,
      },
    });

    logger.info('File transfer created', {
      pickupCode,
      fileName: file.filename,
      fileSize: file.data.length,
      expiresIn: actualExpiry,
      userId: userId || 'anonymous',
    });

    return { pickupCode, expiresAt, expiresIn: actualExpiry };
  }

  async getTransfer(pickupCode: string) {
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
      this.deleteTransfer(transfer.id, transfer.filePath).catch(() => {});
      throw new Error('取件码已过期');
    }

    if (transfer.downloadCount >= transfer.maxDownloads) {
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
    let safeName = path.basename(originalName);
    safeName = safeName.replace(/[\x00-\x1f\x80-\x9f]/g, '');
    const maxLen = 200;
    if (safeName.length > maxLen) {
      const ext = path.extname(safeName);
      const base = safeName.slice(0, maxLen - ext.length);
      safeName = base + ext;
    }
    const randomPrefix = crypto.randomBytes(4).toString('hex');
    return `${randomPrefix}_${safeName}`;
  }
}

export const transferService = new TransferService();

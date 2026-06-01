import path from 'path';
import { prisma } from './prisma.service.js';
import { CodeService } from './code.service.js';
import { fileStorageService } from './file-storage.service.js';
import { getConfig } from '../config/index.js';
import { logger } from './logger.service.js';
import { AppError, ErrorCodes } from './errors.service.js';
import { encrypt, decrypt } from './encryption.service.js';
import { metricsService } from './metrics.service.js';
import type { TransferResult, FolderMetadata } from '../types/index.js';

export class TransferService {
  async init() {
    await fileStorageService.ensureUploadDir();
    logger.info('Transfer service initialized');
  }

  async createTextTransfer(
    textContent: string,
    expiresIn: number,
    userId?: number,
    maxDownloads: number = 1,
    ownerOnly: boolean = false
  ): Promise<TransferResult> {
    const config = getConfig();

    if (textContent.length > config.security.upload.maxTextLength) {
      metricsService.recordTransferCreated('text', !!userId, 'rejected');
      throw new AppError(ErrorCodes.TEXT_TOO_LONG, `文本长度超过限制（最大 ${config.security.upload.maxTextLength} 字符）`);
    }

    const actualExpiry = Math.min(expiresIn, config.transfer.maxExpiry);
    const expiresAt = new Date(Date.now() + actualExpiry * 1000);
    const pickupCode = await this.generateUniqueCode();

    const encrypted = encrypt(textContent);

    await prisma.transfer.create({
      data: {
        pickupCode,
        contentType: 'text',
        textContent: encrypted,
        expiresAt,
        userId: userId || null,
        maxDownloads: maxDownloads === 0 ? -1 : maxDownloads,
        ownerOnly,
      },
    });

    metricsService.recordTransferCreated('text', !!userId, 'success');
    metricsService.recordTransferTextLength(textContent.length);

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
    const isFolder = !!folderMetadata;
    const contentType: 'file' | 'folder' = isFolder ? 'folder' : 'file';

    if (file.data.length > config.security.upload.maxFileSize) {
      metricsService.recordTransferCreated(contentType, !!userId, 'rejected');
      throw new AppError(ErrorCodes.FILE_TOO_LARGE, `文件大小超过限制（最大 ${config.security.upload.maxFileSize / 1024 / 1024}MB）`);
    }

    try {
      await fileStorageService.checkDiskQuota(file.data.length);
    } catch (error) {
      if (error instanceof AppError) {
        metricsService.recordTransferCreated(contentType, !!userId, 'rejected');
      }
      throw error;
    }

    const ext = path.extname(file.filename).toLowerCase();
    if (config.security.upload.blockedExtensions.includes(ext)) {
      metricsService.recordTransferCreated(contentType, !!userId, 'rejected');
      throw new AppError(ErrorCodes.FILE_TYPE_BLOCKED, '不支持的文件类型');
    }

    const pickupCode = await this.generateUniqueCode();
    const filePath = await fileStorageService.writeFile(pickupCode, file.data, file.filename);

    const actualExpiry = Math.min(expiresIn, config.transfer.maxExpiry);
    const expiresAt = new Date(Date.now() + actualExpiry * 1000);

    await prisma.transfer.create({
      data: {
        pickupCode,
        contentType,
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

    metricsService.recordTransferCreated(contentType, !!userId, 'success', file.data.length);

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

  async getTransferAndClaimDownload(pickupCode: string, requestUserId?: number) {
    const transfer = await prisma.transfer.findUnique({
      where: { pickupCode },
      include: { user: { select: { username: true } } },
    });

    if (!transfer) {
      logger.warn('Transfer not found', { pickupCode });
      metricsService.recordTransferClaimed('text', 'not_found');
      throw new AppError(ErrorCodes.TRANSFER_NOT_FOUND, '取件码不存在', 404);
    }

    const metricContentType: 'text' | 'file' | 'folder' =
      transfer.contentType === 'text'
        ? 'text'
        : transfer.contentType === 'folder'
          ? 'folder'
          : 'file';

    if (new Date() > transfer.expiresAt) {
      logger.info('Transfer expired on access', { pickupCode });
      metricsService.recordTransferClaimed(metricContentType, 'expired');
      this.deleteTransfer(transfer.id, transfer.filePath).catch((err) => {
        logger.error('Failed to cleanup expired transfer', {
          pickupCode,
          error: err instanceof Error ? err.message : String(err),
        });
      });
      throw new AppError(ErrorCodes.TRANSFER_EXPIRED, '取件码已过期', 404);
    }

    if (transfer.ownerOnly) {
      if (!requestUserId) {
        metricsService.recordTransferClaimed(metricContentType, 'login_required');
        throw new AppError(ErrorCodes.LOGIN_REQUIRED, '此内容需要登录后领取', 403);
      }
      if (requestUserId !== transfer.userId) {
        metricsService.recordTransferClaimed(metricContentType, 'owner_only');
        throw new AppError(ErrorCodes.OWNER_ONLY, '此内容仅限创建者领取', 403);
      }
    }

    if (transfer.maxDownloads > 0 && transfer.downloadCount >= transfer.maxDownloads) {
      logger.warn('Max downloads reached', { pickupCode, count: transfer.downloadCount });
      metricsService.recordTransferClaimed(metricContentType, 'max_downloads');
      throw new AppError(ErrorCodes.MAX_DOWNLOADS, '已达到最大下载次数');
    }

    if (transfer.maxDownloads > 0) {
      const updated = await prisma.transfer.updateMany({
        where: {
          id: transfer.id,
          downloadCount: { lt: transfer.maxDownloads },
        },
        data: { downloadCount: { increment: 1 } },
      });
      if (updated.count === 0) {
        logger.warn('Concurrent download exceeded max', { pickupCode, maxDownloads: transfer.maxDownloads });
        metricsService.recordTransferClaimed(metricContentType, 'max_downloads');
        throw new AppError(ErrorCodes.MAX_DOWNLOADS, '已达到最大下载次数');
      }
    } else {
      await prisma.transfer.update({
        where: { id: transfer.id },
        data: { downloadCount: { increment: 1 } },
      });
    }

    const refreshed = await prisma.transfer.findUnique({
      where: { id: transfer.id },
      include: { user: { select: { username: true } } },
    });

    const result = refreshed ?? transfer;

    if (result.contentType === 'text' && result.textContent) {
      result.textContent = decrypt(result.textContent);
    }

    metricsService.recordTransferClaimed(metricContentType, 'success');

    logger.info('Transfer accessed', {
      pickupCode,
      contentType: result.contentType,
      downloadCount: result.downloadCount,
    });

    return result;
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
      select: {
        id: true,
        pickupCode: true,
        contentType: true,
        textContent: true,
        fileName: true,
        fileSize: true,
        fileMimeType: true,
        fileCount: true,
        folderName: true,
        downloadCount: true,
        maxDownloads: true,
        ownerOnly: true,
        createdAt: true,
        expiresAt: true,
        status: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    for (const t of transfers) {
      if (t.contentType === 'text' && t.textContent) {
        t.textContent = decrypt(t.textContent);
      }
    }

    logger.debug('User history retrieved', { userId, count: transfers.length });
    return transfers;
  }

  async deleteTransfer(id: number, filePath?: string | null) {
    await fileStorageService.deleteFile(filePath);
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
        throw new AppError(ErrorCodes.CODE_GENERATION_FAILED, '无法生成唯一取件码，请稍后重试', 500);
      }
    } while (true);
  }
}

export const transferService = new TransferService();

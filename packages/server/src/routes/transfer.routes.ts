import type { FastifyInstance } from 'fastify';
import fs from 'fs';
import { transferService } from '../services/transfer.service.js';
import { fileValidationService } from '../services/file-type.service.js';
import { zipValidationService } from '../services/zip-validation.service.js';
import { authMiddleware, optionalAuthMiddleware } from '../middlewares/auth.middleware.js';
import { getConfig } from '../config/index.js';
import { logger } from '../services/logger.service.js';
import { ipBlacklistService } from '../services/ip-blacklist.service.js';
import { pluginManager } from '../plugins/plugin-manager.js';
import { z } from 'zod';

export async function transferRoutes(app: FastifyInstance) {
  const config = getConfig();

  const textUploadSchema = z.object({
    text: z.string().min(1).max(config.security.upload.maxTextLength),
    expiresIn: z.number().min(1).max(config.transfer.maxExpiry).optional(),
    maxDownloads: z.number().min(0).max(1000).optional(),
    ownerOnly: z.boolean().optional(),
  });

  // 获取配置
  app.get('/config', async (_request, reply) => {
    return reply.send({
      success: true,
      data: {
        maxFileSize: config.security.upload.maxFileSize,
        maxFolderUncompressedSize: config.security.upload.folderUpload.maxUncompressedSize,
        maxFolderCompressedSize: config.security.upload.folderUpload.maxCompressedSize,
        maxTextLength: config.security.upload.maxTextLength,
        defaultExpiry: config.transfer.defaultExpiry,
        maxExpiry: config.transfer.maxExpiry,
        folderUploadEnabled: config.security.upload.folderUpload.enabled,
      },
    });
  });

  // 创建传输
  app.post<{
    Body: { text?: string; expiresIn?: number; maxDownloads?: number; ownerOnly?: boolean };
    Querystring: { type?: string; folderName?: string; fileCount?: string; expiresIn?: string; maxDownloads?: string; ownerOnly?: string };
  }>(
    '/',
    {
      preHandler: optionalAuthMiddleware,
      config: {
        rateLimit: {
          max: config.security.rateLimit.uploadMax,
          timeWindow: config.security.rateLimit.uploadWindowMs,
        },
      },
    },
    async (request, reply) => {
      const config = getConfig();
      const contentType = request.headers['content-type'] || '';
      const userId = request.user?.userId;

      // 文件/文件夹上传
      if (contentType.includes('multipart/form-data')) {
        const data = await request.file();
        if (!data) {
          return reply.status(400).send({
            success: false,
            error: { code: 'NO_FILE', message: '未提供文件' },
          });
        }

        const buffer = await data.toBuffer();

        const isFolderUpload = request.query.type === 'folder';
        const folderName = request.query.folderName || 'folder';
        const fileCount = parseInt(request.query.fileCount || '0') || 0;
        const expiresInRaw = parseInt(request.query.expiresIn || '');
        const expiresIn = Math.max(1, Math.min(
          isNaN(expiresInRaw) ? config.transfer.defaultExpiry : expiresInRaw,
          config.transfer.maxExpiry
        ));
        const maxDownloadsRaw = parseInt(request.query.maxDownloads || '');
        const maxDownloads = isNaN(maxDownloadsRaw) ? 1 : Math.min(maxDownloadsRaw, 1000);
        const ownerOnly = request.query.ownerOnly === 'true';

        if (ownerOnly && !userId) {
          return reply.status(400).send({
            success: false,
            error: { code: 'LOGIN_REQUIRED', message: '仅限创建者领取功能需要登录' },
          });
        }

        if (isFolderUpload) {
          if (!config.security.upload.folderUpload.enabled) {
            return reply.status(400).send({
              success: false,
              error: { code: 'FOLDER_UPLOAD_DISABLED', message: '文件夹上传功能已禁用' },
            });
          }
          const zipValidation = zipValidationService.validateZipArchive(buffer, {
            maxUncompressedSize: config.security.upload.folderUpload.maxUncompressedSize,
            maxCompressionRatio: config.security.upload.folderUpload.maxCompressionRatio,
            maxEntries: config.security.upload.folderUpload.maxEntries,
            maxFileNameLength: config.security.upload.folderUpload.maxFileNameLength,
          });

          if (!zipValidation.valid) {
            logger.warn('ZIP validation failed', {
              filename: data.filename,
              reason: zipValidation.reason,
              ip: request.ip,
              userId: userId || 'anonymous',
            });
            return reply.status(400).send({
              success: false,
              error: { code: 'INVALID_ZIP', message: zipValidation.reason || 'ZIP 文件验证失败' },
            });
          }
        }

        if (config.security.fileValidation.enabled) {
          const validation = fileValidationService.validateFile(buffer, data.mimetype, data.filename);
          if (!validation.valid) {
            logger.warn('File validation failed', {
              filename: data.filename, reason: validation.reason,
              ip: request.ip, userId: userId || 'anonymous',
            });
            return reply.status(400).send({
              success: false,
              error: { code: 'INVALID_FILE_TYPE', message: validation.reason || '文件类型验证失败' },
            });
          }
        }

        if (config.security.securityPlugin?.enabled) {
          const scanResult = await pluginManager.scanFile(buffer, {
            filename: data.filename, mimetype: data.mimetype,
            size: buffer.length, ip: request.ip, userId,
          });
          if (scanResult.verdict === 'malicious') {
            ipBlacklistService.recordFailedAttempt(request.ip, 'malicious file detected');
            return reply.status(400).send({
              success: false,
              error: { code: 'SECURITY_BLOCK', message: '文件安全扫描未通过，上传被拒绝', reasons: scanResult.reasons },
            });
          }
          if (scanResult.verdict === 'suspicious') {
            logger.warn('Suspicious file detected', { filename: data.filename, riskScore: scanResult.riskScore });
          }
        }

        const folderMetadata = isFolderUpload
          ? { fileCount, folderName, estimatedUncompressedSize: 0 }
          : undefined;

        const result = await transferService.createFileTransfer(
          { filename: data.filename, mimetype: data.mimetype, data: buffer },
          expiresIn, userId, folderMetadata, maxDownloads, ownerOnly
        );

        return reply.send({ success: true, data: result });
      }

      // 文本上传 — Zod validation errors use route-level catch (test env doesn't use buildApp's setErrorHandler)
      const parsed = textUploadSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: '输入参数无效' },
        });
      }
      const body = parsed.data;

      if (body.ownerOnly && !userId) {
        return reply.status(400).send({
          success: false,
          error: { code: 'LOGIN_REQUIRED', message: '仅限创建者领取功能需要登录' },
        });
      }

      if (config.security.securityPlugin?.enabled) {
        const scanResult = await pluginManager.scanText(body.text, { ip: request.ip, userId });
        if (scanResult.verdict === 'malicious') {
          ipBlacklistService.recordFailedAttempt(request.ip, 'malicious text detected');
          return reply.status(400).send({
            success: false,
            error: { code: 'SECURITY_BLOCK', message: '文本安全扫描未通过，发送被拒绝', reasons: scanResult.reasons },
          });
        }
      }

      const result = await transferService.createTextTransfer(
        body.text, body.expiresIn || config.transfer.defaultExpiry,
        userId, body.maxDownloads ?? 1, body.ownerOnly ?? false
      );

      return reply.send({ success: true, data: result });
    }
  );

  // 获取传输内容
  app.get<{ Params: { code: string } }>(
    '/:code',
    { preHandler: optionalAuthMiddleware },
    async (request, reply) => {
    const config = getConfig();
    const { code } = request.params;
    const userId = request.user?.userId;

    // 验证取件码格式
    if (!code || code.length !== config.transfer.codeLength || !/^[A-HJ-NP-Z2-9]+$/i.test(code)) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_CODE', message: '取件码格式无效' },
      });
    }

    const transfer = await transferService.getTransferAndClaimDownload(code.toUpperCase(), userId);

    if (transfer.contentType === 'text') {
      return reply.send({
        success: true,
        data: {
          contentType: 'text',
          textContent: transfer.textContent,
          expiresAt: transfer.expiresAt,
        },
      });
    }

    const filePath = transfer.filePath!;

    const downloadName = transfer.contentType === 'folder'
      ? `${transfer.folderName || transfer.fileName || 'folder'}.zip`
      : transfer.fileName!;

    const stream = fs.createReadStream(filePath);
    return reply
      .header('Content-Type', transfer.fileMimeType || 'application/octet-stream')
      .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`)
      .header('X-Content-Type-Options', 'nosniff')
      .header('X-Download-Options', 'noopen')
      .header('Cache-Control', 'no-store, no-cache, must-revalidate')
      .header('Content-Security-Policy', "default-src 'none'")
      .send(stream);
  });

  // 获取历史记录（需登录）
  app.get('/history', { preHandler: authMiddleware }, async (request, reply) => {
    const transfers = await transferService.getUserHistory(request.user!.userId);
    return reply.send({ success: true, data: transfers });
  });
}

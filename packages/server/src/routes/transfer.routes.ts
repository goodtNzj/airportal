import type { FastifyInstance } from 'fastify';
import { transferService } from '../services/transfer.service.js';
import { fileValidationService } from '../services/file-type.service.js';
import { authMiddleware, optionalAuthMiddleware } from '../middlewares/auth.middleware.js';
import { getConfig } from '../config/index.js';
import { logger } from '../services/logger.service.js';
import { z } from 'zod';

export async function transferRoutes(app: FastifyInstance) {
  const config = getConfig();

  const textUploadSchema = z.object({
    text: z.string().min(1).max(config.security.upload.maxTextLength),
    expiresIn: z.number().min(1).max(config.transfer.maxExpiry).optional(),
  });

  // 获取配置
  app.get('/config', async (request, reply) => {
    return reply.send({
      success: true,
      data: {
        maxFileSize: config.security.upload.maxFileSize,
        maxTextLength: config.security.upload.maxTextLength,
        defaultExpiry: config.transfer.defaultExpiry,
        maxExpiry: config.transfer.maxExpiry,
      },
    });
  });

  // 创建传输
  app.post<{ Body: { text?: string; expiresIn?: number } }>(
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

      try {
        // 文件上传
        if (contentType.includes('multipart/form-data')) {
          const data = await request.file();
          if (!data) {
            return reply.status(400).send({
              success: false,
              error: { code: 'NO_FILE', message: '未提供文件' },
            });
          }

          const buffer = await data.toBuffer();
          const expiresIn = Math.min(
            parseInt(request.query.expiresIn as string) || config.transfer.defaultExpiry,
            config.transfer.maxExpiry
          );

          // 文件类型深度检测
          if (config.security.fileValidation.enabled) {
            const validation = fileValidationService.validateFile(
              buffer,
              data.mimetype,
              data.filename
            );

            if (!validation.valid) {
              logger.warn('File validation failed', {
                filename: data.filename,
                reason: validation.reason,
                declaredMimeType: validation.declaredMimeType,
                detectedMimeType: validation.detectedMimeType,
                ip: request.ip,
                userId: userId || 'anonymous',
              });

              return reply.status(400).send({
                success: false,
                error: {
                  code: 'INVALID_FILE_TYPE',
                  message: validation.reason || '文件类型验证失败',
                },
              });
            }

            logger.debug('File validation passed', {
              filename: data.filename,
              detectedMimeType: validation.detectedMimeType,
            });
          }

          const result = await transferService.createFileTransfer(
            {
              filename: data.filename,
              mimetype: data.mimetype,
              data: buffer,
            },
            expiresIn,
            userId
          );

          return reply.send({ success: true, data: result });
        }

        // 文本上传
        const body = textUploadSchema.parse(request.body);
        const result = await transferService.createTextTransfer(
          body.text,
          body.expiresIn || config.transfer.defaultExpiry,
          userId
        );

        return reply.send({ success: true, data: result });
      } catch (error) {
        const message = error instanceof Error ? error.message : '上传失败';
        logger.error('Upload failed', {
          error: message,
          ip: request.ip,
          userId: userId || 'anonymous',
        });
        return reply.status(400).send({
          success: false,
          error: { code: 'UPLOAD_FAILED', message },
        });
      }
    }
  );

  // 获取传输内容
  app.get<{ Params: { code: string } }>('/:code', async (request, reply) => {
    const config = getConfig();
    const { code } = request.params;

    // 验证取件码格式
    if (!code || code.length !== config.transfer.codeLength || !/^[A-HJ-NP-Z2-9]+$/i.test(code)) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_CODE', message: '取件码格式无效' },
      });
    }

    try {
      const transfer = await transferService.getTransfer(code.toUpperCase());

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

      // 文件下载
      const fileBuffer = await import('fs/promises').then((fs) =>
        fs.readFile(transfer.filePath!)
      );

      await transferService.incrementDownloadCount(transfer.id);

      return reply
        .header('Content-Type', transfer.fileMimeType || 'application/octet-stream')
        .header(
          'Content-Disposition',
          `attachment; filename*=UTF-8''${encodeURIComponent(transfer.fileName!)}`
        )
        .header('X-Content-Type-Options', 'nosniff')
        .header('X-Download-Options', 'noopen')
        .send(fileBuffer);
    } catch (error) {
      const message = error instanceof Error ? error.message : '获取失败';
      const statusCode = message.includes('不存在') || message.includes('过期') ? 404 : 400;
      return reply.status(statusCode).send({
        success: false,
        error: { code: 'NOT_FOUND', message },
      });
    }
  });

  // 获取历史记录（需登录）
  app.get('/history', { preHandler: authMiddleware }, async (request, reply) => {
    const transfers = await transferService.getUserHistory(request.user!.userId);
    return reply.send({ success: true, data: transfers });
  });
}

import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { initConfig, getConfig } from './config/index.js';
import { routes } from './routes/index.js';
import { transferService } from './services/transfer.service.js';
import { cleanupService } from './services/cleanup.service.js';
import { logger } from './services/logger.service.js';

export async function buildApp() {
  const config = getConfig();

  const app = Fastify({
    logger: false,
    trustProxy: true,
  });

  // 安全中间件
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        scriptSrc: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: true,
    crossOriginResourcePolicy: { policy: 'same-origin' },
    originAgentCluster: true,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    strictTransportSecurity: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    xContentTypeOptions: true,
    xDnsPrefetchControl: { allow: false },
    xDownloadOptions: true,
    xFrameOptions: { action: 'deny' },
    xPermittedCrossDomainPolicies: { permittedPolicies: 'none' },
    xXssProtection: true,
  });

  // CORS
  await app.register(cors, {
    origin: config.cors.origins,
    credentials: true,
    methods: ['GET', 'POST', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // 文件上传
  await app.register(multipart, {
    limits: {
      fileSize: config.security.upload.maxFileSize,
      files: 1,
      fields: 5,
      fieldNameSize: 100,
    },
  });

  // 全局限流
  await app.register(rateLimit, {
    max: config.security.rateLimit.globalMax,
    timeWindow: config.security.rateLimit.globalWindowMs,
    trustProxy: true,
    keyGenerator: (request) => {
      return request.headers['x-forwarded-for']?.toString().split(',')[0] || request.ip;
    },
    errorResponseBuilder: () => ({
      success: false,
      error: { code: 'RATE_LIMIT_EXCEEDED', message: '请求过于频繁，请稍后再试' },
    }),
  });

  // 路由
  await app.register(routes, { prefix: '/api' });

  // 404 处理
  app.setNotFoundHandler((request, reply) => {
    return reply.status(404).send({
      success: false,
      error: { code: 'NOT_FOUND', message: '请求的资源不存在' },
    });
  });

  // 错误处理
  app.setErrorHandler((error, request, reply) => {
    logger.error('Unhandled error', {
      error: error.message,
      stack: error.stack,
      url: request.url,
      method: request.method,
      ip: request.ip,
    });

    return reply.status(500).send({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' },
    });
  });

  return app;
}

export async function startServer() {
  // 初始化配置
  await initConfig();
  const config = getConfig();

  logger.info('Starting AirPortal server...', {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: config.server.port,
    configFile: 'config.json',
  });

  const app = await buildApp();

  // 初始化服务
  await transferService.init();
  logger.info('Transfer service initialized');

  // 启动清理服务
  cleanupService.start();

  // 启动服务器
  await app.listen({
    port: config.server.port,
    host: config.server.host,
  });

  logger.info(`Server running at http://${config.server.host}:${config.server.port}`);
  logger.info(`API endpoint: http://${config.server.host}:${config.server.port}/api`);

  // 安全配置摘要
  logger.info('Security configuration', {
    fileValidation: config.security.fileValidation.enabled,
    ipBlacklist: config.security.ipBlacklist.enabled,
    auditLog: config.security.auditLog.enabled,
    rateLimit: `${config.security.rateLimit.globalMax}/${config.security.rateLimit.globalWindowMs}ms`,
    uploadRateLimit: `${config.security.rateLimit.uploadMax}/${config.security.rateLimit.uploadWindowMs}ms`,
  });

  return app;
}

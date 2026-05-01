import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { fileURLToPath } from 'url';
import { initConfig, getConfig } from './config/index.js';
import { routes } from './routes/index.js';
import { transferService } from './services/transfer.service.js';
import { cleanupService } from './services/cleanup.service.js';
import { logger } from './services/logger.service.js';
import { registerViteHook } from './vite-dev.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.NODE_ENV !== 'production';

export async function buildApp() {
  const config = getConfig();

  const app = Fastify({
    logger: false,
    trustProxy: true,
  });

  // 安全中间件
  const scriptSources = ["'self'"];
  if (isDev) {
    // Vite dev mode needs inline scripts for React Refresh preamble
    scriptSources.push("'unsafe-inline'");
  }

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        scriptSrc: scriptSources,
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

  // CORS (kept for flexibility, effective only for cross-origin requests)
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
    keyGenerator: (request) => {
      return request.headers['x-forwarded-for']?.toString().split(',')[0] || request.ip;
    },
    errorResponseBuilder: () => ({
      success: false,
      error: { code: 'RATE_LIMIT_EXCEEDED', message: '请求过于频繁，请稍后再试' },
    }),
  });

  // Production: serve built frontend static files
  if (!isDev) {
    const webDist = path.resolve(__dirname, '../../web/dist');
    await app.register(fastifyStatic, {
      root: webDist,
      prefix: '/',
      wildcard: false,
    });
  }

  // Dev: register Vite middleware hook (actual Vite server initialized after listen)
  if (isDev) {
    registerViteHook(app);
  }

  // 路由
  await app.register(routes, { prefix: '/api' });

  // 404 / SPA fallback
  app.setNotFoundHandler((request, reply) => {
    // For non-API routes in production, serve index.html (SPA fallback)
    if (!isDev && !request.url.startsWith('/api/')) {
      return reply.sendFile('index.html');
    }
    // For API routes or dev (Vite handles SPA fallback), return 404
    return reply.status(404).send({
      success: false,
      error: { code: 'NOT_FOUND', message: '请求的资源不存在' },
    });
  });

  // 错误处理
  app.setErrorHandler((error, request, reply) => {
    const err = error as Error;
    logger.error('Unhandled error', {
      error: err.message,
      stack: err.stack,
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

  // 验证配置
  const { validateConfig } = await import('./services/config.service.js');
  const errors = validateConfig(config);
  if (errors.length > 0) {
    console.error('Configuration errors:');
    errors.forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
  }

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

  // Dev: initialize Vite after listen (needs app.server for HMR)
  if (process.env.NODE_ENV !== 'production') {
    const { initViteDev } = await import('./vite-dev.js');
    await initViteDev(app);
  }

  logger.info(`Server running at http://${config.server.host}:${config.server.port}`);
  logger.info(`Environment: ${isDev ? 'development' : 'production'}`);

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

import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { fileURLToPath } from 'url';
import net from 'net';
import { initConfig, getConfig } from './config/index.js';
import { routes } from './routes/index.js';
import { transferService } from './services/transfer.service.js';
import { cleanupService } from './services/cleanup.service.js';
import { logger } from './services/logger.service.js';
import { AppError, ErrorCodes } from './services/errors.service.js';
import { ZodError } from 'zod';
import { registerViteHook } from './vite-dev.js';
import { metricsService } from './services/metrics.service.js';
import { registerMetricsHooks } from './middlewares/metrics.middleware.js';
import { metricsRefreshService } from './services/metrics-refresh.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.NODE_ENV !== 'production';

/**
 * 检查 IP 是否为私有/内网地址
 */
function isPrivateIP(ip: string): boolean {
  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase();
    if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true;
    if (normalized.startsWith('fe80:')) return true;
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
    return false;
  }

  if (ip === '127.0.0.1' || ip === 'localhost' || ip === '0.0.0.0') return true;

  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) return false;

  if (parts[0] === 10) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 127) return true;

  return false;
}

export async function buildApp() {
  const config = getConfig();

  const app = Fastify({
    logger: false,
    trustProxy: process.env.TRUST_PROXY === 'true',
  });

  // 安全中间件
  const scriptSources = ["'self'"];
  const connectSources = ["'self'"];
  if (isDev) {
    // Vite dev mode needs inline scripts for React Refresh preamble
    scriptSources.push("'unsafe-inline'");
    // HMR WebSocket runs on a dedicated port (different origin from 'self');
    // allow ws/wss so the HMR client isn't blocked by CSP.
    connectSources.push('ws:', 'wss:');
  }

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        scriptSrc: scriptSources,
        connectSrc: connectSources,
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

  // Cookie 解析（HttpOnly JWT）
  await app.register(cookie);

  // Prometheus 指标
  if (config.metrics?.enabled !== false) {
    metricsService.init();
    await registerMetricsHooks(app);

    const metricsPath = config.metrics?.path || '/metrics';
    const metricsConfig = config.metrics;
    app.get(metricsPath, async (request, reply) => {
      if (metricsConfig && !metricsConfig.publicAccess) {
        const ip = request.ip;
        const authHeader = request.headers.authorization;
        const tokenParam = (request.query as Record<string, string>).token;
        const token = metricsConfig.token;

        const hasValidToken = token && (authHeader === `Bearer ${token}` || tokenParam === token);
        const isPrivate = isPrivateIP(ip);

        if (!isPrivate && !hasValidToken) {
          return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: '访问被拒绝' } });
        }
      }

      try {
        const text = await metricsService.render();
        const ct = await metricsService.contentType();
        reply.header('Content-Type', ct);
        return reply.send(text);
      } catch (error) {
        logger.error('Failed to render metrics', {
          error: error instanceof Error ? error.message : String(error),
        });
        return reply.status(500).send('# failed to render metrics\n');
      }
    });
  }

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
      return request.ip;
    },
    errorResponseBuilder: () => ({
      success: false,
      error: { code: 'RATE_LIMIT_EXCEEDED', message: '请求过于频繁，请稍后再试' },
    }),
    onExceeded: (request) => {
      const url = request.url || '';
      let scope: 'global' | 'upload' | 'auth' | 'ip_management' = 'global';
      if (url.startsWith('/api/transfers') && !url.includes('/config') && !url.includes('/history')) {
        scope = 'upload';
      } else if (url.startsWith('/api/auth/')) {
        scope = 'auth';
      } else if (url.startsWith('/api/security/ip/')) {
        scope = 'ip_management';
      }
      metricsService.recordRateLimitRejection(scope);
    },
  });

  // Production: serve built frontend static files
  if (!isDev) {
    const webDist = process.env.WEB_DIST_PATH || path.resolve(__dirname, '../../../packages/web/dist');
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

  // 全局错误处理 — 所有 handler 抛出的错误最终都汇聚于此
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: '输入参数无效' },
      });
    }

    if (error instanceof AppError) {
      if (error.statusCode >= 500) {
        logger.error('Server error', {
          code: error.code,
          message: error.message,
          url: request.url,
          method: request.method,
        });
      }
      return reply.status(error.statusCode).send({
        success: false,
        error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) },
      });
    }

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
      error: { code: ErrorCodes.INTERNAL_ERROR, message: '服务器内部错误' },
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
    errors.forEach((e) => console.warn(`Configuration warning: ${e}`));
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

  // 启动指标定时刷新
  if (config.metrics?.enabled !== false) {
    metricsRefreshService.start();
  }

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

import type { FastifyInstance } from 'fastify';
import { authRoutes } from './auth.routes.js';
import { transferRoutes } from './transfer.routes.js';

import { auditMiddleware, ipBlacklistRoutes } from '../middlewares/audit.middleware.js';
import { getConfig } from '../config/index.js';
import { ipBlacklistService } from '../services/ip-blacklist.service.js';
import { logger } from '../services/logger.service.js';

export async function routes(app: FastifyInstance) {
  const config = getConfig();

  // 初始化 IP 黑名单服务
  ipBlacklistService.init();

  // 初始化安全插件系统
  if (config.security.securityPlugin?.enabled) {
    const { pluginManager } = await import('../plugins/plugin-manager.js');
    const { heuristicScanner } = await import('../plugins/heuristic-scanner.js');
    const { behaviorTracker } = await import('../plugins/behavior-tracker.js');

    if (config.security.securityPlugin.heuristic?.enabled) {
      pluginManager.register(heuristicScanner);
    }
    if (config.security.securityPlugin.behavior?.enabled) {
      pluginManager.register(behaviorTracker);
    }

    try {
      await pluginManager.initialize();
      logger.info('Security plugin system initialized', {
        plugins: pluginManager.getPlugins(),
      });
    } catch (error) {
      logger.error('Security plugin initialization failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // 全局审计中间件
  if (config.security.auditLog.enabled) {
    app.addHook('onRequest', auditMiddleware);
  } else {
    // 即使审计日志关闭，也记录基本的 HTTP 请求信息
    app.addHook('onResponse', (request, reply, done) => {
      logger.info('Request', {
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        ip: request.ip,
      });
      done();
    });
  }

  // 健康检查
  app.get('/health', async (_request, reply) => {
    return reply.send({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // 认证路由
  app.register(authRoutes, { prefix: '/auth' });

  // 传输路由
  app.register(transferRoutes, { prefix: '/transfers' });

  

  // IP 黑名单管理路由
  app.register(ipBlacklistRoutes, { prefix: '/security/ip' });
}

import type { FastifyInstance } from 'fastify';
import { authRoutes } from './auth.routes.js';
import { transferRoutes } from './transfer.routes.js';
import { auditMiddleware, ipBlacklistRoutes } from '../middlewares/audit.middleware.js';
import { getConfig } from '../config/index.js';
import { ipBlacklistService } from '../services/ip-blacklist.service.js';

export async function routes(app: FastifyInstance) {
  const config = getConfig();

  // 初始化 IP 黑名单服务
  ipBlacklistService.init();

  // 全局审计中间件
  if (config.security.auditLog.enabled) {
    app.addHook('onRequest', auditMiddleware);
  }

  // 健康检查
  app.get('/health', async (request, reply) => {
    return reply.send({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // 认证路由
  app.register(authRoutes, { prefix: '/auth' });

  // 传输路由
  app.register(transferRoutes, { prefix: '/transfers' });

  // IP 黑名单管理路由
  app.register(ipBlacklistRoutes, { prefix: '/security/ip' });
}

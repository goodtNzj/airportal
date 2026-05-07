import type { FastifyInstance, FastifyRequest, FastifyReply, HookHandlerDoneFunction } from 'fastify';
import { getConfig } from '../config/index.js';
import { logger } from '../services/logger.service.js';
import { ipBlacklistService } from '../services/ip-blacklist.service.js';

// 敏感字段列表
const SENSITIVE_FIELDS = ['password', 'passwordHash', 'token', 'secret', 'authorization'];

/**
 * 脱敏处理
 */
function sanitize(obj: unknown, depth: number = 0): unknown {
  if (depth > 5) return '[MAX_DEPTH]';
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map((item) => sanitize(item, depth + 1));

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_FIELDS.some((f) => lowerKey.includes(f))) {
      result[key] = '***REDACTED***';
    } else if (typeof value === 'object' && value !== null) {
      result[key] = sanitize(value, depth + 1);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * 获取客户端 IP
 */
function getClientIP(request: FastifyRequest): string {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  if (Array.isArray(forwarded)) {
    return forwarded[0].trim();
  }
  return request.ip;
}

/**
 * 审计日志中间件
 */
export function auditMiddleware(request: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction): void {
  const config = getConfig();
  const startTime = Date.now();
  const clientIP = getClientIP(request);

  // 检查 IP 是否被封禁
  if (config.security.ipBlacklist.enabled && ipBlacklistService.isBlocked(clientIP)) {
    logger.warn('Blocked IP attempted access', {
      ip: clientIP,
      path: request.url,
      method: request.method,
    });
    reply.status(403).send({
      success: false,
      error: { code: 'IP_BLOCKED', message: '访问被拒绝' },
    });
    done();
    return;
  }

  // 记录请求
  const auditData: Record<string, unknown> = {
    method: request.method,
    url: request.url,
    ip: clientIP,
    userAgent: request.headers['user-agent'],
  };

  if (request.body && config.log.level === 'debug') {
    auditData.body = sanitize(request.body);
  }

  if (request.params && Object.keys(request.params).length > 0) {
    auditData.params = request.params;
  }

  if (request.query && Object.keys(request.query).length > 0) {
    auditData.query = request.query;
  }

  if (request.user) {
    auditData.userId = request.user.userId;
    auditData.username = request.user.username;
  }

  logger.debug('Request started', auditData);

  // 记录请求
  if (config.security.ipBlacklist.enabled) {
    ipBlacklistService.recordRequest(clientIP);
  }

  // 响应完成后记录
  reply.raw.on('finish', () => {
    const duration = Date.now() - startTime;
    const statusCode = reply.statusCode;

    const responseAudit = {
      ...auditData,
      statusCode,
      duration: `${duration}ms`,
    };

    if (statusCode >= 500) {
      logger.error('Request failed', responseAudit);
    } else if (statusCode >= 400) {
      logger.warn('Request error', responseAudit);
      if (config.security.ipBlacklist.enabled) {
        ipBlacklistService.recordFailedAttempt(clientIP, `HTTP ${statusCode}`);
      }
    } else {
      logger.info('Request completed', responseAudit);
    }
  });

  done();
}

/**
 * IP 黑名单管理路由
 */
export async function ipBlacklistRoutes(app: FastifyInstance) {
  const { authMiddleware } = await import('./auth.middleware.js');

  // IP 管理端点限流：5 req/min
  app.get('/stats', {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: 60000,
      },
    },
  }, async (_request, reply) => {
    return reply.send({
      success: true,
      data: ipBlacklistService.getStats(),
    });
  });

  app.get('/blocked', {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: 60000,
      },
    },
  }, async (_request, reply) => {
    return reply.send({
      success: true,
      data: ipBlacklistService.getBlockedIPs(),
    });
  });

  app.post<{ Body: { ip: string; reason: string; duration?: number } }>('/block', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const { ip, reason, duration } = request.body;

    if (!ip || !reason) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_PARAMS', message: '缺少必要参数' },
      });
    }

    ipBlacklistService.blockIP(ip, reason, duration);
    return reply.send({ success: true, message: 'IP 已封禁' });
  });

  app.delete<{ Body: { ip: string } }>('/unblock', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const { ip } = request.body;

    if (!ip) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_PARAMS', message: '缺少 IP 参数' },
      });
    }

    ipBlacklistService.unblockIP(ip);
    return reply.send({ success: true, message: 'IP 已解封' });
  });
}

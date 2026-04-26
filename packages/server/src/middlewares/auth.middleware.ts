import type { FastifyRequest, FastifyReply } from 'fastify';
import { authService } from '../services/auth.service.js';
import type { UserPayload } from '../types/index.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: UserPayload;
  }
}

export async function authMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.status(401).send({
      success: false,
      error: { code: 'UNAUTHORIZED', message: '未登录' },
    });
  }

  const token = authHeader.substring(7);

  try {
    const payload = authService.verifyToken(token);
    request.user = payload;
  } catch {
    return reply.status(401).send({
      success: false,
      error: { code: 'INVALID_TOKEN', message: 'Token 无效或已过期' },
    });
  }
}

export function optionalAuthMiddleware(request: FastifyRequest, reply: FastifyReply, done: () => void) {
  const authHeader = request.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    try {
      const payload = authService.verifyToken(token);
      request.user = payload;
    } catch {
      // 忽略错误，允许匿名访问
    }
  }

  done();
}

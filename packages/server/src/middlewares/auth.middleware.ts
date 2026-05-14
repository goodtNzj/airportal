import type { FastifyRequest, FastifyReply } from 'fastify';
import { authService } from '../services/auth.service.js';
import type { UserPayload } from '../types/index.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: UserPayload;
  }
}

const TOKEN_COOKIE = 'token';

function extractToken(request: FastifyRequest): string | null {
  const cookie = request.cookies?.[TOKEN_COOKIE];
  if (cookie) return cookie;

  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  return null;
}

export async function authMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const token = extractToken(request);
  if (!token) {
    return reply.status(401).send({
      success: false,
      error: { code: 'UNAUTHORIZED', message: '未登录' },
    });
  }

  try {
    request.user = authService.verifyToken(token);
  } catch {
    return reply.status(401).send({
      success: false,
      error: { code: 'INVALID_TOKEN', message: 'Token 无效或已过期' },
    });
  }
}

export function optionalAuthMiddleware(request: FastifyRequest, _reply: FastifyReply, done: () => void) {
  const token = extractToken(request);
  if (token) {
    try {
      request.user = authService.verifyToken(token);
    } catch {
      // 忽略错误，允许匿名访问
    }
  }
  done();
}

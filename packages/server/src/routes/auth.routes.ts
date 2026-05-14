import type { FastifyInstance } from 'fastify';
import { authService } from '../services/auth.service.js';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { getConfig } from '../config/index.js';
import { z } from 'zod';

const registerSchema = z.object({
  username: z.string().min(3).max(50),
  password: z.string().min(6).max(100),
});

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const isDev = process.env.NODE_ENV !== 'production';

function setTokenCookie(reply: import('fastify').FastifyReply, token: string) {
  reply.setCookie('token', token, {
    path: '/api/',
    httpOnly: true,
    secure: !isDev,
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60,
  });
}

function clearTokenCookie(reply: import('fastify').FastifyReply) {
  reply.clearCookie('token', { path: '/api/' });
}

export async function authRoutes(app: FastifyInstance) {
  const config = getConfig();

  app.post('/register', {
    config: {
      rateLimit: {
        max: config.security.rateLimit.authMax,
        timeWindow: config.security.rateLimit.authWindowMs,
      },
    },
  }, async (request, reply) => {
    const body = registerSchema.parse(request.body);
    const { token, user } = await authService.register(body.username, body.password);
    setTokenCookie(reply, token);
    return reply.send({ success: true, data: { user } });
  });

  app.post('/login', {
    config: {
      rateLimit: {
        max: config.security.rateLimit.authMax,
        timeWindow: config.security.rateLimit.authWindowMs,
      },
    },
  }, async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const { token, user } = await authService.login(body.username, body.password);
    setTokenCookie(reply, token);
    return reply.send({ success: true, data: { user } });
  });

  app.post('/logout', async (_request, reply) => {
    clearTokenCookie(reply);
    return reply.send({ success: true, data: null });
  });

  app.get('/me', { preHandler: authMiddleware }, async (request, reply) => {
    const user = await authService.getUserById(request.user!.userId);
    return reply.send({ success: true, data: user });
  });
}

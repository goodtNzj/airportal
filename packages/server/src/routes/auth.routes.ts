import type { FastifyInstance } from 'fastify';
import { authService } from '../services/auth.service.js';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { z } from 'zod';

const registerSchema = z.object({
  username: z.string().min(3).max(50),
  password: z.string().min(6).max(100),
});

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export async function authRoutes(app: FastifyInstance) {
  // 注册
  app.post('/register', async (request, reply) => {
    const body = registerSchema.parse(request.body);

    try {
      const result = await authService.register(body.username, body.password);
      return reply.send({ success: true, data: result });
    } catch (error) {
      const message = error instanceof Error ? error.message : '注册失败';
      return reply.status(400).send({
        success: false,
        error: { code: 'REGISTER_FAILED', message },
      });
    }
  });

  // 登录
  app.post('/login', async (request, reply) => {
    const body = loginSchema.parse(request.body);

    try {
      const result = await authService.login(body.username, body.password);
      return reply.send({ success: true, data: result });
    } catch (error) {
      const message = error instanceof Error ? error.message : '登录失败';
      return reply.status(401).send({
        success: false,
        error: { code: 'LOGIN_FAILED', message },
      });
    }
  });

  // 获取当前用户信息
  app.get('/me', { preHandler: authMiddleware }, async (request, reply) => {
    const user = await authService.getUserById(request.user!.userId);
    return reply.send({ success: true, data: user });
  });
}

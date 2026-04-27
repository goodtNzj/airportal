import type { FastifyInstance } from 'fastify';
import type { ViteDevServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from './services/logger.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let viteServer: ViteDevServer | null = null;

/**
 * Register the Vite onRequest hook during buildApp().
 * The actual Vite server is initialized later in startServer() after listen().
 */
export function registerViteHook(app: FastifyInstance): void {
  const isDev = process.env.NODE_ENV !== 'production';
  if (!isDev) return;

  app.addHook('onRequest', async (request, reply) => {
    if (request.url.startsWith('/api/')) return;
    if (!viteServer) {
      return reply.status(503).send({
        success: false,
        error: { code: 'NOT_READY', message: 'Dev server initializing...' },
      });
    }

    reply.hijack();
    viteServer.middlewares(request.raw, reply.raw, (err?: Error) => {
      if (err) {
        logger.error('Vite middleware error', { error: err.message, url: request.url });
        reply.raw.statusCode = 500;
        reply.raw.end('Internal Server Error');
      }
    });
  });
}

/**
 * Initialize the Vite dev server in middleware mode.
 * Must be called AFTER app.listen() so app.server is available for HMR.
 */
export async function initViteDev(app: FastifyInstance): Promise<void> {
  const isDev = process.env.NODE_ENV !== 'production';
  if (!isDev) return;

  try {
    const { createServer } = await import('vite');

    const webRoot = path.resolve(__dirname, '../../web');

    viteServer = await createServer({
      root: webRoot,
      server: {
        middlewareMode: true,
        hmr: {
          server: app.server,
        },
      },
      appType: 'spa',
    });

    logger.info('Vite dev server initialized with HMR');
  } catch (error) {
    logger.error('Failed to initialize Vite dev server', { error });
    throw error;
  }
}

export function getViteServer(): ViteDevServer | null {
  return viteServer;
}

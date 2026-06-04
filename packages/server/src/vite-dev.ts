import type { FastifyInstance } from 'fastify';
import type { ViteDevServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { logger } from './services/logger.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let viteServer: ViteDevServer | null = null;
let hmrServer: HttpServer | null = null;

/**
 * Register the Vite onRequest hook during buildApp().
 * The actual Vite server is initialized later in startServer() after listen().
 */
export function registerViteHook(app: FastifyInstance): void {
  const isDev = process.env.NODE_ENV !== 'production';
  if (!isDev) return;

  app.addHook('onRequest', async (request, reply) => {
    if (request.url.startsWith('/api/')) return;
    if (request.url === '/metrics' || request.url.startsWith('/metrics?')) return;
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
export async function initViteDev(_app: FastifyInstance): Promise<void> {
  const isDev = process.env.NODE_ENV !== 'production';
  if (!isDev) return;

  try {
    const { createServer } = await import('vite');

    const webRoot = path.resolve(__dirname, '../../web');

    // IMPORTANT: @fastify/websocket installs a global `upgrade` listener on
    // fastify.server that hijacks every WebSocket handshake. If Vite HMR
    // shared the same server, its upgrade would be routed to the Fastify
    // 404 handler and the socket destroyed, causing the HMR client to
    // reload the page in a loop (the browser flickering).
    //
    // Use a dedicated HTTP server for HMR on a separate port so the two
    // subsystems don't fight over the upgrade event.
    hmrServer = createHttpServer();
    const hmrPort = await new Promise<number>((resolve, reject) => {
      hmrServer!.once('error', reject);
      hmrServer!.listen(0, '127.0.0.1', () => {
        const addr = hmrServer!.address();
        if (addr && typeof addr === 'object') resolve(addr.port);
        else reject(new Error('Failed to obtain HMR port'));
      });
    });

    // Close the HMR server when the process exits
    const cleanupHmr = async () => {
      await new Promise<void>((resolve) => {
        if (!hmrServer) return resolve();
        hmrServer.close(() => resolve());
      });
      hmrServer = null;
    };
    process.on('SIGINT', cleanupHmr);
    process.on('SIGTERM', cleanupHmr);

    viteServer = await createServer({
      root: webRoot,
      server: {
        middlewareMode: true,
        hmr: {
          server: hmrServer,
          port: hmrPort,
        },
      },
      appType: 'spa',
    });

    logger.info('Vite dev server initialized with HMR', { hmrPort });
  } catch (error) {
    logger.error('Failed to initialize Vite dev server', { error });
    throw error;
  }
}

export function getViteServer(): ViteDevServer | null {
  return viteServer;
}

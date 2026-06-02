import type {
  FastifyInstance,
  FastifyRequest,
  onRequestHookHandler,
  onResponseHookHandler,
} from 'fastify';
import { metricsService } from '../services/metrics.service.js';

declare module 'fastify' {
  interface FastifyRequest {
    metricsStartTime?: bigint;
    metricsEndTimer?: () => void;
    metricsStartBytes?: number;
  }
}

function getRouteUrl(request: FastifyRequest): string | undefined {
  const routeOptions = (request as unknown as { routeOptions?: { url?: string } })
    .routeOptions;
  if (routeOptions?.url) return routeOptions.url;
  const routerPath = (request as unknown as { routerPath?: string }).routerPath;
  if (routerPath && routerPath !== '/' && routerPath !== request.url) {
    return routerPath;
  }
  return undefined;
}

const onRequestHook: onRequestHookHandler = (request, _reply, done) => {
  if (!metricsService.isEnabled()) return done();
  if (request.url.startsWith('/metrics')) return done();
  request.metricsStartTime = process.hrtime.bigint();
  request.metricsEndTimer = metricsService.startHttp(request.method);
  request.metricsStartBytes = (_reply.raw as unknown as { bytesWritten?: number }).bytesWritten ?? 0;
  done();
};

const onResponseHook: onResponseHookHandler = (request, reply, done) => {
  if (!metricsService.isEnabled()) return done();
  if (request.url.startsWith('/metrics')) return done();
  const start = request.metricsStartTime;
  if (!start) return done();

  const elapsedNs = process.hrtime.bigint() - start;
  const durationSeconds = Number(elapsedNs) / 1e9;
  const statusCode = reply.statusCode;
  const routeUrl = getRouteUrl(request);
  const responseSize = Math.max(0, ((reply.raw as unknown as { bytesWritten?: number }).bytesWritten ?? 0) - (request.metricsStartBytes ?? 0));

  metricsService.observeHttp(
    request.method,
    request.url,
    routeUrl,
    statusCode,
    durationSeconds,
    responseSize
  );

  if (request.metricsEndTimer) {
    try {
      request.metricsEndTimer();
    } catch {
      // ignore
    }
  }
  done();
};

export async function registerMetricsHooks(app: FastifyInstance) {
  app.addHook('onRequest', onRequestHook);
  app.addHook('onResponse', onResponseHook);
}

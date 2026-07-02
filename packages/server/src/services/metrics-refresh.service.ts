import { prisma } from './prisma.service.js';
import { metricsService } from './metrics.service.js';
import { ipBlacklistService } from './ip-blacklist.service.js';
import { discoveryService } from './discovery.service.js';
import { roomService } from './room.service.js';
import { signalingService } from './signaling.service.js';
import { logger } from './logger.service.js';

const DEFAULT_REFRESH_MS = 15_000;

class MetricsRefreshService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private refreshMs = DEFAULT_REFRESH_MS;
  private running = false;

  start(): void {
    if (this.timer) return;
    if (!metricsService.isEnabled()) {
      logger.info('Metrics refresh service disabled (metrics disabled)');
      return;
    }
    this.timer = setInterval(() => {
      this.refreshAll().catch((err) => {
        logger.warn('Metrics refresh failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, this.refreshMs);
    this.timer.unref?.();
    logger.info('Metrics refresh service started', { intervalMs: this.refreshMs });

    this.refreshAll().catch(() => {
      // First run may fail if DB is not yet ready; ignore
    });
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  setIntervalMs(ms: number): void {
    if (ms > 0) this.refreshMs = ms;
  }

  private async refreshAll(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await Promise.all([
        this.refreshTransferStats(),
        this.refreshSecurityStats(),
        this.refreshP2PStats(),
      ]);
    } finally {
      this.running = false;
    }
  }

  private async refreshTransferStats(): Promise<void> {
    try {
      const [active, expired, byType] = await Promise.all([
        prisma.transfer.count({ where: { status: 'active', expiresAt: { gt: new Date() } } }),
        prisma.transfer.count({ where: { status: 'expired' } }),
        prisma.transfer.groupBy({
          by: ['contentType', 'status'],
          where: { status: 'active', expiresAt: { gt: new Date() } },
          _sum: { fileSize: true },
          _count: { _all: true },
        }),
      ]);
      metricsService.setTransferStats({ active, expired });

      const bytesByType = { file: 0, folder: 0, text: 0 };
      const countByType = { file: 0, folder: 0, text: 0 };
      for (const row of byType) {
        const key: 'file' | 'folder' | 'text' =
          row.contentType === 'folder' ? 'folder' : row.contentType === 'text' ? 'text' : 'file';
        bytesByType[key] += row._sum.fileSize ?? 0;
        countByType[key] += row._count._all;
      }
      metricsService.setStorageStats(bytesByType, countByType);
    } catch (err) {
      logger.debug('refreshTransferStats failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private refreshSecurityStats(): void {
    try {
      ipBlacklistService.publishMetrics();
    } catch (err) {
      logger.debug('refreshSecurityStats failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private refreshP2PStats(): void {
    try {
      const total = discoveryService.getPeerCount();
      const transferring = discoveryService.getTransferringCount();
      metricsService.setP2PConnections(total, transferring);
      metricsService.setP2PRooms(roomService.getRoomCount());
      metricsService.setP2PPendingTransfers(signalingService.getPendingTransferCount());
    } catch (err) {
      logger.debug('refreshP2PStats failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export const metricsRefreshService = new MetricsRefreshService();

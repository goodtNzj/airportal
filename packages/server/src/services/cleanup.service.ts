import cron from 'node-cron';
import { prisma } from './prisma.service.js';
import { getConfig } from '../config/index.js';
import { logger } from './logger.service.js';
import { fileStorageService } from './file-storage.service.js';
import { metricsService } from './metrics.service.js';

export class CleanupService {
  private isRunning = false;
  private intervalTimer: ReturnType<typeof setInterval> | null = null;
  private cronTask: cron.ScheduledTask | null = null;

  start() {
    const config = getConfig();
    const intervalSeconds = config.cleanup.interval;

    if (intervalSeconds < 60) {
      this.intervalTimer = setInterval(() => {
        this.cleanupExpired();
      }, intervalSeconds * 1000);
      logger.info(`Cleanup service started`, { interval: `${intervalSeconds}s (setInterval)` });
    } else {
      const expr = intervalSeconds < 3600
        ? `*/${Math.floor(intervalSeconds / 60)} * * * *`
        : `0 */${Math.floor(intervalSeconds / 3600)} * * *`;
      this.cronTask = cron.schedule(expr, () => this.cleanupExpired());
      logger.info(`Cleanup service started`, { interval: expr });
    }

    logger.info('Cleanup configuration', {
      cleanFiles: config.cleanup.cleanFiles,
      cleanRecords: config.cleanup.cleanRecords,
      recordAction: config.cleanup.recordAction,
      runOnStart: config.cleanup.runOnStart,
    });

    if (config.cleanup.runOnStart) {
      this.cleanupExpired().catch((err) => logger.error('Startup cleanup failed', { error: err.message }));
    }
  }

  async cleanupExpired() {
    const config = getConfig();

    if (this.isRunning) {
      logger.debug('Cleanup already running, skipping');
      metricsService.recordCleanupFinish(Date.now(), 'skipped');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();
    const metricStart = metricsService.recordCleanupStart();

    try {
      const now = new Date();

      const expiredTransfers = await prisma.transfer.findMany({
        where: {
          expiresAt: { lt: now },
          status: 'active',
        },
      });

      if (expiredTransfers.length === 0) {
        logger.debug('No expired transfers found');
        metricsService.recordCleanupFinish(metricStart, 'success', 0, 0, 0, 0);
        return;
      }

      logger.info(`Found ${expiredTransfers.length} expired transfers`);

      let filesDeleted = 0;
      let filesFailed = 0;
      let recordsUpdated = 0;
      let recordsDeleted = 0;

      for (const transfer of expiredTransfers) {
        try {
          // 清理文件
          if (config.cleanup.cleanFiles && transfer.filePath) {
            try {
              await fileStorageService.deleteFile(transfer.filePath);
              filesDeleted++;
              logger.debug(`Deleted file`, { pickupCode: transfer.pickupCode, path: transfer.filePath });
            } catch (err) {
              filesFailed++;
              logger.warn(`Failed to delete file`, { pickupCode: transfer.pickupCode, path: transfer.filePath });
            }
          }

          // 清理数据库记录
          if (config.cleanup.cleanRecords) {
            if (config.cleanup.recordAction === 'delete') {
              await prisma.transfer.delete({ where: { id: transfer.id } });
              recordsDeleted++;
            } else {
              await prisma.transfer.update({
                where: { id: transfer.id },
                data: { status: 'expired' },
              });
              recordsUpdated++;
            }
          }
        } catch (err) {
          logger.error(`Failed to cleanup transfer`, {
            pickupCode: transfer.pickupCode,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      const duration = Date.now() - startTime;
      metricsService.recordCleanupFinish(
        metricStart,
        'success',
        filesDeleted,
        filesFailed,
        recordsUpdated,
        recordsDeleted
      );
      metricsService.recordCleanupScan(expiredTransfers.length, expiredTransfers.length);
      logger.info('Cleanup completed', {
        total: expiredTransfers.length,
        filesDeleted,
        filesFailed,
        recordsUpdated,
        recordsDeleted,
        duration: `${duration}ms`,
      });
    } catch (err) {
      logger.error('Cleanup failed', { error: err instanceof Error ? err.message : String(err) });
      metricsService.recordCleanupFinish(metricStart, 'error');
    } finally {
      this.isRunning = false;
    }
  }

  async stop() {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    if (this.cronTask) {
      this.cronTask.stop();
      this.cronTask = null;
    }
    logger.info('Cleanup service stopped');
  }
}

export const cleanupService = new CleanupService();

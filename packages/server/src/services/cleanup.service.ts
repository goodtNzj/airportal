import cron from 'node-cron';
import fs from 'fs/promises';
import { PrismaClient } from '@prisma/client';
import { getConfig } from '../config/index.js';
import { logger } from './logger.service.js';

const prisma = new PrismaClient();

export class CleanupService {
  private isRunning = false;

  start() {
    const config = getConfig();
    const intervalSeconds = config.cleanup.interval;
    let cronExpression: string;

    if (intervalSeconds < 60) {
      cronExpression = '* * * * *';
      logger.info(`Cleanup service started`, { interval: `${intervalSeconds}s` });
    } else if (intervalSeconds < 3600) {
      const minutes = Math.floor(intervalSeconds / 60);
      cronExpression = `*/${minutes} * * * *`;
      logger.info(`Cleanup service started`, { interval: `${minutes}m` });
    } else {
      cronExpression = '0 * * * *';
      logger.info(`Cleanup service started`, { interval: '1h' });
    }

    logger.info('Cleanup configuration', {
      cleanFiles: config.cleanup.cleanFiles,
      cleanRecords: config.cleanup.cleanRecords,
      recordAction: config.cleanup.recordAction,
      runOnStart: config.cleanup.runOnStart,
    });

    // 启动时执行一次清理
    if (config.cleanup.runOnStart) {
      this.cleanupExpired().catch((err) => logger.error('Startup cleanup failed', { error: err.message }));
    }

    // 定时清理
    cron.schedule(cronExpression, async () => {
      await this.cleanupExpired();
    });
  }

  async cleanupExpired() {
    const config = getConfig();

    if (this.isRunning) {
      logger.debug('Cleanup already running, skipping');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

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
              await fs.unlink(transfer.filePath);
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
    } finally {
      this.isRunning = false;
    }
  }

  async stop() {
    cron.getTasks().forEach((task) => task.stop());
    logger.info('Cleanup service stopped');
  }
}

export const cleanupService = new CleanupService();

import { getConfig } from '../config/index.js';
import { logger } from './logger.service.js';
import { metricsService } from './metrics.service.js';

interface IPRecord {
  ip: string;
  requestCount: number;
  failedAttempts: number;
  firstSeen: Date;
  lastSeen: Date;
  firstFailedAt?: Date;
  blockedAt?: Date;
  blockReason?: string;
}

class IPBlacklistService {
  private ipRecords: Map<string, IPRecord> = new Map();
  private blockedIPs: Set<string> = new Set();
  private maxIpRecords = 10_000;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private unblockTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  init() {
    const config = getConfig();
    const cfg = config.security.ipBlacklist;
    this.maxIpRecords = cfg.maxIpRecords ?? 10_000;

    for (const ip of cfg.blacklist) {
      this.blockedIPs.add(ip);
    }

    this.cleanupTimer = setInterval(() => this.cleanup(), 300_000);

    logger.info('IP blacklist service initialized', {
      enabled: cfg.enabled,
      whitelistCount: cfg.whitelist.length,
      blacklistCount: cfg.blacklist.length,
      maxIpRecords: this.maxIpRecords,
    });
  }

  private enforceLimit(): void {
    if (this.ipRecords.size <= this.maxIpRecords) return;

    const sorted = Array.from(this.ipRecords.entries())
      .filter(([, r]) => !this.blockedIPs.has(r.ip))
      .sort((a, b) => a[1].lastSeen.getTime() - b[1].lastSeen.getTime());

    // Remove enough entries to get total size (records + blocked) under the limit
    const blockedCount = this.blockedIPs.size;
    const nonBlockedRecords = this.ipRecords.size - blockedCount;
    const excess = nonBlockedRecords - this.maxIpRecords + blockedCount;
    if (excess > 0) {
      const toRemove = sorted.slice(0, excess);
      for (const [ip] of toRemove) {
        this.ipRecords.delete(ip);
      }
    }
  }

  isBlocked(ip: string): boolean {
    const config = getConfig();
    if (!config.security.ipBlacklist.enabled) return false;
    if (config.security.ipBlacklist.whitelist.includes(ip)) return false;
    return this.blockedIPs.has(ip);
  }

  isWhitelisted(ip: string): boolean {
    const config = getConfig();
    return config.security.ipBlacklist.whitelist.includes(ip);
  }

  recordRequest(ip: string): void {
    const config = getConfig();
    if (!config.security.ipBlacklist.enabled || this.isWhitelisted(ip)) return;

    const now = new Date();
    const record = this.ipRecords.get(ip);

    if (!record) {
      this.enforceLimit();
      this.ipRecords.set(ip, {
        ip, requestCount: 1, failedAttempts: 0,
        firstSeen: now, lastSeen: now,
      });
      return;
    }

    record.requestCount++;
    record.lastSeen = now;
  }

  recordFailedAttempt(ip: string, reason: string): void {
    const config = getConfig();
    if (!config.security.ipBlacklist.enabled || this.isWhitelisted(ip)) return;

    const cfg = config.security.ipBlacklist;
    const now = new Date();
    const record = this.ipRecords.get(ip);

    if (!record) {
      this.enforceLimit();
      this.ipRecords.set(ip, {
        ip, requestCount: 1, failedAttempts: 1,
        firstSeen: now, lastSeen: now, firstFailedAt: now,
      });
      return;
    }

    // 使用专用的 firstFailedAt 判断窗口，不受正常请求（更新 lastSeen）影响
    const windowStart = new Date(now.getTime() - cfg.autoBlockWindow * 1000);
    const hasExpired = !record.firstFailedAt || record.firstFailedAt < windowStart;
    record.failedAttempts = hasExpired ? 1 : record.failedAttempts + 1;
    record.firstFailedAt = hasExpired ? now : record.firstFailedAt;
    record.lastSeen = now;

    if (record.failedAttempts >= cfg.autoBlockThreshold) {
      this.blockIP(ip, `自动封禁：${reason}`);
    }
  }

  blockIP(ip: string, reason: string, duration?: number): void {
    if (this.isWhitelisted(ip)) {
      logger.warn('Cannot block whitelisted IP', { ip });
      return;
    }

    const config = getConfig();
    const wasBlocked = this.blockedIPs.has(ip);
    this.blockedIPs.add(ip);
    const record = this.ipRecords.get(ip);
    if (record) {
      record.blockedAt = new Date();
      record.blockReason = reason;
    }

    if (!wasBlocked) {
      const reasonLabel: 'auto' | 'malicious' | 'behavior' | 'manual' = reason.startsWith('自动封禁') ? 'auto' : reason.startsWith('malicious') ? 'malicious' : reason.startsWith('behavior') ? 'behavior' : 'manual';
      metricsService.recordSecurityBlock(reasonLabel);
    }
    metricsService.setSecurityIpRecords(this.ipRecords.size, this.blockedIPs.size);

    logger.warn('IP blocked', { ip, reason, duration });

    // Clear existing unblock timer if any
    const existing = this.unblockTimers.get(ip);
    if (existing) {
      clearTimeout(existing);
    }

    const blockDuration = duration ?? config.security.ipBlacklist.autoBlockDuration;
    if (blockDuration > 0) {
      this.unblockTimers.set(ip, setTimeout(() => {
        this.unblockTimers.delete(ip);
        this.unblockIP(ip);
      }, blockDuration * 1000));
    }
  }

  unblockIP(ip: string): void {
    const timer = this.unblockTimers.get(ip);
    if (timer) {
      clearTimeout(timer);
      this.unblockTimers.delete(ip);
    }
    this.blockedIPs.delete(ip);
    const record = this.ipRecords.get(ip);
    if (record) {
      record.failedAttempts = 0;
      record.firstFailedAt = undefined;
      record.blockedAt = undefined;
      record.blockReason = undefined;
    }
    metricsService.setSecurityIpRecords(this.ipRecords.size, this.blockedIPs.size);
    logger.info('IP unblocked', { ip });
  }

  getIPRecord(ip: string): IPRecord | undefined {
    return this.ipRecords.get(ip);
  }

  getBlockedIPs(): string[] {
    return Array.from(this.blockedIPs);
  }

  cleanup(): void {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000;
    let removed = 0;

    for (const [ip, record] of this.ipRecords) {
      if (!this.blockedIPs.has(ip) && now - record.lastSeen.getTime() > maxAge) {
        this.ipRecords.delete(ip);
        removed++;
      }
    }

    if (removed > 0) {
      logger.debug('IP record cleanup completed', { removed, remaining: this.ipRecords.size });
    }
  }

  getStats() {
    const topFailedIPs = Array.from(this.ipRecords.values())
      .filter((r) => r.failedAttempts > 0)
      .sort((a, b) => b.failedAttempts - a.failedAttempts)
      .slice(0, 10)
      .map((r) => ({ ip: r.ip, failedAttempts: r.failedAttempts }));

    return {
      totalRecords: this.ipRecords.size,
      blockedCount: this.blockedIPs.size,
      topFailedIPs,
    };
  }

  publishMetrics(): void {
    metricsService.setSecurityIpRecords(this.ipRecords.size, this.blockedIPs.size);
  }

  shutdown(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    for (const [, timer] of this.unblockTimers) {
      clearTimeout(timer);
    }
    this.unblockTimers.clear();
    logger.info('IP blacklist service shutdown');
  }
}

export const ipBlacklistService = new IPBlacklistService();

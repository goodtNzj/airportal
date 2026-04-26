import { getConfig } from '../config/index.js';
import { logger } from './logger.service.js';

interface IPRecord {
  ip: string;
  requestCount: number;
  failedAttempts: number;
  firstSeen: Date;
  lastSeen: Date;
  blockedAt?: Date;
  blockReason?: string;
}

class IPBlacklistService {
  private ipRecords: Map<string, IPRecord> = new Map();
  private blockedIPs: Set<string> = new Set();

  init() {
    const config = getConfig();
    const cfg = config.security.ipBlacklist;

    // 初始化黑名单
    for (const ip of cfg.blacklist) {
      this.blockedIPs.add(ip);
    }

    logger.info('IP blacklist service initialized', {
      enabled: cfg.enabled,
      whitelistCount: cfg.whitelist.length,
      blacklistCount: cfg.blacklist.length,
    });
  }

  /**
   * 检查 IP 是否被封禁
   */
  isBlocked(ip: string): boolean {
    const config = getConfig();
    if (!config.security.ipBlacklist.enabled) return false;
    if (config.security.ipBlacklist.whitelist.includes(ip)) return false;
    return this.blockedIPs.has(ip);
  }

  /**
   * 检查 IP 是否在白名单
   */
  isWhitelisted(ip: string): boolean {
    const config = getConfig();
    return config.security.ipBlacklist.whitelist.includes(ip);
  }

  /**
   * 记录请求
   */
  recordRequest(ip: string): void {
    const config = getConfig();
    if (!config.security.ipBlacklist.enabled || this.isWhitelisted(ip)) return;

    const now = new Date();
    const record = this.ipRecords.get(ip);

    if (!record) {
      this.ipRecords.set(ip, {
        ip,
        requestCount: 1,
        failedAttempts: 0,
        firstSeen: now,
        lastSeen: now,
      });
      return;
    }

    record.requestCount++;
    record.lastSeen = now;
  }

  /**
   * 记录失败请求（用于自动封禁判断）
   */
  recordFailedAttempt(ip: string, reason: string): void {
    const config = getConfig();
    if (!config.security.ipBlacklist.enabled || this.isWhitelisted(ip)) return;

    const cfg = config.security.ipBlacklist;
    const now = new Date();
    const record = this.ipRecords.get(ip);

    if (!record) {
      this.ipRecords.set(ip, {
        ip,
        requestCount: 1,
        failedAttempts: 1,
        firstSeen: now,
        lastSeen: now,
      });
      return;
    }

    // 检查是否在时间窗口内
    const windowStart = new Date(now.getTime() - cfg.autoBlockWindow * 1000);
    if (record.lastSeen < windowStart) {
      record.failedAttempts = 1;
    } else {
      record.failedAttempts++;
    }

    record.lastSeen = now;

    logger.warn('Failed attempt recorded', {
      ip,
      reason,
      failedAttempts: record.failedAttempts,
      threshold: cfg.autoBlockThreshold,
    });

    // 检查是否需要自动封禁
    if (record.failedAttempts >= cfg.autoBlockThreshold) {
      this.blockIP(ip, `自动封禁：${reason}`);
    }
  }

  /**
   * 封禁 IP
   */
  blockIP(ip: string, reason: string, duration?: number): void {
    if (this.isWhitelisted(ip)) {
      logger.warn('Cannot block whitelisted IP', { ip });
      return;
    }

    const config = getConfig();
    this.blockedIPs.add(ip);
    const record = this.ipRecords.get(ip);
    if (record) {
      record.blockedAt = new Date();
      record.blockReason = reason;
    }

    logger.warn('IP blocked', { ip, reason, duration });

    // 如果设置了封禁时长，定时解封
    const blockDuration = duration ?? config.security.ipBlacklist.autoBlockDuration;
    if (blockDuration > 0) {
      setTimeout(() => {
        this.unblockIP(ip);
      }, blockDuration * 1000);
    }
  }

  /**
   * 解封 IP
   */
  unblockIP(ip: string): void {
    this.blockedIPs.delete(ip);
    const record = this.ipRecords.get(ip);
    if (record) {
      record.failedAttempts = 0;
      record.blockedAt = undefined;
      record.blockReason = undefined;
    }
    logger.info('IP unblocked', { ip });
  }

  /**
   * 获取 IP 记录
   */
  getIPRecord(ip: string): IPRecord | undefined {
    return this.ipRecords.get(ip);
  }

  /**
   * 获取所有被封禁的 IP
   */
  getBlockedIPs(): string[] {
    return Array.from(this.blockedIPs);
  }

  /**
   * 清理过期记录
   */
  cleanup(): void {
    const now = new Date();
    const maxAge = 24 * 60 * 60 * 1000;

    for (const [ip, record] of this.ipRecords) {
      if (!this.blockedIPs.has(ip) && now.getTime() - record.lastSeen.getTime() > maxAge) {
        this.ipRecords.delete(ip);
      }
    }
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    totalRecords: number;
    blockedCount: number;
    topFailedIPs: Array<{ ip: string; failedAttempts: number }>;
  } {
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
}

export const ipBlacklistService = new IPBlacklistService();

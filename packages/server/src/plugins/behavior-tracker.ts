import fs from 'fs/promises';
import path from 'path';
import type { SecurityPlugin, ScanResult, FileMetadata } from './types.js';
import { getConfig } from '../services/config.service.js';
import { ipBlacklistService } from '../services/ip-blacklist.service.js';

interface IPRecord {
  uploadCount: number;
  totalBytes: number;
  timestamps: number[];
  fileSizes: number[];
}

export class BehaviorTracker implements SecurityPlugin {
  name = 'behavior-tracker';
  version = '1.0.0';

  private ipRecords = new Map<string, IPRecord>();
  private maxIpRecords = 10_000;
  private windowMs = 60_000;
  private burstThreshold = 5;
  private sizeMultiplierThreshold = 3;
  private anomalyScoreThreshold = 50;
  private cleanWindowMs = 300_000;
  private persistPath: string | null = null;
  private persistTimer: ReturnType<typeof setInterval> | null = null;
  private dirty = false;

  async initialize(): Promise<void> {
    try {
      const config = getConfig();
      const bConfig = config.security.securityPlugin?.behavior;
      if (bConfig) {
        this.windowMs = bConfig.windowMs ?? 60_000;
        this.burstThreshold = bConfig.burstThreshold ?? 5;
        this.sizeMultiplierThreshold = bConfig.sizeMultiplierThreshold ?? 3;
        this.anomalyScoreThreshold = bConfig.anomalyScoreThreshold ?? 50;

        if (bConfig.persistPath) {
          this.persistPath = path.resolve(bConfig.persistPath);
          await fs.mkdir(path.dirname(this.persistPath), { recursive: true }).catch(() => {});
          await this.loadFromDisk();
        }
      }

      this.persistTimer = setInterval(() => this.flush(), 60_000);
    } catch {
      // Config may not be initialized in tests
    }
  }

  private isValidRecord(value: unknown): value is IPRecord {
    if (!value || typeof value !== 'object') return false;
    const r = value as Record<string, unknown>;
    return (
      typeof r.uploadCount === 'number' && r.uploadCount >= 0 && Number.isFinite(r.uploadCount) &&
      typeof r.totalBytes === 'number' && r.totalBytes >= 0 && Number.isFinite(r.totalBytes) &&
      Array.isArray(r.timestamps) && r.timestamps.every((t) => typeof t === 'number' && t > 0) &&
      Array.isArray(r.fileSizes) && r.fileSizes.every((s) => typeof s === 'number' && s >= 0)
    );
  }

  private async loadFromDisk(): Promise<void> {
    if (!this.persistPath) return;
    try {
      const content = await fs.readFile(this.persistPath, 'utf-8');
      const data = JSON.parse(content);
      if (!data || typeof data !== 'object') return;

      for (const [ip, record] of Object.entries(data)) {
        if (this.isValidRecord(record)) {
          this.ipRecords.set(ip, record);
        }
      }
    } catch {
      // File doesn't exist yet, that's fine
    }
  }

  private async flush(): Promise<void> {
    if (!this.dirty || !this.persistPath || this.ipRecords.size === 0) return;
    this.dirty = false;
    try {
      const data: Record<string, IPRecord> = {};
      for (const [ip, record] of this.ipRecords) {
        data[ip] = record;
      }
      await fs.writeFile(this.persistPath, JSON.stringify(data), 'utf-8');
    } catch {
      // Save failure should not affect runtime behavior
    }
  }

  async scanFile(_buffer: Buffer, metadata: FileMetadata): Promise<ScanResult> {
    const ip = metadata.ip;
    if (!ip) {
      return this.cleanResult();
    }

    this.cleanStaleRecords();
    if (this.ipRecords.size >= this.maxIpRecords) {
      this.evictOldest();
    }
    const record = this.getOrCreateRecord(ip);
    const now = Date.now();

    record.uploadCount++;
    record.totalBytes += metadata.size;
    record.timestamps.push(now);
    record.fileSizes.push(metadata.size);
    this.dirty = true;

    const reasons: string[] = [];
    let anomalyScore = 0;

    const recentUploads = record.timestamps.filter((t) => now - t <= this.windowMs);
    // Only prune timestamps older than the cleanWindowMs (not windowMs) to avoid premature data loss
    record.timestamps = record.timestamps.filter((t) => now - t <= this.cleanWindowMs);
    if (recentUploads.length >= this.burstThreshold) {
      const score = Math.min(60, (recentUploads.length - this.burstThreshold + 1) * 15);
      anomalyScore += score;
      reasons.push(`IP ${ip} 短时间内上传 ${recentUploads.length} 次（阈值: ${this.burstThreshold}）`);
    }

    if (record.fileSizes.length >= 3) {
      const recentSizes = record.fileSizes.slice(-10);
      const avgSize = recentSizes.reduce((a, b) => a + b, 0) / recentSizes.length;
      if (avgSize > 0 && metadata.size > avgSize * this.sizeMultiplierThreshold) {
        anomalyScore += 25;
        reasons.push(`文件大小异常 (${(metadata.size / 1024 / 1024).toFixed(1)}MB)，远超该 IP 平均值`);
      }
    }

    if (record.fileSizes.length > 50) {
      record.fileSizes = record.fileSizes.slice(-20);
    }

    if (anomalyScore >= this.anomalyScoreThreshold) {
      ipBlacklistService.recordFailedAttempt(ip, 'behavior anomaly');
    }

    anomalyScore = Math.min(100, anomalyScore);

    let verdict: ScanResult['verdict'] = 'clean';
    if (anomalyScore >= 70) {
      verdict = 'malicious';
    } else if (anomalyScore >= this.anomalyScoreThreshold) {
      verdict = 'suspicious';
    }

    return {
      verdict,
      riskScore: anomalyScore,
      reasons,
      details: { ip, uploadCount: record.uploadCount, recentInWindow: recentUploads.length },
      scannedAt: new Date(),
      duration: 0,
    };
  }

  async shutdown(): Promise<void> {
    if (this.persistTimer) {
      clearInterval(this.persistTimer);
      this.persistTimer = null;
    }
    await this.flush();
    this.ipRecords.clear();
    this.dirty = false;
  }

  private getOrCreateRecord(ip: string): IPRecord {
    if (!this.ipRecords.has(ip)) {
      this.ipRecords.set(ip, { uploadCount: 0, totalBytes: 0, timestamps: [], fileSizes: [] });
    }
    return this.ipRecords.get(ip)!;
  }

  private evictOldest(): void {
    let oldestIp: string | null = null;
    let oldestTime = Infinity;
    for (const [ip, record] of this.ipRecords) {
      const last = record.timestamps.length > 0 ? record.timestamps[record.timestamps.length - 1] : 0;
      if (last < oldestTime) {
        oldestTime = last;
        oldestIp = ip;
      }
    }
    if (oldestIp) {
      this.ipRecords.delete(oldestIp);
    }
  }

  private cleanStaleRecords(): void {
    const cutoff = Date.now() - this.cleanWindowMs;
    for (const [ip, record] of this.ipRecords) {
      const lastActivity = record.timestamps.length > 0
        ? record.timestamps[record.timestamps.length - 1]
        : 0;
      if (lastActivity < cutoff) {
        this.ipRecords.delete(ip);
      }
    }
  }

  private cleanResult(): ScanResult {
    return { verdict: 'clean', riskScore: 0, reasons: [], scannedAt: new Date(), duration: 0 };
  }
}

export const behaviorTracker = new BehaviorTracker();

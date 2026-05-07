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
  private windowMs = 60_000; // sliding window
  private burstThreshold = 5; // uploads per window
  private sizeMultiplierThreshold = 3; // size outlier if >3x baseline
  private anomalyScoreThreshold = 50;
  private cleanWindowMs = 300_000; // 5 min, after which stale records are cleaned

  async initialize(): Promise<void> {
    try {
      const config = getConfig();
      const bConfig = config.security.securityPlugin?.behavior;
      if (bConfig) {
        this.windowMs = bConfig.windowMs ?? 60_000;
        this.burstThreshold = bConfig.burstThreshold ?? 5;
        this.sizeMultiplierThreshold = bConfig.sizeMultiplierThreshold ?? 3;
        this.anomalyScoreThreshold = bConfig.anomalyScoreThreshold ?? 50;
      }
    } catch {
      // Config may not be initialized in tests
    }
  }

  async scanFile(_buffer: Buffer, metadata: FileMetadata): Promise<ScanResult> {
    const ip = metadata.ip;
    if (!ip) {
      return this.cleanResult();
    }

    this.cleanStaleRecords();
    const record = this.getOrCreateRecord(ip);
    const now = Date.now();

    record.uploadCount++;
    record.totalBytes += metadata.size;
    record.timestamps.push(now);
    record.fileSizes.push(metadata.size);

    const reasons: string[] = [];
    let anomalyScore = 0;

    // Check burst
    const recentUploads = record.timestamps.filter((t) => now - t <= this.windowMs);
    record.timestamps = recentUploads; // trim old timestamps
    if (recentUploads.length >= this.burstThreshold) {
      const score = Math.min(60, (recentUploads.length - this.burstThreshold + 1) * 15);
      anomalyScore += score;
      reasons.push(`IP ${ip} 短时间内上传 ${recentUploads.length} 次（阈值: ${this.burstThreshold}）`);
    }

    // Check size outlier
    if (record.fileSizes.length >= 3) {
      const recentSizes = record.fileSizes.slice(-10);
      const avgSize = recentSizes.reduce((a, b) => a + b, 0) / recentSizes.length;
      if (avgSize > 0 && metadata.size > avgSize * this.sizeMultiplierThreshold) {
        anomalyScore += 25;
        reasons.push(`文件大小异常 (${(metadata.size / 1024 / 1024).toFixed(1)}MB)，远超该 IP 平均值`);
      }
    }

    // Trim file sizes list
    if (record.fileSizes.length > 50) {
      record.fileSizes = record.fileSizes.slice(-20);
    }

    // Feed into IP blacklist if anomaly score exceeds threshold
    if (anomalyScore >= this.anomalyScoreThreshold) {
      for (let i = 0; i < Math.min(3, Math.ceil(anomalyScore / 20)); i++) {
        ipBlacklistService.recordFailedAttempt(ip, 'behavior anomaly');
      }
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
      details: {
        ip,
        uploadCount: record.uploadCount,
        recentInWindow: recentUploads.length,
      },
      scannedAt: new Date(),
      duration: 0,
    };
  }

  async shutdown(): Promise<void> {
    this.ipRecords.clear();
  }

  private getOrCreateRecord(ip: string): IPRecord {
    if (!this.ipRecords.has(ip)) {
      this.ipRecords.set(ip, { uploadCount: 0, totalBytes: 0, timestamps: [], fileSizes: [] });
    }
    return this.ipRecords.get(ip)!;
  }

  private cleanStaleRecords(): void {
    const cutoff = Date.now() - this.cleanWindowMs;
    for (const [ip, record] of this.ipRecords) {
      if (record.timestamps.length === 0 || record.timestamps[record.timestamps.length - 1] < cutoff) {
        this.ipRecords.delete(ip);
      }
    }
  }

  private cleanResult(): ScanResult {
    return { verdict: 'clean', riskScore: 0, reasons: [], scannedAt: new Date(), duration: 0 };
  }
}

export const behaviorTracker = new BehaviorTracker();

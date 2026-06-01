import type { SecurityPlugin, ScanResult, FileMetadata } from './types.js';
import { logger } from '../services/logger.service.js';
import { metricsService } from '../services/metrics.service.js';

export class PluginManager {
  private plugins: SecurityPlugin[] = [];
  private initialized = false;

  register(plugin: SecurityPlugin): void {
    if (this.plugins.some((p) => p.name === plugin.name)) {
      logger.warn('Duplicate plugin registration skipped', { name: plugin.name });
      return;
    }
    this.plugins.push(plugin);
    logger.info('Plugin registered', { name: plugin.name, version: plugin.version });
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    for (const plugin of this.plugins) {
      try {
        await plugin.initialize();
        logger.info('Plugin initialized', { name: plugin.name });
      } catch (error) {
        logger.error('Plugin initialization failed', {
          name: plugin.name,
          error: error instanceof Error ? error.message : String(error),
        });
        metricsService.recordSecurityPluginError(plugin.name, 'init');
        throw error;
      }
    }
    this.initialized = true;
  }

  async shutdown(): Promise<void> {
    for (const plugin of this.plugins) {
      try {
        await plugin.shutdown();
      } catch (error) {
        logger.error('Plugin shutdown error', {
          name: plugin.name,
          error: error instanceof Error ? error.message : String(error),
        });
        metricsService.recordSecurityPluginError(plugin.name, 'shutdown');
      }
    }
    this.plugins = [];
    this.initialized = false;
  }

  async scanFile(buffer: Buffer, metadata: FileMetadata): Promise<ScanResult> {
    if (this.plugins.length === 0) {
      return this.emptyResult();
    }

    const results: ScanResult[] = [];
    for (const plugin of this.plugins) {
      try {
        const start = Date.now();
        const result = await plugin.scanFile(buffer, metadata);
        result.duration = Date.now() - start;
        result.scannedAt = new Date();
        results.push(result);
        metricsService.recordSecurityScan(
          plugin.name,
          'file',
          result.verdict,
          result.duration / 1000
        );
      } catch (error) {
        logger.error('Plugin scanFile failed', {
          name: plugin.name,
          error: error instanceof Error ? error.message : String(error),
        });
        metricsService.recordSecurityPluginError(plugin.name, 'scanFile');
        // Treat plugin failure as suspicious
        results.push({
          verdict: 'suspicious',
          riskScore: 50,
          reasons: [`插件 ${plugin.name} 扫描异常`],
          scannedAt: new Date(),
          duration: 0,
        });
        metricsService.recordSecurityScan(plugin.name, 'file', 'suspicious', 0);
      }
    }

    return this.aggregate(results, metadata);
  }

  async scanText(content: string, metadata?: Record<string, unknown>): Promise<ScanResult> {
    const textPlugins = this.plugins.filter((p) => typeof p.scanText === 'function');
    if (textPlugins.length === 0) {
      return this.emptyResult();
    }

    const results: ScanResult[] = [];
    for (const plugin of textPlugins) {
      try {
        const start = Date.now();
        const result = await plugin.scanText!(content, metadata);
        result.duration = Date.now() - start;
        result.scannedAt = new Date();
        results.push(result);
        metricsService.recordSecurityScan(
          plugin.name,
          'text',
          result.verdict,
          result.duration / 1000
        );
      } catch (error) {
        logger.error('Plugin scanText failed', {
          name: plugin.name,
          error: error instanceof Error ? error.message : String(error),
        });
        metricsService.recordSecurityPluginError(plugin.name, 'scanText');
      }
    }

    return this.aggregate(results, { size: content.length } as FileMetadata);
  }

  getPlugins(): ReadonlyArray<{ name: string; version: string }> {
    return this.plugins.map((p) => ({ name: p.name, version: p.version }));
  }

  private aggregate(results: ScanResult[], metadata: FileMetadata): ScanResult {
    if (results.length === 0) {
      return this.emptyResult();
    }

    const allReasons: string[] = [];
    let maxRiskScore = 0;
    let worstVerdict: ScanResult['verdict'] = 'clean';
    const allDetails: Record<string, unknown> = {};
    let totalDuration = 0;

    for (const r of results) {
      allReasons.push(...r.reasons);
      maxRiskScore = Math.max(maxRiskScore, r.riskScore);
      totalDuration += r.duration;

      if (r.verdict === 'malicious') {
        worstVerdict = 'malicious';
      } else if (r.verdict === 'suspicious' && worstVerdict !== 'malicious') {
        worstVerdict = 'suspicious';
      }

      if (r.details) {
        Object.assign(allDetails, r.details);
      }
    }

    // Deduplicate reasons
    const uniqueReasons = [...new Set(allReasons)];

    return {
      verdict: worstVerdict,
      riskScore: maxRiskScore,
      reasons: uniqueReasons,
      details: {
        ...allDetails,
        pluginCount: results.length,
        fileSize: metadata.size,
        fileName: metadata.filename,
      },
      scannedAt: new Date(),
      duration: totalDuration,
    };
  }

  private emptyResult(): ScanResult {
    return {
      verdict: 'clean',
      riskScore: 0,
      reasons: [],
      scannedAt: new Date(),
      duration: 0,
    };
  }
}

export const pluginManager = new PluginManager();

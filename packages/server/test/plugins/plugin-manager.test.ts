import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PluginManager } from '../../src/plugins/plugin-manager.js';
import type { SecurityPlugin, ScanResult, FileMetadata } from '../../src/plugins/types.js';

vi.mock('../../src/services/logger.service.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

function createMockPlugin(name: string, overrides?: Partial<SecurityPlugin>): SecurityPlugin {
  return {
    name,
    version: '1.0.0',
    initialize: async () => {},
    scanFile: async () => ({
      verdict: 'clean',
      riskScore: 0,
      reasons: [],
      scannedAt: new Date(),
      duration: 0,
    }),
    shutdown: async () => {},
    ...overrides,
  };
}

const fileMeta: FileMetadata = { filename: 'test.txt', mimetype: 'text/plain', size: 100 };

describe('PluginManager', () => {
  let manager: PluginManager;

  beforeEach(() => {
    manager = new PluginManager();
  });

  describe('register', () => {
    it('should register a plugin', () => {
      const plugin = createMockPlugin('test-plugin');
      manager.register(plugin);
      expect(manager.getPlugins()).toHaveLength(1);
      expect(manager.getPlugins()[0].name).toBe('test-plugin');
    });

    it('should not register duplicate plugins', () => {
      const plugin1 = createMockPlugin('dup');
      const plugin2 = createMockPlugin('dup');
      manager.register(plugin1);
      manager.register(plugin2);
      expect(manager.getPlugins()).toHaveLength(1);
    });
  });

  describe('scanFile', () => {
    it('should return clean result when no plugins registered', async () => {
      const result = await manager.scanFile(Buffer.from('test'), fileMeta);
      expect(result.verdict).toBe('clean');
      expect(result.riskScore).toBe(0);
    });

    it('should aggregate results from multiple plugins', async () => {
      manager.register(
        createMockPlugin('p1', {
          scanFile: async () => ({
            verdict: 'suspicious',
            riskScore: 50,
            reasons: ['reason-a'],
            scannedAt: new Date(),
            duration: 10,
          }),
        })
      );
      manager.register(
        createMockPlugin('p2', {
          scanFile: async () => ({
            verdict: 'clean',
            riskScore: 10,
            reasons: ['reason-b'],
            scannedAt: new Date(),
            duration: 5,
          }),
        })
      );

      const result = await manager.scanFile(Buffer.from('test'), fileMeta);
      expect(result.verdict).toBe('suspicious');
      expect(result.riskScore).toBe(50);
      expect(result.reasons).toContain('reason-a');
      expect(result.reasons).toContain('reason-b');
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should return malicious if any plugin reports malicious', async () => {
      manager.register(
        createMockPlugin('clean', {
          scanFile: async () => ({
            verdict: 'clean',
            riskScore: 0,
            reasons: [],
            scannedAt: new Date(),
            duration: 0,
          }),
        })
      );
      manager.register(
        createMockPlugin('malicious', {
          scanFile: async () => ({
            verdict: 'malicious',
            riskScore: 90,
            reasons: ['exploit detected'],
            scannedAt: new Date(),
            duration: 0,
          }),
        })
      );

      const result = await manager.scanFile(Buffer.from('test'), fileMeta);
      expect(result.verdict).toBe('malicious');
      expect(result.riskScore).toBe(90);
    });

    it('should handle plugin that throws', async () => {
      manager.register(
        createMockPlugin('failing', {
          scanFile: async () => {
            throw new Error('scan error');
          },
        })
      );

      const result = await manager.scanFile(Buffer.from('test'), fileMeta);
      // Throwing plugin should produce a suspicious result
      expect(result.verdict).toBe('suspicious');
      expect(result.riskScore).toBe(50);
    });

    it('should deduplicate reasons', async () => {
      manager.register(
        createMockPlugin('p1', {
          scanFile: async () => ({
            verdict: 'clean',
            riskScore: 10,
            reasons: ['dup-reason'],
            scannedAt: new Date(),
            duration: 0,
          }),
        })
      );
      manager.register(
        createMockPlugin('p2', {
          scanFile: async () => ({
            verdict: 'clean',
            riskScore: 20,
            reasons: ['dup-reason', 'unique-reason'],
            scannedAt: new Date(),
            duration: 0,
          }),
        })
      );

      const result = await manager.scanFile(Buffer.from('test'), fileMeta);
      expect(result.reasons).toHaveLength(2);
    });

    it('should include details with pluginCount and file metadata', async () => {
      manager.register(createMockPlugin('p1'));

      const result = await manager.scanFile(Buffer.from('test'), fileMeta);
      expect(result.details?.pluginCount).toBe(1);
      expect(result.details?.fileSize).toBe(100);
      expect(result.details?.fileName).toBe('test.txt');
    });
  });

  describe('scanText', () => {
    it('should return clean result when no plugins have scanText', async () => {
      const plugin = createMockPlugin('no-text');
      delete (plugin as any).scanText;
      manager.register(plugin);

      const result = await manager.scanText('hello');
      expect(result.verdict).toBe('clean');
    });

    it('should call scanText on plugins that support it', async () => {
      manager.register(
        createMockPlugin('text-scanner', {
          scanText: async () => ({
            verdict: 'suspicious',
            riskScore: 60,
            reasons: ['bad text'],
            scannedAt: new Date(),
            duration: 0,
          }),
        })
      );

      const result = await manager.scanText('evil code');
      expect(result.verdict).toBe('suspicious');
      expect(result.riskScore).toBe(60);
    });
  });

  describe('initialize and shutdown', () => {
    it('should initialize all plugins', async () => {
      let initialized = false;
      manager.register(
        createMockPlugin('init-test', {
          initialize: async () => {
            initialized = true;
          },
        })
      );

      await manager.initialize();
      expect(initialized).toBe(true);
    });

    it('should throw on plugin init failure', async () => {
      manager.register(
        createMockPlugin('fail-init', {
          initialize: async () => {
            throw new Error('init failed');
          },
        })
      );

      await expect(manager.initialize()).rejects.toThrow('init failed');
    });

    it('should shutdown all plugins', async () => {
      let shutdown = false;
      manager.register(
        createMockPlugin('shutdown-test', {
          shutdown: async () => {
            shutdown = true;
          },
        })
      );

      await manager.shutdown();
      expect(shutdown).toBe(true);
      expect(manager.getPlugins()).toHaveLength(0);
    });
  });
});

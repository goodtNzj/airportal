import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify from 'fastify';

// 模拟 Prisma Client
vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn().mockImplementation(() => ({
    transfer: {
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({
        id: 1,
        pickupCode: 'ABC123',
        contentType: 'text',
        textContent: 'Hello World',
        expiresAt: new Date(Date.now() + 180000),
      }),
      update: vi.fn(),
      delete: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  })),
}));

// 模拟配置
vi.mock('../../src/services/config.service.js', () => ({
  initConfig: vi.fn().mockResolvedValue(undefined),
  getConfig: () => ({
    server: { port: 3000, host: '0.0.0.0' },
    database: { url: 'file:./test/test.db' },
    jwt: { secret: 'test-secret', expiresIn: '7d' },
    security: {
      fileValidation: { enabled: true },
      ipBlacklist: {
        enabled: true,
        autoBlockThreshold: 10,
        autoBlockWindow: 60,
        autoBlockDuration: 3600,
        whitelist: ['127.0.0.1', '::1'],
        blacklist: [],
      },
      auditLog: { enabled: false },
      rateLimit: {
        globalMax: 100,
        globalWindowMs: 60000,
        uploadMax: 10,
        uploadWindowMs: 60000,
      },
      upload: {
        maxFileSize: 52428800,
        maxTextLength: 10000,
        maxTotalStorage: 1073741824,
        blockedExtensions: ['.exe', '.bat', '.cmd', '.sh', '.ps1', '.vbs', '.msi'],
        folderUpload: {
          enabled: true,
          maxUncompressedSize: 524288000,
          maxCompressedSize: 314572800,
          maxCompressionRatio: 100,
          maxEntries: 10000,
          maxFileNameLength: 512,
        },
      },
      securityPlugin: {
        enabled: true,
        heuristic: {
          enabled: true,
          entropyThreshold: 7.5,
          maxScanSize: 10485760,
          rejectRiskThreshold: 70,
          warnRiskThreshold: 40,
          patterns: [],
        },
        behavior: {
          enabled: true,
          windowMs: 60000,
          burstThreshold: 5,
          sizeMultiplierThreshold: 3,
          anomalyScoreThreshold: 50,
        },
      },
    },
    transfer: {
      codeLength: 6,
      defaultExpiry: 180,
      maxExpiry: 3600,
    },
    cleanup: {
      interval: 60,
      runOnStart: false,
      cleanFiles: true,
      cleanRecords: true,
      recordAction: 'update',
    },
    log: { level: 'error', file: '' },
    cors: { origins: ['http://localhost:5173'] },
    metrics: { enabled: false, path: '/metrics', collectNode: false, publicAccess: false, token: '' },
  }),
}));

vi.mock('../../src/services/logger.service.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../src/services/transfer.service.js', () => ({
  transferService: {
    init: vi.fn(),
    createTextTransfer: vi.fn().mockResolvedValue({
      pickupCode: 'ABC123',
      expiresAt: new Date(Date.now() + 180000),
      expiresIn: 180,
    }),
    getTransferAndClaimDownload: vi.fn().mockResolvedValue({
      id: 1,
      pickupCode: 'ABC123',
      contentType: 'text',
      textContent: 'Hello World',
      expiresAt: new Date(Date.now() + 180000),
      downloadCount: 1,
      maxDownloads: 1,
    }),
    getUserHistory: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../src/services/cleanup.service.js', () => ({
  cleanupService: {
    start: vi.fn(),
  },
}));

vi.mock('../../src/services/ip-blacklist.service.js', () => ({
  ipBlacklistService: {
    init: vi.fn(),
    isBlocked: vi.fn().mockReturnValue(false),
    recordRequest: vi.fn(),
    getStats: vi.fn().mockReturnValue({ totalRecords: 0, blockedCount: 0, topFailedIPs: [] }),
    getBlockedIPs: vi.fn().mockReturnValue([]),
    blockIP: vi.fn(),
    unblockIP: vi.fn(),
  },
}));

vi.mock('../../src/services/file-type.service.js', () => ({
  fileValidationService: {
    validateFile: vi.fn().mockReturnValue({ valid: true, isDangerous: false }),
  },
}));

vi.mock('../../src/plugins/plugin-manager.js', () => ({
  pluginManager: {
    register: vi.fn(),
    initialize: vi.fn(),
    shutdown: vi.fn(),
    scanFile: vi.fn().mockResolvedValue({
      verdict: 'clean',
      riskScore: 0,
      reasons: [],
      scannedAt: new Date(),
      duration: 0,
    }),
    scanText: vi.fn().mockResolvedValue({
      verdict: 'clean',
      riskScore: 0,
      reasons: [],
      scannedAt: new Date(),
      duration: 0,
    }),
    getPlugins: vi.fn().mockReturnValue([]),
  },
}));

vi.mock('../../src/plugins/heuristic-scanner.js', () => ({
  heuristicScanner: {
    name: 'heuristic-scanner',
    version: '1.0.0',
    initialize: vi.fn(),
    scanFile: vi.fn().mockResolvedValue({
      verdict: 'clean',
      riskScore: 0,
      reasons: [],
      scannedAt: new Date(),
      duration: 0,
    }),
    shutdown: vi.fn(),
  },
}));

vi.mock('../../src/plugins/behavior-tracker.js', () => ({
  behaviorTracker: {
    name: 'behavior-tracker',
    version: '1.0.0',
    initialize: vi.fn(),
    scanFile: vi.fn().mockResolvedValue({
      verdict: 'clean',
      riskScore: 0,
      reasons: [],
      scannedAt: new Date(),
      duration: 0,
    }),
    shutdown: vi.fn(),
  },
}));

vi.mock('../../src/services/auth.service.js', () => ({
  authService: {
    register: vi.fn().mockResolvedValue({
      token: 'test-token',
      user: { userId: 1, username: 'test' },
    }),
    login: vi.fn().mockResolvedValue({
      token: 'test-token',
      user: { userId: 1, username: 'test' },
    }),
    getUserById: vi.fn().mockResolvedValue({
      id: 1,
      username: 'test',
      createdAt: new Date(),
    }),
    verifyToken: vi.fn().mockReturnValue({ userId: 1, username: 'test' }),
  },
}));

vi.mock('../../src/middlewares/auth.middleware.js', () => ({
  authMiddleware: vi.fn((request, reply, done) => done()),
  optionalAuthMiddleware: vi.fn((request, reply, done) => done()),
}));

// 导入路由
const { routes } = await import('../../src/routes/index.js');

async function buildTestApp() {
  const app = Fastify();
  await app.register(routes, { prefix: '/api' });
  return app;
}

describe('API Routes', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /health', () => {
    it('should return ok status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/health',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('ok');
      expect(body.timestamp).toBeDefined();
    });
  });

  describe('GET /transfers/config', () => {
    it('should return transfer config', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/transfers/config',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.maxFileSize).toBeDefined();
      expect(body.data.maxTextLength).toBeDefined();
    });
  });

  describe('POST /transfers', () => {
    it('should create text transfer', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/transfers',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: 'Hello World' }),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.pickupCode).toBeDefined();
    });

    it('should reject empty text', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/transfers',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: '' }),
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /transfers/:code', () => {
    it('should return transfer content', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/transfers/ABCDEF',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.contentType).toBe('text');
    });

    it('should reject invalid code format', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/transfers/invalid',
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /security/ip/stats', () => {
    it('should return IP stats', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/security/ip/stats',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
    });
  });
});

import fs from 'fs/promises';
import path from 'path';

let loadedConfig: AppConfig | null = null;

export interface FolderUploadConfig {
  enabled: boolean;
  maxUncompressedSize: number;
  maxCompressionRatio: number;
  maxEntries: number;
  maxFileNameLength: number;
}

export interface SecurityPluginHeuristicConfig {
  enabled: boolean;
  entropyThreshold: number;
  maxScanSize: number;
  rejectRiskThreshold: number;
  warnRiskThreshold: number;
  patterns: { name: string; regex: string; weight: number }[];
}

export interface SecurityPluginBehaviorConfig {
  enabled: boolean;
  windowMs: number;
  burstThreshold: number;
  sizeMultiplierThreshold: number;
  anomalyScoreThreshold: number;
}

export interface SecurityPluginConfig {
  enabled: boolean;
  heuristic: SecurityPluginHeuristicConfig;
  behavior: SecurityPluginBehaviorConfig;
}

export interface P2PConfig {
  enabled: boolean;
  maxFileSize: number;
  maxConcurrentTransfers: number;
  requestTimeout: number;
}

export interface SecurityConfig {
  fileValidation: {
    enabled: boolean;
  };
  ipBlacklist: {
    enabled: boolean;
    autoBlockThreshold: number;
    autoBlockWindow: number;
    autoBlockDuration: number;
    whitelist: string[];
    blacklist: string[];
  };
  auditLog: {
    enabled: boolean;
  };
  rateLimit: {
    globalMax: number;
    globalWindowMs: number;
    uploadMax: number;
    uploadWindowMs: number;
  };
  upload: {
    maxFileSize: number;
    maxTextLength: number;
    maxTotalStorage: number;
    blockedExtensions: string[];
    folderUpload: FolderUploadConfig;
  };
  securityPlugin: SecurityPluginConfig;
}

export interface AppConfig {
  server: {
    port: number;
    host: string;
  };
  security: SecurityConfig;
  transfer: {
    codeLength: number;
    defaultExpiry: number;
    maxExpiry: number;
  };
  cleanup: {
    interval: number;
    runOnStart: boolean;
    cleanFiles: boolean;
    cleanRecords: boolean;
    recordAction: 'update' | 'delete';
  };
  log: {
    level: string;
    file: string;
  };
  database: {
    url: string;
  };
  jwt: {
    secret: string;
    expiresIn: string;
  };
  cors: {
    origins: string[];
  };
  p2p: P2PConfig;
}

/**
 * 加载配置文件
 */
async function loadConfigFile(): Promise<Partial<AppConfig> | null> {
  // 查找配置文件路径
  const possiblePaths = [
    path.join(process.cwd(), 'config.json'),
    path.join(process.cwd(), '..', 'config.json'),
    path.join(process.cwd(), '..', '..', 'config.json'),
  ];

  for (const configPath of possiblePaths) {
    try {
      const content = await fs.readFile(configPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      // 继续尝试下一个路径
    }
  }

  return null;
}

/**
 * 获取配置值：环境变量优先，然后是配置文件，最后是默认值
 */
function getValue<T>(
  envKey: string,
  configValue: T | undefined,
  defaultValue: T,
  parser?: (v: string) => T
): T {
  const envValue = process.env[envKey];
  if (envValue !== undefined) {
    if (parser) {
      return parser(envValue);
    }
    return envValue as T;
  }
  return configValue ?? defaultValue;
}

/**
 * 初始化配置
 */
export async function initConfig(): Promise<AppConfig> {
  const configFile = await loadConfigFile();

  loadedConfig = {
    server: {
      port: getValue('PORT', configFile?.server?.port, 3000, Number),
      host: getValue('HOST', configFile?.server?.host, '0.0.0.0'),
    },

    database: {
      url: getValue('DATABASE_URL', configFile?.database?.url, './data/airportal.db'),
    },

    jwt: {
      secret: getValue('JWT_SECRET', configFile?.jwt?.secret, 'dev-secret-change-in-production'),
      expiresIn: getValue('JWT_EXPIRES_IN', configFile?.jwt?.expiresIn, '7d'),
    },

    security: {
      fileValidation: {
        enabled: getValue('FILE_VALIDATION', configFile?.security?.fileValidation?.enabled, true, (v) => v !== 'false'),
      },
      ipBlacklist: {
        enabled: getValue('IP_BLACKLIST_ENABLED', configFile?.security?.ipBlacklist?.enabled, true, (v) => v !== 'false'),
        autoBlockThreshold: getValue('IP_AUTO_BLOCK_THRESHOLD', configFile?.security?.ipBlacklist?.autoBlockThreshold, 10, Number),
        autoBlockWindow: getValue('IP_AUTO_BLOCK_WINDOW', configFile?.security?.ipBlacklist?.autoBlockWindow, 60, Number),
        autoBlockDuration: getValue('IP_AUTO_BLOCK_DURATION', configFile?.security?.ipBlacklist?.autoBlockDuration, 3600, Number),
        whitelist: process.env.IP_WHITELIST?.split(',') ?? configFile?.security?.ipBlacklist?.whitelist ?? ['127.0.0.1', '::1'],
        blacklist: process.env.IP_BLACKLIST?.split(',') ?? configFile?.security?.ipBlacklist?.blacklist ?? [],
      },
      auditLog: {
        enabled: getValue('AUDIT_LOG', configFile?.security?.auditLog?.enabled, true, (v) => v !== 'false'),
      },
      rateLimit: {
        globalMax: getValue('RATE_LIMIT_MAX', configFile?.security?.rateLimit?.globalMax, 100, Number),
        globalWindowMs: getValue('RATE_LIMIT_WINDOW', configFile?.security?.rateLimit?.globalWindowMs, 60000, Number),
        uploadMax: getValue('UPLOAD_RATE_MAX', configFile?.security?.rateLimit?.uploadMax, 10, Number),
        uploadWindowMs: getValue('UPLOAD_RATE_WINDOW', configFile?.security?.rateLimit?.uploadWindowMs, 60000, Number),
      },
      securityPlugin: {
        enabled: getValue('SECURITY_PLUGIN_ENABLED', (configFile?.security as any)?.securityPlugin?.enabled, true, (v) => v !== 'false'),
        heuristic: {
          enabled: getValue('HEURISTIC_ENABLED', (configFile?.security as any)?.securityPlugin?.heuristic?.enabled, true, (v) => v !== 'false'),
          entropyThreshold: getValue('HEURISTIC_ENTROPY_THRESHOLD', (configFile?.security as any)?.securityPlugin?.heuristic?.entropyThreshold, 7.5, Number),
          maxScanSize: getValue('HEURISTIC_MAX_SCAN_SIZE', (configFile?.security as any)?.securityPlugin?.heuristic?.maxScanSize, 10485760, Number),
          rejectRiskThreshold: getValue('HEURISTIC_REJECT_THRESHOLD', (configFile?.security as any)?.securityPlugin?.heuristic?.rejectRiskThreshold, 70, Number),
          warnRiskThreshold: getValue('HEURISTIC_WARN_THRESHOLD', (configFile?.security as any)?.securityPlugin?.heuristic?.warnRiskThreshold, 40, Number),
          patterns: (configFile?.security as any)?.securityPlugin?.heuristic?.patterns ?? [],
        },
        behavior: {
          enabled: getValue('BEHAVIOR_ENABLED', (configFile?.security as any)?.securityPlugin?.behavior?.enabled, true, (v) => v !== 'false'),
          windowMs: getValue('BEHAVIOR_WINDOW_MS', (configFile?.security as any)?.securityPlugin?.behavior?.windowMs, 60000, Number),
          burstThreshold: getValue('BEHAVIOR_BURST_THRESHOLD', (configFile?.security as any)?.securityPlugin?.behavior?.burstThreshold, 5, Number),
          sizeMultiplierThreshold: getValue('BEHAVIOR_SIZE_MULTIPLIER', (configFile?.security as any)?.securityPlugin?.behavior?.sizeMultiplierThreshold, 3, Number),
          anomalyScoreThreshold: getValue('BEHAVIOR_ANOMALY_THRESHOLD', (configFile?.security as any)?.securityPlugin?.behavior?.anomalyScoreThreshold, 50, Number),
        },
      },
      upload: {
        maxFileSize: getValue('MAX_FILE_SIZE', configFile?.security?.upload?.maxFileSize, 52428800, Number),
        maxTextLength: getValue('MAX_TEXT_LENGTH', configFile?.security?.upload?.maxTextLength, 10000, Number),
        maxTotalStorage: getValue('MAX_TOTAL_STORAGE', configFile?.security?.upload?.maxTotalStorage, 1073741824, Number),
        blockedExtensions: configFile?.security?.upload?.blockedExtensions ?? ['.exe', '.bat', '.cmd', '.sh', '.ps1', '.vbs', '.msi'],
        folderUpload: {
          enabled: getValue('FOLDER_UPLOAD_ENABLED', (configFile?.security?.upload as any)?.folderUpload?.enabled, true, (v) => v !== 'false'),
          maxUncompressedSize: getValue('ZIP_MAX_UNCOMPRESSED_SIZE', (configFile?.security?.upload as any)?.folderUpload?.maxUncompressedSize, 524288000, Number),
          maxCompressionRatio: getValue('ZIP_MAX_COMPRESSION_RATIO', (configFile?.security?.upload as any)?.folderUpload?.maxCompressionRatio, 100, Number),
          maxEntries: getValue('ZIP_MAX_ENTRIES', (configFile?.security?.upload as any)?.folderUpload?.maxEntries, 10000, Number),
          maxFileNameLength: getValue('ZIP_MAX_FILENAME_LENGTH', (configFile?.security?.upload as any)?.folderUpload?.maxFileNameLength, 512, Number),
        },
      },
    },

    transfer: {
      codeLength: getValue('CODE_LENGTH', configFile?.transfer?.codeLength, 6, Number),
      defaultExpiry: getValue('DEFAULT_EXPIRY', configFile?.transfer?.defaultExpiry, 180, Number),
      maxExpiry: getValue('MAX_EXPIRY', configFile?.transfer?.maxExpiry, 3600, Number),
    },

    cleanup: {
      interval: getValue('CLEANUP_INTERVAL', configFile?.cleanup?.interval, 60, Number),
      runOnStart: getValue('CLEANUP_ON_START', configFile?.cleanup?.runOnStart, true, (v) => v !== 'false'),
      cleanFiles: getValue('CLEANUP_FILES', configFile?.cleanup?.cleanFiles, true, (v) => v !== 'false'),
      cleanRecords: getValue('CLEANUP_RECORDS', configFile?.cleanup?.cleanRecords, true, (v) => v !== 'false'),
      recordAction: getValue('CLEANUP_RECORD_ACTION', configFile?.cleanup?.recordAction, 'update') as 'update' | 'delete',
    },

    log: {
      level: getValue('LOG_LEVEL', configFile?.log?.level, 'info'),
      file: getValue('LOG_FILE', configFile?.log?.file, ''),
    },

    cors: {
      origins: process.env.ALLOWED_ORIGINS?.split(',') ?? configFile?.cors?.origins ?? ['http://localhost:3000'],
    },

    p2p: {
      enabled: getValue('P2P_ENABLED', (configFile as any)?.p2p?.enabled, true, (v) => v !== 'false'),
      maxFileSize: getValue('P2P_MAX_FILE_SIZE', (configFile as any)?.p2p?.maxFileSize, 524288000, Number),
      maxConcurrentTransfers: getValue('P2P_MAX_CONCURRENT', (configFile as any)?.p2p?.maxConcurrentTransfers, 3, Number),
      requestTimeout: getValue('P2P_REQUEST_TIMEOUT', (configFile as any)?.p2p?.requestTimeout, 60000, Number),
    },
  };

  return loadedConfig;
}

/**
 * 验证配置有效性
 */
export function validateConfig(config: AppConfig): string[] {
  const errors: string[] = [];

  if (!config.server.port || config.server.port < 1 || config.server.port > 65535) {
    errors.push('server.port 必须是 1-65535 之间的端口号');
  }
  if (!config.server.host) {
    errors.push('server.host 不能为空');
  }
  if (!config.jwt.secret || config.jwt.secret === 'dev-secret-change-in-production') {
    if (process.env.NODE_ENV === 'production') {
      errors.push('生产环境必须修改 JWT_SECRET');
    }
  }
  if (!config.jwt.expiresIn) {
    errors.push('jwt.expiresIn 不能为空');
  }
  if (config.security.rateLimit.globalMax < 1) {
    errors.push('security.rateLimit.globalMax 必须大于 0');
  }
  if (config.security.rateLimit.uploadMax < 1) {
    errors.push('security.rateLimit.uploadMax 必须大于 0');
  }
  if (config.security.upload.maxFileSize < 1) {
    errors.push('security.upload.maxFileSize 必须大于 0');
  }
  if (config.security.upload.maxTextLength < 1) {
    errors.push('security.upload.maxTextLength 必须大于 0');
  }
  if (config.security.upload.maxTotalStorage < config.security.upload.maxFileSize) {
    errors.push('security.upload.maxTotalStorage 不能小于 maxFileSize');
  }
  if (config.transfer.defaultExpiry < 1) {
    errors.push('transfer.defaultExpiry 必须大于 0');
  }
  if (config.transfer.maxExpiry < config.transfer.defaultExpiry) {
    errors.push('transfer.maxExpiry 不能小于 defaultExpiry');
  }
  if (config.cleanup.interval < 0) {
    errors.push('cleanup.interval 不能为负数');
  }
  if (!['update', 'delete'].includes(config.cleanup.recordAction)) {
    errors.push('cleanup.recordAction 必须为 update 或 delete');
  }
  if (config.security.upload.folderUpload) {
    if (config.security.upload.folderUpload.maxCompressionRatio < 1) {
      errors.push('security.upload.folderUpload.maxCompressionRatio 必须大于 0');
    }
    if (config.security.upload.folderUpload.maxEntries < 1) {
      errors.push('security.upload.folderUpload.maxEntries 必须大于 0');
    }
  }
  if (config.security.securityPlugin) {
    if (config.security.securityPlugin.heuristic) {
      if (config.security.securityPlugin.heuristic.rejectRiskThreshold < config.security.securityPlugin.heuristic.warnRiskThreshold) {
        errors.push('security.securityPlugin.heuristic.rejectRiskThreshold 不能小于 warnRiskThreshold');
      }
    }
    if (config.security.securityPlugin.behavior) {
      if (config.security.securityPlugin.behavior.windowMs < 1000) {
        errors.push('security.securityPlugin.behavior.windowMs 必须至少为 1000ms');
      }
    }
  }

  // P2P config validation
  if (config.p2p) {
    if (config.p2p.maxFileSize < 1) {
      errors.push('p2p.maxFileSize 必须大于 0');
    }
    if (config.p2p.maxConcurrentTransfers < 1) {
      errors.push('p2p.maxConcurrentTransfers 必须大于 0');
    }
    if (config.p2p.requestTimeout < 1000) {
      errors.push('p2p.requestTimeout 必须至少为 1000ms');
    }
  }

  return errors;
}

/**
 * 获取当前配置
 */
export function getConfig(): AppConfig {
  if (!loadedConfig) {
    throw new Error('Config not initialized. Call initConfig() first.');
  }
  return loadedConfig;
}

/**
 * 运行时更新配置（部分配置支持热更新）
 */
export function updateConfig(updates: Partial<AppConfig>): void {
  if (!loadedConfig) {
    throw new Error('Config not initialized');
  }
  loadedConfig = { ...loadedConfig, ...updates };
}

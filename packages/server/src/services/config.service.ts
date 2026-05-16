import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

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
  persistPath: string;
}

export interface SecurityPluginConfig {
  enabled: boolean;
  heuristic: SecurityPluginHeuristicConfig;
  behavior: SecurityPluginBehaviorConfig;
}

export interface ICEServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface P2PConfig {
  enabled: boolean;
  maxFileSize: number;
  maxConcurrentTransfers: number;
  requestTimeout: number;
  iceServers: ICEServer[];
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
    maxIpRecords: number;
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
    authMax: number;
    authWindowMs: number;
    authLockThreshold: number;
    authLockWindowMs: number;
    authLockDurationMs: number;
  };
  upload: {
    dir: string;
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
    rotation: {
      enabled: boolean;
      interval: number;
      maxSize: number;
      maxFiles: number;
      compress: boolean;
    };
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
    return envValue as unknown as T;
  }
  return configValue ?? defaultValue;
}

function getStringArray(envKey: string, fallback: string[]): string[] {
  const envValue = process.env[envKey];
  if (envValue !== undefined) {
    return envValue.split(',').map(s => s.trim()).filter(Boolean);
  }
  return fallback;
}

/**
 * 加载 ICE 服务器配置（STUN + TURN）
 */
function loadICEServers(configFile: Partial<AppConfig> | null): ICEServer[] {
  const servers: ICEServer[] = [];

  // 默认 STUN 服务器
  const defaultStun = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

  // 从环境变量或配置文件加载 STUN
  const stunUrls = process.env.STUN_URLS
    ? process.env.STUN_URLS.split(',').map(s => s.trim()).filter(Boolean)
    : configFile?.p2p?.iceServers
      ?.filter((s) => s.urls.toString().startsWith('stun:'))
      ?.map((s) => ({ urls: s.urls }));

  if (stunUrls && stunUrls.length > 0) {
    for (const url of stunUrls) {
      servers.push(typeof url === 'string' ? { urls: url } : url as ICEServer);
    }
  } else {
    servers.push(...defaultStun);
  }

  // 从环境变量加载 TURN（必须提供用户名和密码）
  const turnUrl = process.env.TURN_URL;
  const turnUsername = process.env.TURN_USERNAME;
  const turnCredential = process.env.TURN_CREDENTIAL;

  if (turnUrl && turnUsername && turnCredential) {
    servers.push({
      urls: turnUrl,
      username: turnUsername,
      credential: turnCredential,
    });
  }

  // 从配置文件加载 TURN
  const configTurn = configFile?.p2p?.iceServers
    ?.filter((s) => {
      const urls = s.urls.toString();
      return urls.startsWith('turn:') || urls.startsWith('turns:');
    });

  if (configTurn) {
    for (const server of configTurn) {
      if (!servers.some((s) => s.urls === server.urls)) {
        servers.push(server);
      }
    }
  }

  return servers;
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
      secret: getValue('JWT_SECRET', configFile?.jwt?.secret, crypto.randomBytes(32).toString('hex')),
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
        maxIpRecords: getValue('IP_MAX_RECORDS', configFile?.security?.ipBlacklist?.maxIpRecords, 10000, Number),
        whitelist: getStringArray('IP_WHITELIST', configFile?.security?.ipBlacklist?.whitelist ?? ['127.0.0.1', '::1']),
        blacklist: getStringArray('IP_BLACKLIST', configFile?.security?.ipBlacklist?.blacklist ?? []),
      },
      auditLog: {
        enabled: getValue('AUDIT_LOG', configFile?.security?.auditLog?.enabled, true, (v) => v !== 'false'),
      },
      rateLimit: {
        globalMax: getValue('RATE_LIMIT_MAX', configFile?.security?.rateLimit?.globalMax, 100, Number),
        globalWindowMs: getValue('RATE_LIMIT_WINDOW', configFile?.security?.rateLimit?.globalWindowMs, 60000, Number),
        uploadMax: getValue('UPLOAD_RATE_MAX', configFile?.security?.rateLimit?.uploadMax, 10, Number),
        uploadWindowMs: getValue('UPLOAD_RATE_WINDOW', configFile?.security?.rateLimit?.uploadWindowMs, 60000, Number),
        authMax: getValue('AUTH_RATE_MAX', configFile?.security?.rateLimit?.authMax, 5, Number),
        authWindowMs: getValue('AUTH_RATE_WINDOW', configFile?.security?.rateLimit?.authWindowMs, 60000, Number),
        authLockThreshold: getValue('AUTH_LOCK_THRESHOLD', configFile?.security?.rateLimit?.authLockThreshold, 5, Number),
        authLockWindowMs: getValue('AUTH_LOCK_WINDOW', configFile?.security?.rateLimit?.authLockWindowMs, 300000, Number),
        authLockDurationMs: getValue('AUTH_LOCK_DURATION', configFile?.security?.rateLimit?.authLockDurationMs, 300000, Number),
      },
      securityPlugin: {
        enabled: getValue('SECURITY_PLUGIN_ENABLED', configFile?.security?.securityPlugin?.enabled, true, (v) => v !== 'false'),
        heuristic: {
          enabled: getValue('HEURISTIC_ENABLED', configFile?.security?.securityPlugin?.heuristic?.enabled, true, (v) => v !== 'false'),
          entropyThreshold: getValue('HEURISTIC_ENTROPY_THRESHOLD', configFile?.security?.securityPlugin?.heuristic?.entropyThreshold, 7.5, Number),
          maxScanSize: getValue('HEURISTIC_MAX_SCAN_SIZE', configFile?.security?.securityPlugin?.heuristic?.maxScanSize, 10485760, Number),
          rejectRiskThreshold: getValue('HEURISTIC_REJECT_THRESHOLD', configFile?.security?.securityPlugin?.heuristic?.rejectRiskThreshold, 70, Number),
          warnRiskThreshold: getValue('HEURISTIC_WARN_THRESHOLD', configFile?.security?.securityPlugin?.heuristic?.warnRiskThreshold, 40, Number),
          patterns: configFile?.security?.securityPlugin?.heuristic?.patterns ?? [],
        },
        behavior: {
          enabled: getValue('BEHAVIOR_ENABLED', configFile?.security?.securityPlugin?.behavior?.enabled, true, (v) => v !== 'false'),
          windowMs: getValue('BEHAVIOR_WINDOW_MS', configFile?.security?.securityPlugin?.behavior?.windowMs, 60000, Number),
          burstThreshold: getValue('BEHAVIOR_BURST_THRESHOLD', configFile?.security?.securityPlugin?.behavior?.burstThreshold, 5, Number),
          sizeMultiplierThreshold: getValue('BEHAVIOR_SIZE_MULTIPLIER', configFile?.security?.securityPlugin?.behavior?.sizeMultiplierThreshold, 3, Number),
          anomalyScoreThreshold: getValue('BEHAVIOR_ANOMALY_THRESHOLD', configFile?.security?.securityPlugin?.behavior?.anomalyScoreThreshold, 50, Number),
          persistPath: getValue('BEHAVIOR_PERSIST_PATH', configFile?.security?.securityPlugin?.behavior?.persistPath, ''),
        },
      },
      upload: {
        dir: getValue('UPLOAD_DIR', configFile?.security?.upload?.dir, 'uploads'),
        maxFileSize: getValue('MAX_FILE_SIZE', configFile?.security?.upload?.maxFileSize, 52428800, Number),
        maxTextLength: getValue('MAX_TEXT_LENGTH', configFile?.security?.upload?.maxTextLength, 10000, Number),
        maxTotalStorage: getValue('MAX_TOTAL_STORAGE', configFile?.security?.upload?.maxTotalStorage, 1073741824, Number),
        blockedExtensions: configFile?.security?.upload?.blockedExtensions ?? ['.exe', '.bat', '.cmd', '.sh', '.ps1', '.vbs', '.msi'],
        folderUpload: {
          enabled: getValue('FOLDER_UPLOAD_ENABLED', configFile?.security?.upload?.folderUpload?.enabled, true, (v) => v !== 'false'),
          maxUncompressedSize: getValue('ZIP_MAX_UNCOMPRESSED_SIZE', configFile?.security?.upload?.folderUpload?.maxUncompressedSize, 524288000, Number),
          maxCompressionRatio: getValue('ZIP_MAX_COMPRESSION_RATIO', configFile?.security?.upload?.folderUpload?.maxCompressionRatio, 100, Number),
          maxEntries: getValue('ZIP_MAX_ENTRIES', configFile?.security?.upload?.folderUpload?.maxEntries, 10000, Number),
          maxFileNameLength: getValue('ZIP_MAX_FILENAME_LENGTH', configFile?.security?.upload?.folderUpload?.maxFileNameLength, 512, Number),
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
      rotation: {
        enabled: getValue('LOG_ROTATION_ENABLED', configFile?.log?.rotation?.enabled, false, (v) => v !== 'false'),
        interval: getValue('LOG_ROTATION_INTERVAL', configFile?.log?.rotation?.interval, 0, Number),
        maxSize: getValue('LOG_ROTATION_MAX_SIZE', configFile?.log?.rotation?.maxSize, 10485760, Number),
        maxFiles: getValue('LOG_ROTATION_MAX_FILES', configFile?.log?.rotation?.maxFiles, 5, Number),
        compress: getValue('LOG_ROTATION_COMPRESS', configFile?.log?.rotation?.compress, false, (v) => v !== 'false'),
      },
    },

    cors: {
      origins: process.env.ALLOWED_ORIGINS?.split(',').map(s => s.trim()).filter(Boolean) ?? configFile?.cors?.origins ?? ['http://localhost:3000'],
    },

    p2p: {
      enabled: getValue('P2P_ENABLED', configFile?.p2p?.enabled, true, (v) => v !== 'false'),
      maxFileSize: getValue('P2P_MAX_FILE_SIZE', configFile?.p2p?.maxFileSize, 524288000, Number),
      maxConcurrentTransfers: getValue('P2P_MAX_CONCURRENT', configFile?.p2p?.maxConcurrentTransfers, 3, Number),
      requestTimeout: getValue('P2P_REQUEST_TIMEOUT', configFile?.p2p?.requestTimeout, 60000, Number),
      iceServers: loadICEServers(configFile),
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
    if (!config.p2p.iceServers || config.p2p.iceServers.length === 0) {
      errors.push('p2p.iceServers 必须至少配置一个 STUN 服务器');
    }
    // Validate TURN servers have required credentials
    for (const server of config.p2p.iceServers) {
      const urls = server.urls.toString();
      if (urls.startsWith('turn:') || urls.startsWith('turns:')) {
        if (!server.username || !server.credential) {
          errors.push(`p2p.iceServers TURN 服务器 (${urls}) 必须配置 username 和 credential`);
        }
      }
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
 * Deep merge helper — recursively merges partial updates into the target
 */
function deepMerge<T>(target: T, source: Partial<T>): T {
  const result = { ...target } as T;
  for (const key of Object.keys(source) as (keyof T)[]) {
    const sourceVal = source[key];
    const targetVal = result[key];
    if (
      sourceVal !== undefined && sourceVal !== null && typeof sourceVal === 'object' && !Array.isArray(sourceVal) &&
      targetVal !== undefined && targetVal !== null && typeof targetVal === 'object' && !Array.isArray(sourceVal)
    ) {
      result[key] = deepMerge(targetVal, sourceVal as Partial<typeof targetVal>) as T[keyof T];
    } else if (sourceVal !== undefined) {
      result[key] = sourceVal as T[keyof T];
    }
  }
  return result;
}

/**
 * 运行时更新配置（部分配置支持热更新）
 */
export function updateConfig(updates: Partial<AppConfig>): void {
  if (!loadedConfig) {
    throw new Error('Config not initialized');
  }
  loadedConfig = deepMerge(loadedConfig, updates);
}

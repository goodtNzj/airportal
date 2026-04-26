import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

let loadedConfig: AppConfig | null = null;

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
    blockedExtensions: string[];
  };
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
      upload: {
        maxFileSize: getValue('MAX_FILE_SIZE', configFile?.security?.upload?.maxFileSize, 52428800, Number),
        maxTextLength: getValue('MAX_TEXT_LENGTH', configFile?.security?.upload?.maxTextLength, 10000, Number),
        blockedExtensions: configFile?.security?.upload?.blockedExtensions ?? ['.exe', '.bat', '.cmd', '.sh', '.ps1', '.vbs', '.msi'],
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
      origins: process.env.ALLOWED_ORIGINS?.split(',') ?? configFile?.cors?.origins ?? ['http://localhost:5173'],
    },
  };

  return loadedConfig;
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

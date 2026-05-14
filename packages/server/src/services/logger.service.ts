import fs from 'fs/promises';
import path from 'path';
import zlib from 'zlib';
import { promisify } from 'util';
import { getConfig } from '../config/index.js';

const gzip = promisify(zlib.gzip);

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const MAX_PENDING_WRITES = 100;

class Logger {
  private level: number = LOG_LEVELS.info;
  private logFile: string | null = null;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  private rotationEnabled = false;
  private rotationInterval = 0;
  private rotationMaxSize = 10 * 1024 * 1024;
  private rotationMaxFiles = 5;
  private rotationCompress = false;

  private lastRotationTime = 0;
  private writePromise = Promise.resolve();
  private pendingWrites = 0;

  private async ensureInit(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.init();
    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  async init() {
    const config = getConfig();
    this.level = LOG_LEVELS[config.log.level as LogLevel] ?? LOG_LEVELS.info;
    if (config.log.file) {
      this.logFile = path.resolve(config.log.file);
    }
    if (config.log.rotation) {
      this.rotationEnabled = config.log.rotation.enabled ?? false;
      this.rotationInterval = config.log.rotation.interval ?? 0;
      this.rotationMaxSize = config.log.rotation.maxSize ?? 10 * 1024 * 1024;
      this.rotationMaxFiles = config.log.rotation.maxFiles ?? 5;
      this.rotationCompress = config.log.rotation.compress ?? false;
    }

    if (this.logFile && this.rotationEnabled && this.rotationInterval > 0) {
      await this.initLastRotationTime();
    }
    this.initialized = true;
  }

  private async initLastRotationTime() {
    try {
      const stat = await fs.stat(this.logFile!);
      this.lastRotationTime = stat.mtimeMs;
    } catch {
      this.lastRotationTime = Date.now();
    }
  }

  private async ensureLogDir() {
    if (this.logFile) {
      const dir = path.dirname(this.logFile);
      await fs.mkdir(dir, { recursive: true }).catch(() => {});
    }
  }

  private async getFileSize(): Promise<number> {
    if (!this.logFile) return 0;
    try {
      const stat = await fs.stat(this.logFile);
      return stat.size;
    } catch {
      return 0;
    }
  }

  private ts(date: Date): string {
    const Y = date.getFullYear();
    const M = String(date.getMonth() + 1).padStart(2, '0');
    const D = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    const s = String(date.getSeconds()).padStart(2, '0');
    return `${Y}-${M}-${D}-${h}${m}${s}`;
  }

  private async rotateTimeBased() {
    if (!this.logFile) return;

    const stamp = this.ts(new Date());
    const backup = `${this.logFile}.${stamp}`;
    await fs.rename(this.logFile, backup).catch(() => {});

    if (this.rotationCompress) {
      this.compressAsync(backup);
    }

    await this.cleanupOldFiles();
  }

  private async rotateSizeBased() {
    if (!this.logFile) return;

    const oldest = `${this.logFile}.${this.rotationMaxFiles}`;
    await fs.unlink(oldest).catch(() => {});

    for (let i = this.rotationMaxFiles - 1; i >= 1; i--) {
      const src = `${this.logFile}.${i}`;
      const dst = `${this.logFile}.${i + 1}`;
      await fs.rename(src, dst).catch(() => {});
    }

    await fs.rename(this.logFile, `${this.logFile}.1`).catch(() => {});

    // compress inline (await) — shift is done, no race
    if (this.rotationCompress) {
      await this.compressAsync(`${this.logFile}.1`);
    }
  }

  private async cleanupOldFiles() {
    if (!this.logFile || this.rotationMaxFiles <= 0) return;

    const dir = path.dirname(this.logFile);
    const base = path.basename(this.logFile);

    try {
      const entries = await fs.readdir(dir);
      const rotated = entries
        .filter(f => f.startsWith(base + '.'))
        .sort();

      while (rotated.length > this.rotationMaxFiles) {
        const oldest = rotated.shift()!;
        await fs.unlink(path.join(dir, oldest)).catch(() => {});
      }
    } catch {
      // ignore
    }
  }

  private async compressAsync(filePath: string) {
    try {
      const content = await fs.readFile(filePath);
      const compressed = await gzip(content);
      await fs.writeFile(filePath + '.gz', compressed);
      await fs.unlink(filePath);
    } catch {
      // compression failure should not block logging
    }
  }

  private formatMessage(level: LogLevel, message: string, meta?: Record<string, unknown>): string {
    const timestamp = new Date().toISOString();
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`;
  }

  private async enqueueWrite(fn: () => Promise<void>): Promise<void> {
    this.pendingWrites++;
    if (this.pendingWrites > MAX_PENDING_WRITES) {
      this.pendingWrites--;
      console.warn('Logger: dropping log message due to queue overflow');
      return;
    }

    const prev = this.writePromise;
    this.writePromise = (async () => {
      try {
        await prev;
        await fn();
      } catch (err) {
        console.error('Logger: file write failed', err);
      } finally {
        this.pendingWrites--;
      }
    })();
    return this.writePromise;
  }

  private async write(level: LogLevel, message: string, meta?: Record<string, unknown>) {
    await this.ensureInit();
    if (LOG_LEVELS[level] < this.level) return;

    const formatted = this.formatMessage(level, message, meta);

    const consoleMethod = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
    console[consoleMethod](formatted);

    if (this.logFile) {
      this.enqueueWrite(async () => {
        await this.ensureLogDir();
        if (this.rotationEnabled) {
          await this.rotateIfNeeded();
        }
        await fs.appendFile(this.logFile!, formatted + '\n');
      });
    }
  }

  private async rotateIfNeeded() {
    if (!this.logFile) return;

    const now = Date.now();

    if (this.rotationInterval > 0) {
      if (now - this.lastRotationTime >= this.rotationInterval * 1000) {
        await this.rotateTimeBased();
        this.lastRotationTime = now;
      }
    } else if (this.rotationMaxSize > 0) {
      const size = await this.getFileSize();
      if (size >= this.rotationMaxSize) {
        await this.rotateSizeBased();
      }
    }
  }

  async debug(message: string, meta?: Record<string, unknown>) {
    return this.write('debug', message, meta);
  }

  async info(message: string, meta?: Record<string, unknown>) {
    return this.write('info', message, meta);
  }

  async warn(message: string, meta?: Record<string, unknown>) {
    return this.write('warn', message, meta);
  }

  async error(message: string, meta?: Record<string, unknown>) {
    return this.write('error', message, meta);
  }
}

export const logger = new Logger();

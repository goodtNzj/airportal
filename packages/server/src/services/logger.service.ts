import fs from 'fs/promises';
import path from 'path';
import { getConfig } from '../config/index.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

class Logger {
  private level: number = LOG_LEVELS.info;
  private logFile: string | null = null;
  private initialized = false;

  init() {
    const config = getConfig();
    this.level = LOG_LEVELS[config.log.level as LogLevel] ?? LOG_LEVELS.info;
    if (config.log.file) {
      this.logFile = path.resolve(config.log.file);
      this.ensureLogDir();
    }
    this.initialized = true;
  }

  private async ensureLogDir() {
    if (this.logFile) {
      const dir = path.dirname(this.logFile);
      await fs.mkdir(dir, { recursive: true }).catch(() => {});
    }
  }

  private formatMessage(level: LogLevel, message: string, meta?: Record<string, unknown>): string {
    const timestamp = new Date().toISOString();
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`;
  }

  private async write(level: LogLevel, message: string, meta?: Record<string, unknown>) {
    if (!this.initialized) {
      this.init();
    }
    if (LOG_LEVELS[level] < this.level) return;

    const formatted = this.formatMessage(level, message, meta);

    // 控制台输出
    const consoleMethod = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
    console[consoleMethod](formatted);

    // 文件输出
    if (this.logFile) {
      await fs.appendFile(this.logFile, formatted + '\n').catch(() => {});
    }
  }

  debug(message: string, meta?: Record<string, unknown>) {
    return this.write('debug', message, meta);
  }

  info(message: string, meta?: Record<string, unknown>) {
    return this.write('info', message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>) {
    return this.write('warn', message, meta);
  }

  error(message: string, meta?: Record<string, unknown>) {
    return this.write('error', message, meta);
  }
}

export const logger = new Logger();

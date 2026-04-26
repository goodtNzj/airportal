import { beforeAll, afterAll, vi } from 'vitest';

// 模拟环境变量
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test/test.db';
process.env.JWT_SECRET = 'test-secret-key';
process.env.FILE_VALIDATION = 'true';
process.env.IP_BLACKLIST_ENABLED = 'true';
process.env.AUDIT_LOG = 'false'; // 测试时关闭审计日志

// 模拟 console.log 以减少测试输出噪音
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

import dotenv from 'dotenv';
dotenv.config();

import { initConfig, getConfig, updateConfig } from '../services/config.service.js';

// 导出配置函数
export { initConfig, getConfig, updateConfig };

// 便捷访问：在 initConfig 后使用
export const config = new Proxy({} as ReturnType<typeof getConfig>, {
  get(_, prop) {
    return getConfig()[prop as keyof ReturnType<typeof getConfig>];
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: {
      // 可以在这里添加全局变量
    },
  },
  resolve: {
    alias: {
      // 可以在这里添加路径别名
    },
  },
});

import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // 后台挂在 /admin/ 下：资源路径必须带前缀，否则 /assets/... 会打到店面去
  base: '/admin/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // 工作区源码包直接参与构建，不做依赖预打包
  optimizeDeps: {
    exclude: ['@mall/ui', '@mall/sdk', '@mall/design-tokens'],
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});

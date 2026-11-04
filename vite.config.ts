import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
export default defineConfig({
  base: process.env.BASE_PATH || '/',
  plugins: [react()],
  build: { rollupOptions: { input: { main: resolve(__dirname, 'index.html'), app: resolve(__dirname, 'app/index.html') } } },
  test: { environment: 'jsdom', setupFiles: ['./tests/setup.ts'], include: ['tests/**/*.test.ts?(x)'] },
} as any);

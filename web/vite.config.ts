import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const apiTarget = `http://${process.env.API_HOST ?? '127.0.0.1'}:${process.env.API_PORT ?? '3001'}`;

// `vite build --mode pages`: the GitHub Pages demo (static, API in the browser).
export default defineConfig(({ mode }) => ({
  base: mode === 'pages' ? (process.env.PAGES_BASE ?? '/safarsaathi/') : '/',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': apiTarget },
    // The demo bundles ../docs/site-help.md.
    fs: { allow: ['..'] },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
}));

import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: '@omnivate/ui/styles.css',
        replacement: fileURLToPath(new URL('../../packages/ui/src/styles.css', import.meta.url)),
      },
      {
        find: '@omnivate/ui',
        replacement: fileURLToPath(new URL('../../packages/ui/src/index.ts', import.meta.url)),
      },
      {
        find: '@omnivate/shared',
        replacement: fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
      },
    ],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});

import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@omnivate/shared': fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url)),
      '@omnivate/db': fileURLToPath(new URL('./packages/db/src/index.ts', import.meta.url)),
      '@omnivate/kernel': fileURLToPath(new URL('./packages/kernel/src/index.ts', import.meta.url)),
      '@omnivate/module-ana-03': fileURLToPath(
        new URL('./modules/ana-03-reports/src/index.ts', import.meta.url),
      ),
      '@omnivate/module-krn-01': fileURLToPath(
        new URL('./modules/krn-01-identity/src/index.ts', import.meta.url),
      ),
      '@omnivate/module-krn-02': fileURLToPath(
        new URL('./modules/krn-02-party-directory/src/index.ts', import.meta.url),
      ),
      '@omnivate/module-krn-03': fileURLToPath(
        new URL('./modules/krn-03-branches/src/index.ts', import.meta.url),
      ),
      '@omnivate/module-krn-04': fileURLToPath(
        new URL('./modules/krn-04-workflows/src/index.ts', import.meta.url),
      ),
      '@omnivate/module-krn-06': fileURLToPath(
        new URL('./modules/krn-06-migration/src/index.ts', import.meta.url),
      ),
      '@omnivate/module-platform-control': fileURLToPath(
        new URL('./modules/platform-control/src/index.ts', import.meta.url),
      ),
      '@omnivate/module-doc-capture': fileURLToPath(
        new URL('./modules/doc-capture/src/index.ts', import.meta.url),
      ),
      '@omnivate/module-scm-01': fileURLToPath(
        new URL('./modules/scm-01-catalog/src/index.ts', import.meta.url),
      ),
      '@omnivate/module-fin-01': fileURLToPath(
        new URL('./modules/fin-01-ledger/src/index.ts', import.meta.url),
      ),
      '@omnivate/module-fin-03': fileURLToPath(new URL('./modules/fin-03-creditors/src/index.ts', import.meta.url)),
      '@omnivate/module-fin-04': fileURLToPath(new URL('./modules/fin-04-cashbook/src/index.ts', import.meta.url)),
      '@omnivate/module-fin-05': fileURLToPath(new URL('./modules/fin-05-petty-cash/src/index.ts', import.meta.url)),
      '@omnivate/module-fin-06': fileURLToPath(new URL('./modules/fin-06-tax/src/index.ts', import.meta.url)),
      '@omnivate/finance-api': fileURLToPath(new URL('./packages/finance-api/src/index.ts', import.meta.url)),
      '@omnivate/module-o2c': fileURLToPath(
        new URL('./modules/o2c-sales/src/index.ts', import.meta.url),
      ),
      '@omnivate/ui': fileURLToPath(new URL('./packages/ui/src/index.ts', import.meta.url)),
    },
  },
  test: {
    setupFiles: ['./vitest.setup.ts'],
    globalSetup: ['./vitest.global-setup.ts'],
    include: [
      'packages/**/test/**/*.test.ts',
      'modules/**/test/**/*.test.ts',
      'apps/**/test/**/*.test.ts',
      'apps/**/test/**/*.test.tsx',
    ],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', 'docs/blueprint/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['apps/api/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@omnivate/db', '@omnivate/db/*'],
              message:
                'The API talks to the database through @omnivate/kernel so tenant rules stay in one place.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['modules/**/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@omnivate/db', '@omnivate/db/*'],
              message:
                'Modules talk to the database through @omnivate/kernel so tenant rules stay in one place.',
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      'apps/web/**/*.{ts,tsx}',
      'apps/control-panel/**/*.{ts,tsx}',
      'packages/ui/**/*.{ts,tsx}',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@omnivate/db', '@omnivate/db/*', '@omnivate/kernel', '@omnivate/kernel/*'],
              message:
                'The browser may import @omnivate/shared only. Kernel and database code stay on the server.',
            },
          ],
        },
      ],
    },
  },
);

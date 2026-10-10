import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    test: {
      globals: true,
      environment: 'jsdom',
    },
  },
  {
    extends: './vitest.workspace.ts',
    include: ['packages/webflix-*/**/*.{test,spec}.{js,ts,jsx,tsx}'],
    exclude: ['node_modules', 'dist', 'build'],
  },
]);
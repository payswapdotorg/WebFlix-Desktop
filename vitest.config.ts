import { defineConfig } from 'vitest/config';

// D2 test substrate (contract freeze 5549208): unit tests across the
// webflix packages; integration tests are separated by config file so
// `pnpm test:unit` stays fast and hermetic.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/webflix-*/src/**/*.{test,spec}.ts'],
    exclude: ['**/*.int.test.ts', '**/*.int.spec.ts', '**/node_modules/**'],
  },
});

import { defineConfig } from 'vitest/config';

// D2 integration suite: full lifecycle tests (store, migrations,
// backup/restore) — still hermetic (temp dirs), just heavier.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/{webflix-*,local-library}/src/**/*.int.{test,spec}.ts'],
  },
});

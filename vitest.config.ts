import { defineConfig } from 'vitest/config';

// ponytail: exists so vitest stops walking up and loading an unrelated
// vite.config.js from a parent directory. Tests are plain node units.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});

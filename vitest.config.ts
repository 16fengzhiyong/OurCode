import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@electron': resolve(__dirname, 'electron'),
      '@shared': resolve(__dirname, 'shared'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/__tests__/**/*.test.ts', 'electron/__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/stores/**/*.ts', 'src/services/**/*.ts', 'electron/services/**/*.ts'],
    },
  },
})

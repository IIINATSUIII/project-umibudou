import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'node',
    pool: 'forks',
    maxWorkers: 2,
    setupFiles: ['./src/lib/__tests__/setup.ts'],
  },
})

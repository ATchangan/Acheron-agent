import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    setupFiles: ['src/test-setup.ts'],
    environment: 'node',
    include: ['src/**/*.test.ts', 'electron/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/store/session-state.ts', 'src/store/interject.ts'],
      reporter: ['text', 'json-summary'],
    },
  },
})

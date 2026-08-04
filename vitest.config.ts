import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'electron/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/store/session-state.ts', 'src/store/context.ts', 'src/components/plan-utils.ts', 'src/components/code-data.ts', 'src/store/constants.ts'],
      reporter: ['text', 'json-summary'],
    },
  },
})

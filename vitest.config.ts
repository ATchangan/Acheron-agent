import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'electron/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/store/session-state.ts', 'src/components/plan-utils.ts', 'src/store/model-pick.ts', 'src/store/interject.ts'],
      reporter: ['text', 'json-summary'],
    },
  },
})

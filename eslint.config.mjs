// v0.3.7: 渐进式 ESLint 配置 —— 只开关键规则, 历史代码噪音规则先放宽, 后续逐步收紧
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['dist/**', 'dist-electron/**', 'node_modules/**', 'release/**', 'scripts/**', 'resources/**', '*.config.*', '*.d.ts'],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      // 关键: 未使用变量/参数(tsconfig 未开 noUnusedLocals, 由 lint 补上)
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      // 历史代码大量 any/ts-ignore, 先降级避免噪音, 后续逐步清理
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      // 风格基础: 空块只警告(项目大量 catch{} 吞错是历史问题, 先可见后治理)
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-console': 'warn',
      eqeqeq: ['warn', 'smart'],
      'prefer-const': 'warn',
      'no-var': 'error',
    },
  },
)

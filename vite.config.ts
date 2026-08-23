import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  root: 'src',
  base: './',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'src/index.html'),
      output: {
        // 分包: 框架/图标/流式渲染栈/状态 独立 chunk, 首屏与更新后缓存更友好
        manualChunks: {
          react: ['react', 'react-dom'],
          icons: ['lucide-react'],
          stream: ['@streamdown/code', '@streamdown/math', '@assistant-ui/react-streamdown', 'katex'],
          state: ['zustand'],
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
})

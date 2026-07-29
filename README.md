# 黄泉Agent

桌面级 AI 助手。基于 Electron + React + TypeScript。

## 快速开始

```bash
# 安装依赖
npm install

# 开发模式
npm run dev

# 构建
npm run build

# 启动 (构建后)
npm start

# 打包为安装程序
npm run package:win
```

## 架构

```
huangquan-agent/
├── electron/          # Electron 主进程
│   ├── main.ts        # 窗口、IPC、系统托盘
│   └── preload.ts     # 安全桥接
├── src/               # 渲染进程 (React)
│   ├── components/    # UI 组件
│   ├── store/         # 状态管理 (Zustand)
│   ├── styles/        # 全局样式
│   └── global.d.ts    # 类型定义
├── resources/         # 图标等资源
└── electron-builder.yml
```

## 功能

- [x] 多 Provider 支持 (DeepSeek / OpenAI / 兼容 API)
- [x] 流式对话
- [x] 会话管理 (创建/切换/删除)
- [x] Markdown 渲染
- [x] 系统托盘
- [x] 本地数据持久化

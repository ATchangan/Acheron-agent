// src/store/context.ts —— 上下文纯函数兼容导出(0.3.9 结构清理)
// 上下文构建已由主进程 electron/engine/context.ts 接管, 渲染层只保留共享纯函数 re-export
import { slimToolResult, slimToolCallArgs, buildTaskArchives, TaskArchive } from '../../electron/shared/context-utils'
export { slimToolResult, slimToolCallArgs, buildTaskArchives }
export type { TaskArchive }

export { calibrateTokens, getCalibrationScale, estimateTokens, outputLimit, sessionTokens, getModelContextLimit, updateContextLimit, isVisionModel } from './context-utils'

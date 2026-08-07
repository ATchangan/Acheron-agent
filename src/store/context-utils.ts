import { calibrateTokens, getCalibrationScale, isVisionModel, estimateTokens as sharedEstimateTokens, outputLimit as sharedOutputLimit, getModelContextLimit as sharedGetModelContextLimit } from '../../electron/shared/context-utils'
export { calibrateTokens, getCalibrationScale, isVisionModel, sharedOutputLimit as outputLimit, sharedGetModelContextLimit as getModelContextLimit }
// src/store/context-utils.ts —— 上下文纯函数工具(token 估算/校准/模型窗口/输出分级)
// 从 context.ts 拆出(单文件上限红线), context.ts re-export 保持调用方兼容
import { useChatStore } from './chat'
import type { Message } from '../global'

// v0.3.4 T1: 按模型隔离的实测校准系数(初始 1.0, EMA 平滑, 限幅 0.3~3 防单次异常拉偏)

// v0.3.4 T1: 分层估算 —— 实现已抽至 shared/context-utils（B6-2），此处只接当前模型
export function estimateTokens(text: string): number {
  return sharedEstimateTokens(text, useChatStore.getState().curModel || '')
}

// v0.3.2 T7: 输出上限分级 —— 实现已抽至 shared/context-utils（B6-2）

// v0.3.2 T8: 会话累计 token 统计 —— 从消息 usage 重算(不新增存储; 兼容 input/output 两种命名)
export function sessionTokens(msgs: Message[]): { input: number; output: number } {
  let input = 0, output = 0
  for (const m of msgs) {
    const u = m.usage
    if (!u) continue
    input += u.input_tokens || u.prompt_tokens || 0
    output += (u as { output_tokens?: number }).output_tokens || u.completion_tokens || 0
  }
  return { input, output }
}

// 上下文窗口查询已抽至 shared/context-utils（B6-2）
function updateContextLimit(modelName: string) {
  const limit = sharedGetModelContextLimit(modelName)
  const s = useChatStore.getState()
  if (s.cl !== limit) useChatStore.setState({ cl: limit })
}
// 导出供外部调用（模型切换时实时更新）
export { updateContextLimit }

import { MAX_HISTORY_MSGS, COMPACT_MSG_DEFAULT, COMPACT_TOKEN_DEFAULT, COMPACT_RATIO_DEFAULT, CACHE_TTL, WORKFLOWS, VISION_MODEL_HINTS, DOMAIN_RE } from '../../electron/shared/constants'
export { MAX_HISTORY_MSGS, COMPACT_MSG_DEFAULT, COMPACT_TOKEN_DEFAULT, COMPACT_RATIO_DEFAULT, CACHE_TTL, WORKFLOWS, VISION_MODEL_HINTS, DOMAIN_RE }

// src/store/constants.ts — 纯数据常量(缓存 TTL/工作流模板/视觉模型提示/路由领域词)
// 从 chat.ts 拆分, 降低单文件复杂度
// v0.3.0 M2: 魔法数字统一(取值=现有代码实际值, 禁止顺手优化)
export const STREAM_THROTTLE_MS = 40       // 流式渲染节流
export const TOOL_ROUND_DEFAULT = 50       // 工具轮次上限默认值(设置项 maxToolRounds 兜底)
// 压缩阈值默认占比 0.7 —— v0.3.4 T4 基准说明: 以 scripts/token-baseline.mjs 三档(0.60/0.70/0.80)
// 对比后写入最终决策; 当前维持 0.7(数据待真实模型跑数后回填)








// ─── Codex 吸收: 项目指令文件(AGENTS.md)上下文缓存 ───
// 工作目录的 AGENTS.md / .agents.md 约定在任务开始时读取一次, 注入 system prompt 尾部
let projectCtx: { file: string; content: string } = { file: '', content: '' }
export function setProjectContext(c: { file: string; content: string }): void { projectCtx = c }
export function getProjectContext(): { file: string; content: string } { return projectCtx }

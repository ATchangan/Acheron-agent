// ─── 项目约定文件上下文缓存 ───
// 工作目录的项目约定文件(AGENTS.md / .agents.md)在任务开始时读取一次, 注入 system prompt 尾部
let projectCtx: { file: string; content: string } = { file: '', content: '' }
export function setProjectContext(c: { file: string; content: string }): void { projectCtx = c }
export function getProjectContext(): { file: string; content: string } { return projectCtx }

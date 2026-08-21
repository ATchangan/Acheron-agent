# Acheron-agent

开源仓库：[ATchangan/Acheron-agent](https://github.com/ATchangan/Acheron-agent)

一个本地优先的 Windows 桌面 AI 助手：能读写文件、执行命令、搜索网页、定时干活，并调度一支多角色 Agent 编队并行协作。

![主界面](docs/screenshot-home.png)

## 功能亮点

- **独立内核 AgentEngine**：Agent 主循环、工具分发、记忆、计划全部在主进程，渲染层只消费事件流；支持断点恢复、计划确认门、执行计划卡与自动复盘
- **多角色编队**：主控 / 文档 / 安全 / 通知 / 陪伴 / 设计 / 开发，各自拥有工具白名单与私有记忆；`dispatch` 并行分发、`handoff` 带上下文交接
- **工具与生态**：62 个内置工具（文件/命令/Git/终端/网络/浏览器/多媒体/记忆/计划/协作/MCP/插件/技能），主控默认「核心工具模式」省 token
- **自写插件**：Agent 用 `install_plugin` 给自己写插件（自动生成 manifest + index.js，校验通过即热加载，无需重启）；`list_plugins` / `read_plugin` / `remove_plugin` / `reload_plugins` 全生命周期管理，运行时沙箱已封堵 eval/Function 逃逸
- **MCP 持久化**：服务器配置连接后自动保存，启动自动连接，本地 stdio 断线自动重连（3 次退避）
- **界面自定义**：侧边栏/聊天区/消息元素逐项显隐开关 + 信息密度三档 + 自定义 CSS（任意显示细节可覆写）
- **记忆与上下文**：本地 SQLite 单数据源（强杀不丢）+ FTS5/向量 RRF 双路检索 + 四层金字塔可溯源 + 三档衰减 + 事实去重与冲突淘汰；失败教训、目标、情景操作统一落库；上下文压缩自动适配模型窗口
- **安全与可靠**：L0-L4 风险分级、DPAPI 密钥加密、危险命令黑名单（可动态扩展）、文件回滚快照、模型降级链、事件钩子 Hooks、localVision 命令无 shell 执行
- **备份与更新**：一键备份含 SQLite 记忆库（打包前 WAL checkpoint），支持断点续传 + SHA256 校验的安装包下载，GitHub Release 增量更新
- **项目指令**：自动读取 `AGENTS.md` / `CLAUDE.md` / `.agents.md`（目录链合并、子目录按需注入、注入安全扫描）
- **可观测**：一键环境自检、引擎轨迹导出、token/成本统计、发布门禁

## 技术栈

Electron 43 · React 19 · TypeScript 5.9 · Vite 7 · Zustand · Playwright-core（浏览器自动化） · node:sqlite · electron-updater

## 快速开始

```powershell
npm install          # 安装依赖
npm run dev          # 开发运行
npm test             # 单测
npm run release:check  # 发布门禁(lint/typecheck/test/eval/brand/tag)
npm run package:win  # 打包 Windows 安装程序
```

> 打包前请先关闭正在运行的Acheron-agent（应用会锁定 `release/win-unpacked` 下的文件）。

下载安装：[GitHub Releases](https://github.com/ATchangan/Acheron-agent/releases/latest)

## 自写插件

直接对助手说「给自己写一个 XXX 插件」，Agent 会先读内置 `plugin-authoring` 技能规范，再用 `install_plugin` 生成并安装：

```js
// 插件协议(index.js): 沙箱内运行, 文件/命令只能经 ctx.tools.run 桥接
module.exports = { tools: [{
  name: 'hello', description: '打招呼', params: { who: 'string' },
  run(args, ctx) { ctx.log('hi'); return 'hello ' + (args.who || 'world') },
}] }
```

- 安装即热加载：新工具下一轮对话即可按 `plugin_<插件名>__<工具名>` 调用，插件页实时刷新
- 安全：校验沙箱不执行 run、顶层禁 fs/网络/process；运行时跑在独立 utilityProcess（挂死强杀、崩溃隔离），文件/命令能力逐条回父进程裁决，eval/Function 逃逸被封堵；首次调用每个工具需用户确认
- 更新：`read_plugin` 看源码 → 修改后 `install_plugin(..., overwrite=true)`，版本号自动 +1

## 更新日志（重点）

### v0.4.2（UI 重构）
- 输出样式逐项对齐参考产品（实测 DOM 校准）：删除顶部计划卡改回合内行内审批卡；代码块复刻 CodeCard（圆角色块、无语言头、悬停复制、shiki 双主题上色）；正文/段落/列表/行内代码/用户气泡/思考行/回合间距全部对齐实测值；建议 pills 仅空会话、底部元数据悬停浮现
- 冗余清理：删除无引用的死组件/死 store 文件与配套测试、约 50 条无引用 legacy CSS、5 个未用 Markdown 依赖与 ws；移除重复 TTS 开关；数学公式渲染设置真实生效（KaTeX/不渲染）
- 外壳：标题栏（工具簇 + 会话标题）、日期分组侧栏（置顶/今天/昨天/更早）、右栏文件/预览面板、状态栏上下文用量浮层
- 命令面板 Ctrl+K：跳转 / 新对话 / 模式与主题切换 / 栏显隐；设置 / 角色编队 / 记忆改为 Overlay 浮层卡片
- 会话输出：时间线时间戳（HH:MM 去重）、思考状态标签与计时、回合时长、流式停滞提示、底部悬停操作栏
- 设置页： Overlay（悬浮关闭 + 拖拽条）、13rem 分组左导航 + 右主内容，底部导入/导出/重置
- 子代理：活动面板——默认单 Agent 执行，分派时实时展示子代理运行状态与步骤
- 版块补齐：技能/产物独立页、定时任务/命令中心/配置档案 Overlay、会话归档与排序、Composer 建议 pills 与模型菜单、消息回应与链接预览、状态栏右键自定义
- 本轮继续：API Keys 管理页、可重绑快捷键、右栏终端/评审面板、任务完成桌面通知
- 语言：仅简体中文（移除多语言回复选项，打包 locale 收敛为 zh-CN）
- 渲染：代码块语法高亮（rehype-highlight）；主题画廊扩展至 12 套预设
- 分栏：标题栏分栏工具，主区并排只读查看其它会话
- 配色：严格对齐深蓝主题（深蓝底 + 奶油暖字 + 蓝强调）
- 主题：内置预设（深蓝/午夜/余烬/单色/赛博朋克/石板），默认极黑
- 默认主题：极黑（可切换 跟随系统 / 黄泉色系 / 内置预设）
- 本轮补齐：会话拖拽排序/进行中筛选/卡片行、消息分支/代码复制/图片缩放/KaTeX 公式、@文件引用/语音输入/粘贴聚焦、右栏文件阅读器、状态栏模型菜单、命令面板设置深链、分栏拖拽调宽
- 第二轮补齐：会话分页加载、侧栏 git 项目区（分支显示）、评审 git diff 高亮、终端历史/清空、首次三步引导（语音输入按要求移除）
- 第三轮补齐：多 tile 分栏（右侧/下方 + 会话 tab 切换）、任务监视窗（独立置顶小窗实时查看）、启动更新横幅
- 第四轮补齐：首次引导可跳过且配置后永久不再出现、主区会话 tab 栏（最近 8 个 + 新对话）
- 会话输出：流式 Markdown（边生成边渲染）、回合末尾改动文件卡
- clarify 交互：模型提问时展示可点选选项，选择后继续执行
- 输出渲染：Streamdown 流式 Markdown（不完整语法尾修复 + 记忆化 KaTeX + shiki 高亮）

### v0.4.1
- 自写插件热加载 + 插件执行独立进程隔离（挂死强杀/崩溃隔离/权限回父进程裁决）
- MCP 服务器配置持久化、启动自动连接、断线自动重连
- 修复 MCP 工具名解析、set_workdir 命令目录、插件开关失效等一批老问题

### v0.4.0
- 记忆：本地 SQLite 持久化 + FTS5/向量双路检索 + 三档衰减 + 四层金字塔可溯源 + 事实去重；上下文注入 / recall_memory / 记忆页统一收敛到 agent.db（旧 JSON 自动迁移）
- 网关：任务类型路由（text/code/vision/long）+ 降级链 + 本地视觉服务自动切换
- 上下文：工具结果 side-channel + 四要素状态提炼 + 技能按需注入
- 工程：移除桌宠，安装包 116.8MB→94.6MB；Electron 32→43、React 19、Vite 7、TS 5.9；备份含 agent.db、CI 完整质量门禁 + Release 增量更新；49 文件 287 用例全绿

### v0.3.9
- 正确性：中文乱码修复、子代理统一执行管道、私有记忆隔离、模型降级链、密钥解密兜底
- 协作：强制 dispatch、handoff 带上下文、交付附「本次改进点」、长任务可并行新会话
- 记忆与技能：容量封顶自动归档、约定类自动置顶、内置技能可隐藏、技能同名用户优先
- 体验：复制按钮图标化、输出 Markdown 排版优化、全仓去 emoji/品牌词
- 工程：发布门禁、测试数据隔离；42 文件 248 用例全绿

### v0.3.8
- 项目指令生态（AGENTS.md/CLAUDE.md 目录链、子目录按需注入）、原生 git 工具、Hooks、任务回滚、自定义子代理
- PowerShell 7 全场景路由、计划一致性、一键环境自检、性能优化（同任务 61.6s→5.1s）

完整历史见 [CHANGELOG.md](CHANGELOG.md)。

## 目录结构

```
electron/    主进程与独立内核(engine/ipc/shared/memory/scheduler)
src/         渲染层(store/components/styles)
resources/   内置资源(图标/人设/技能)
scripts/     构建/测试/发布脚本
docs/        文档与截图
```

## 隐私与安全

- API Key 经 Windows DPAPI 加密后存储于用户目录，源码与安装包不含任何用户数据
- 记忆、会话、轨迹全部保存在本地，不上传
- 发布前自动扫描品牌词与密钥（`npm run release:check`）

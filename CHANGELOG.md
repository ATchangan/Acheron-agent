# 更新日志（重点）

## v0.4.3（2026-08-23）技能生态

- 技能编辑器与校验：4 规则校验（name/description/triggers 必填、description ≤ 100、正文含 `## 步骤`、triggers 正则合法；未知 tools 仅 warn），写盘路径白名单防穿越；新增 `skills:validate` / `skills:write` / `skills:stats`
- 命中统计：按日聚合的 `skill_stats`（hit / trigger / ok），设置页展示近 30 天命中率 / 触发率 / 成功率
- 模板库 5 → 10：新增 json-validator / log-troubleshoot / csv-clean / api-doc-gen / backup-script 五个内置技能
- 注入预算监控：命中技能超 2 个按相关度截断并记录 `skill.budget-truncate` trace
- 更名与品牌：应用更名为 Acheron-Agent（窗口 / 标题 / 安装包产物名），黄泉人设插画用于欢迎 / 侧栏 / 关于 / 角标；去除第三方品牌词
- 界面：输入区下拉点外部自动收回；若干渲染稳定性修复
- 性能与工程：Vite 分包优化（主 bundle ~1.14MB → 346KB）；`noUnusedLocals / noUnusedParameters` 全开，`tsc` 0 报错；移除多余依赖（含 `concurrently`）；全局错误捕获 + 渲染崩溃自动重建
- 336 项测试全绿

## v0.4.2（2026-08-21）UI 重构与稳定性加固

- 界面重构：标题栏 / 侧栏 / 状态栏 / 设置页 / 路由浮层全面重排，输出统一为流式 Markdown 渲染，审批卡内联展示
- 稳定性：渲染进程崩溃后重建窗口自动恢复，工具执行超时兜底，错误边界重构，Electron 升至 43.4.1
- 清理与验证：删除冗余组件与死代码

> 更早版本见 Git 历史。

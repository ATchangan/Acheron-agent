# 黄泉桌宠 0.4.0 —— Mate-Engine 全功能复刻与重做

## 一句话目标

把 Mate-Engine 的全套桌面伴侣能力搬进黄泉桌宠：以 Unity（Mate-Engine 派生工程）重做桌宠渲染与交互层，
通过本地 WebSocket 接入现有 Electron Agent 大脑；旧 three.js 桌宠归档保留、默认停用。
版本继续锁定 `v0.4.0`（每轮构建后 `git tag -f v0.4.0`）。

## 架构结论

- Electron = 大脑：会话、记忆、工具、设置、更新、托盘，全部保留不动。
- Unity = 身体：VRM 加载、Animator 动作、DynamicBone/弹簧骨、坐视窗/任务栏、触摸/食物/粒子等全部交互。
- WebSocket = 神经：Electron 主进程起本地 WS 服务，Unity 桌宠作为客户端接入，双向 JSON 消息。

选这条路的理由：Mate-Engine 的"丝滑感"来自 Unity Animator 混合树 + DynamicBone + UniVRM，这不是
three.js 侧逐项打磨能追平的（历史多轮已反复卡在头发、权重、动作自然度）。用户已装 Unity，
且明确"桌宠可以全部重做"，因此直接以 Mate-Engine 为底座、黄泉 VRM 替换角色、Agent 后端接管 AI。

## 目录布局

| 路径 | 用途 |
| --- | --- |
| `D:\桌面\黄泉agent\Mate-Engine` | Unity 工作工程（fork clone，本地使用，含上游源码） |
| `pet-unity/` | 本仓库跟踪的自研增量：C# 桥接/配置/NOTICE，按 MatePro 许可发布 |
| `pet/` | 旧 three.js 桌宠，归档保留，默认不再启用 |
| `docs/0.4.0-mate-parity/` | 本计划：README / 功能矩阵 / 集成架构 |

黄泉 PMX/VRM/贴图/VMD 与 Mate-Engine 默认模型、音效、字体等第三方资产一律不进开源仓库
（沿用 `pet/models`、`pet/actions` 的 .gitignore 约定），桌宠运行时从本机用户数据目录加载。

## License 合规要点（重要）

- Mate-Engine 代码为 MatePro License v2.1：允许私有修改；但公开衍生代码必须同许可开源、非商业、
  不得发布到 Steam/itch 等分发平台（官方 Workshop mod 有特别条款）。
- 本仓库 `pet-unity/` 下基于 Mate-Engine 的派生/增量代码随仓库公开，并保留上游 LICENSE 与出处。
- 主仓库目前没有 LICENSE 文件，需在合并前补一份顶层声明：
  Electron/Agent 部分维持原许可，`pet-unity/` 部分声明 MatePro 并链接上游
  `https://github.com/shinyflvre/Mate-Engine`。
- Steam Workshop / Steam DLC（花环、樱花环等）不接入；改用 GitHub Releases + 本地 mod 商店实现同等能力。

## 里程碑（全部收敛在 v0.4.0 内）

| 阶段 | 内容 |
| --- | --- |
| M1 底座 | 打开工程、载入黄泉 VRM、透明置顶窗口、缩放/位置/托盘/设置持久化 |
| M2 动作 | 待机、拖拽、戳头、坐视窗/坐任务栏、平滑过渡、呼吸、DynamicBone |
| M3 追踪 | 头/眼/脊柱/手部鼠标追踪、IK |
| M4 音舞 | WASAPI 系统音频捕获 → 节奏触发 VMD 舞蹈、多角色同步 |
| M5 互动 | 食物、粒子、音效/语音包、触摸区域、事件消息、随机消息 |
| M6 AI 桥接 | Electron↔Unity WebSocket、聊天、Markdown 气泡、文字驱动口型与表情 |
| M7 系统 | 开机自启、快捷键、大屏模式、屏保、闹钟/计时、多显示器、（可选）Discord RPC |
| M8 Mod | `.me` 类 mod 包（动画/粒子/音效/配饰）、内置 SDK、Blendshape 编辑 |
| M9 打磨 | Bloom/AO/MSAA、主题定制、多语言、性能、打包发布 |

## 验证纪律

- 每个动作模块改完必须自己截图，用本地 `vision "图片路径" "中文问题"` 做视觉回归，确认"表现正常"再提交。
- 回归：`npm run build`；桌宠动作回归 `node scripts/pet-action-verify.js`（Unity 版就绪后替换为 Unity 侧验证脚本）。
- 禁止调用用户浏览器里的网页 GLM；只用本地 `vision`。

## 当前进度

- [x] 调研 Mate-Engine License、功能清单、脚本面
- [x] 诊断 Unity 安装状态：Hub 已开、编辑器未装、地域 CDN 缺 Unity 6.2+ 系列
- [x] 确认本机 WireGuard 隧道（UmiTun，美国出口）可用，全球 CDN 返回 200
- [ ] 下载并安装 Unity 6000.2.6f2 + Windows IL2CPP（下载进行中）
- [ ] 打开工程、载入黄泉 VRM，M1 起逐模块实现

# pet-unity —— 黄泉桌宠 Unity 侧增量

这是黄泉桌宠在 Mate-Engine（Unity）底座上的自研增量代码，配合 `docs/0.4.0-mate-parity/` 使用。

## 用法

本目录不是完整 Unity 工程。把 `Assets/` 下的内容复制（或链接）进本地工作工程
`D:\桌面\黄泉agent\Mate-Engine\Assets\` 后，用 Unity 6000.2.6f2 打开主场景
`Assets/MATE ENGINE - Scenes/Mate Engine Main.unity`。

运行参数由 Electron 主进程传入：

```text
HuangquanPet.exe -connect "ws://127.0.0.1:<port>?token=<随机token>"
```

## 目录

- `Assets/HqBridge/` —— Electron ↔ Unity WebSocket 桥接（协议见 docs/0.4.0-mate-parity/集成架构.md）
- `Assets/HqPet/` —— 后续黄泉桌宠专属组件（预留）

## 许可

- 本目录是基于 Mate-Engine 的派生/增量代码，按上游 MatePro License v2.1 发布，
  保留上游版权声明与 LICENSE 全文，见 [NOTICE.md](./NOTICE.md) 与 [LICENSE.md](./LICENSE.md)。
- 上游：<https://github.com/shinyflvre/Mate-Engine>

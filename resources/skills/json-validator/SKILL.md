---
name: json-validator
description: 校验并修复 JSON 文件（读取→解析→报行号/可修则修）
triggers: 校验JSON|检查JSON|json格式|fix-json|JSON报错
---
# JSON 校验与修复
## 步骤
1. 用 read 读取目标文件
2. 解析 JSON：失败则用行号/上下文定位语法或结构错误
3. 能修复则写回（保持其余结构不变），并说明仍存在的风险；不能修复则明确报错，禁止编造内容

---
name: backup-script
description: 目录备份脚本生成（压缩/排除项/保留策略）
triggers: 备份|backup|生成备份脚本|目录备份|定时备份
---
# 目录备份脚本
## 步骤
1. 确认待备份目录、排除项（node_modules/.git 等）与目标路径
2. 生成备份脚本（压缩 + 保留最近 N 份）
3. 运行并验证产物存在，说明恢复方式

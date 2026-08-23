---
name: csv-clean
description: CSV 清洗（去重/格式统一/编码/分隔符检查）
triggers: 清洗CSV|CSV清洗|csv去重|数据整理|表格去重
---
# CSV 清洗
## 步骤
1. 读 CSV，检查编码（UTF-8/GBK）与分隔符/表头
2. 去重、统一日期/数值/空白格式，记录改动
3. 写回并给一行结果摘要（清理了几行、改了哪里）

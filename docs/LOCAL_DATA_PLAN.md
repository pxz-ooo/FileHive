# 本地数据与迁移方案

## 产品原则

1. 消息、图片、文件默认只保存在当前设备本地
2. 云端只处理“本次分析所需内容”，不做持久化存储
3. 导出 / 导入是迁移核心，不依赖账号体系

## 本地数据分层

### 1. 元数据

建议统一保存在本地索引中：

- `entries.json`
- `projects.json`
- `categories.json`
- `settings snapshot`

每条记录建议包含：

- `msgid`
- `msg_type`
- `created_at`
- `project_id`
- `analysis`
- `provider`
- `model_used`
- `raw_content`
- `media manifest`

### 2. 文件原件

文件原件保存在小程序私有目录：

- 图片
- 文档
- 之后的链接封面缓存图

## 导出格式

建议最终导出为一个“迁移包目录结构”：

`manifest.json`
`entries.json`
`projects.json`
`categories.json`
`files/...`

其中 `manifest.json` 包含：

- `bundle_version`
- `exported_at`
- `entry_count`
- `file_count`
- `app_version`

## 导入策略

建议支持两种：

### 1. 替换导入

- 清空当前本地仓
- 完整恢复为导入包内容

适合换机迁移。

### 2. 合并导入

- 以 `msgid` 去重
- 已存在的不重复导入
- 项目和分类按名称合并

适合增量恢复。

## 风险提示

1. 小程序本地文件不是“系统级永久保险箱”
2. 换手机、卸载、清缓存，都可能导致本地数据丢失
3. 所以必须强调“定期导出索引 / 文件清单 / 迁移包”

## 建议的下一步

1. 先做 `索引导出`
2. 再做 `迁移包导出`
3. 最后做 `迁移包导入`

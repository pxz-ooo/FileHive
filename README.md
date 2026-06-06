# 微信整理助手

一个本地优先的微信整理助手小程序。

它用来保存微信里的文字、链接、图片和文件，并在本地完成归类、检索、管理。AI 能力是可选增强，不依赖云端数据库，不默认上传你的资料到我们的服务器。

## 一句话定位

随手存 · 自动归 · 随时找

## 核心特性

- 本地优先：消息、图片、文件默认只保存在当前设备本地
- AI 可选：默认走 `Vercel Functions -> SiliconFlow`，也支持用户自配 `SiliconFlow` 或 `MiMo`
- 链接解析：支持社媒/短视频分享链接解析
- 本地检索：支持按关键词、分类、时间、类型、项目筛选
- 可迁移：后续支持导出索引、导出文件清单、迁移包导入导出

## 数据与隐私

- 不使用云数据库
- 不把消息、图片、文件持久化到服务端
- 只有在你主动使用 AI 摘要、分类、OCR、图片理解时，本次必要内容才会发送到对应 AI 服务
- API Key 只保存在当前设备本地

## 当前架构

```text
miniprogram/        微信小程序主体，本地存储、本地搜索、本地管理
api/                Vercel Functions 轻服务，负责 AI 转发与链接解析
docs/               部署说明、API Key 教程、本地数据迁移方案
```

默认 AI 通道：

```text
小程序 -> Vercel Functions -> SiliconFlow
```

可选备用通道：

```text
小程序 -> MiMo
```

## 目录说明

### 根目录

- `README.md`
  项目总说明与快速部署入口。
- `vercel.json`
  Vercel Functions 配置。
- `.env.vercel.example`
  Vercel 环境变量示例。
- `project.config.json`
  微信开发者工具项目配置。
- `project.private.config.json`
  微信开发者工具本地配置。

### `miniprogram/`

微信小程序主体代码。

- `app.js`
  全局配置与 AI 通道路由入口。
- `app.json`
  页面与组件注册。
- `app.wxss`
  全局样式。

#### `miniprogram/pages/`

- `pages/index/`
  首页，负责录入、筛选、搜索和列表展示。
- `pages/message-detail/`
  详情页，负责查看原始内容、AI 结果、归档和重分析。
- `pages/search/`
  搜索页，负责按关键词与条件检索本地内容。
- `pages/settings/`
  设置页，负责 API Key、AI 通道说明、导出入口。
- `pages/webview/`
  WebView 页面，用于打开网页类链接。

#### `miniprogram/utils/`

- `utils/local-store.js`
  本地数据层，负责消息索引、项目、分类、文件元数据与导出。
- `utils/api.js`
  AI 与链接解析调用层，负责默认通道、MiMo 通道和降级逻辑。

#### `miniprogram/images/`

- `images/icons/`
  页面图标资源。
- `images/illustrations/`
  空状态插画资源。

### `api/`

Vercel Functions 轻服务。

- `api/ai/chat.js`
  AI 转发接口，默认转发到 `SiliconFlow`。
- `api/ai/health.js`
  健康检查与默认通道校验。
- `api/link/parse.js`
  链接解析接口，当前用于短视频/社媒分享链接解析。
- `api/_lib/http.js`
  Functions 公共 HTTP 工具。

### `docs/`

- `docs/VERCEL_DEPLOY.md`
  Vercel 部署说明。
- `docs/API_KEYS.md`
  API Key 添加教程。
- `docs/LOCAL_DATA_PLAN.md`
  本地数据迁移与恢复设计说明。

## 快速部署

### 1. 部署 Vercel Functions

1. 把当前仓库推到 GitHub
2. 在 Vercel 中导入该仓库
3. 在 `Project Settings -> Environment Variables` 添加：
   - `SILICONFLOW_API_KEY`
   - `SILICONFLOW_BASE_URL`
   - `SILICONFLOW_MODEL`
4. 重新部署，拿到域名，例如：
   - `https://file-hive-mtf1.vercel.app`

推荐环境变量：

- `SILICONFLOW_BASE_URL=https://api.siliconflow.cn/v1`
- `SILICONFLOW_MODEL=Qwen/Qwen3-VL-30B-A3B-Instruct`

### 2. 写入小程序默认服务地址

打开 `miniprogram/app.js`，把内置占位地址：

```text
https://file-hive-mtf1.vercel.app
```

替换为你的真实 Vercel 域名。

### 3. 配微信后台域名

微信公众平台 -> 小程序后台 -> 开发管理 / 开发设置：

- `request 合法域名`
  填你的 Vercel 域名

如果后续需要在 `web-view` 中打开你自己的网页，再额外配置：

- `业务域名`

### 4. 安装并构建小程序依赖

进入 `miniprogram/`：

```bash
npm install
```

然后在微信开发者工具里执行“构建 npm”。

### 5. 配置 API Key

进入小程序里的“本地设置”：

- 默认通道：
  - 点击“校验默认通道”
- 可选自配：
  - `SiliconFlow API Key`
  - `MiMo API Key`

保存后，再手动点击对应校验按钮。

## API Key 说明

当前支持两类 Key：

### 1. SiliconFlow API Key

用途：

- 使用你自己的 SiliconFlow 配额
- 覆盖默认通道里的服务端 Key

### 2. MiMo API Key

用途：

- 作为备用 AI 通道
- 在默认通道不可用时做降级

补充说明：

- 用户不需要填写 Vercel 地址
- 用户只需要按需填写自己的 `SiliconFlow` 和 `MiMo` Key
- 不填写时，默认 AI 通道仍可通过你部署在 Vercel 上的服务端环境变量工作

## 本地数据迁移

当前设计分三步：

1. 索引导出
2. 文件清单导出
3. 迁移包导入 / 导出

建议的迁移包结构：

```text
manifest.json
entries.json
projects.json
categories.json
files/
```

迁移策略建议支持两种：

- 替换导入：适合换机完整恢复
- 合并导入：适合增量恢复

## 链接解析范围

当前第一阶段只做：

- 短视频平台分享链接
- 社媒分享文案中的首个链接提取与解析

普通网页文章预览留到第二阶段扩展。

## 当前状态

当前有效主线目录：

- `miniprogram/`
- `api/`
- `docs/`

仓库里如果仍看到旧的 `app/`、`frontend/`、`data/` 等目录，那是历史遗留内容，清理完成后不再参与当前架构。

# Vercel 部署说明

## 1. 导入项目

1. 登录 Vercel
2. `Add New Project`
3. 选择这个仓库 `FileHive`
4. 保持根目录为项目根目录

## 2. 配环境变量

进入 `Project Settings -> Environment Variables`，添加：

- `SILICONFLOW_API_KEY`
- `SILICONFLOW_BASE_URL`
  - 推荐：`https://api.siliconflow.cn/v1`
- `SILICONFLOW_MODEL`
  - 当前推荐：`THUDM/GLM-4.1V-9B-Thinking`
  - 如果更重视多模态综合能力，也可换成：`Qwen/Qwen3-Omni-30B-A3B-Instruct`

改完环境变量后，要重新部署一次。

## 3. 拿到服务地址

部署成功后，你会得到一个地址，例如：

`https://your-app.vercel.app`

## 4. 把域名内置到小程序

部署成功后，把域名写进小程序代码中的固定配置。

当前位置：

- [app.js](/D:/ccprojects/FileHive/miniprogram/app.js)

把：

`https://your-filehive-ai.vercel.app`

替换成你的真实 Vercel 域名。

然后重新编译小程序，在 `本地设置` 里点击 `校验默认通道`。

## 5. 配微信后台域名

微信公众平台 -> 小程序后台 -> `开发管理 / 开发设置`

需要配置：

- `request 合法域名`
  - 填你的 Vercel 域名，例如 `https://your-app.vercel.app`
- 如果后续 `web-view` 打开网页说明页或外部中转页，再额外配置：
  - `业务域名`

## 6. 当前接口

- 健康检查：`/api/ai/health`
- AI 转发：`/api/ai/chat`
- 之后可扩展：
  - `/api/link/parse`
  - `/api/export/sign`

## 7. 当前产品约定

用户不需要填写 Vercel 地址。  
用户只会在小程序里接触两类 Key：

- `SiliconFlow API Key`
- `MiMo API Key`

如果用户没有填写自己的 `SiliconFlow API Key`，默认通道会使用你部署在 Vercel 上的服务端环境变量。

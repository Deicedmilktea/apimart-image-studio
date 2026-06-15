# APIMart 图片工作室

一个像 ChatGPT 网页端那样的可视化生图页面：输入提示词 → 选择参数 → 点击生成 → 查看 / 下载图片。底层调用 [APIMart](https://docs.apimart.ai) 的 `gpt-image-2` 异步图片生成 API。

## 界面预览

![APIMart 图片工作室界面预览](public/readme-preview.png)

## 特性

- **文生图 / 图生图**：支持上传参考图（最多 16 张，自动转 base64）。
- **模型与参数**：`gpt-image-2`（标准）/ `gpt-image-2-official`（官方通道）；可选比例（13 种）、分辨率（官方通道 1k/2k/4k）、官方通道回退。
- **异步轮询**：提交后自动轮询任务状态，完成后展示图片。
- **服务端自动落盘**：任务完成后，后端会把图片下载保存到本地目录（默认 `generated/`），不依赖 24h 链接、清缓存也不丢；页面会显示保存目录与文件名。
- **本地历史**：生成记录保存在浏览器 `localStorage`，可回看 / 下载。
- **密钥安全**：API Key 只存在于服务端（Next.js Route Handler 代理），不会暴露给浏览器。

## 架构

```
浏览器(UI) ──prompt──▶ /api/generate ──Bearer Key──▶ APIMart POST /v1/images/generations
                          │                                          │
                          ◀──────────────── task_id ─────────────────┘
浏览器 ──轮询──▶ /api/task/[id] ──▶ APIMart GET /v1/tasks/{id} ──▶ 图片 URL ──▶ 展示
```

- 服务端逻辑：`src/lib/apimart.ts`（提交、轮询、解析响应）。
- API 路由：`src/app/api/generate/route.ts`、`src/app/api/task/[id]/route.ts`。
- 前端：`src/components/ImageStudio.tsx`。

## 本地运行

```bash
cp .env.example .env.local   # 填入 APIMART_API_KEY
npm install
npm run dev                  # http://localhost:3000
```

## 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `APIMART_API_KEY` | 是 | APIMart API Key |
| `APIMART_BASE_URL` | 否 | 默认 `https://api.apimart.ai/v1` |
| `APIMART_OUTPUT_DIR` | 否 | 图片自动保存目录，默认 `generated`（相对路径基于项目根目录） |

## 部署到 Vercel

导入仓库后，在 Project Settings → Environment Variables 中添加 `APIMART_API_KEY` 即可。

## 说明

- APIMart 生成的图片链接 **24 小时内有效**；本应用会在任务完成时自动把图片保存到服务端 `APIMART_OUTPUT_DIR`（默认 `generated/`），即使链接过期本地副本仍在。该目录已加入 `.gitignore`，不会被提交。
- 注意：服务端落盘发生在运行 Next.js 的机器上。本地 `npm run dev` 时即你自己的电脑；部署到 Vercel 等无持久文件系统的平台时，落盘文件不会持久保留，此功能主要适用于本地 / 自托管运行。
- `gpt-image-2` 比例不要传 `auto`；想用默认比例就不选（留空）。
- 分辨率 `4k` 仅支持 `16:9 / 9:16 / 2:1 / 1:2 / 21:9 / 9:21`，且只在官方通道模型下可用。

# 🎨 图片工作室（云端 / 纯前端版）

一个像 ChatGPT 网页端一样的可视化生图界面：输入提示词 → 选参数 → 点生成 → 查看 / 下载图片。

> 这是部署到 Vercel 的 **前端为主分支**。用户在「设置」里填自己的 Key / URL，全部存在浏览器本地。APIMart 通道由浏览器直连；自定义 OpenAI 兼容通道经一个**无状态代理路由**转发（解决部分接口不开 CORS 的问题，代理不存任何数据）。生成的图片与历史记录都缓存在浏览器里。
>
> 需要本地全栈版（含官方 `image_gen.py` 通道、服务端落盘等）请看 `init` 分支。

## 两个生图通道

- **APIMart**：`gpt-image-2` 的异步生图 API（提交任务 → 轮询 → 拿结果）。
- **自定义 URL/Key（OpenAI 兼容）**：经内置代理路由 `/api/proxy` 调用你填写的 `Base URL + Key + 模型`，走标准的 `/images/generations` 与 `/images/edits`（图生图）。代理只透传、不存储，因此你填的接口**不需要支持浏览器 CORS**。

## 特性

- **文生图 / 图生图**：支持上传参考图（最多 16 张，自动转 base64）。
- **多通道切换**：在 APIMart 与自定义 URL/Key 之间切换。
- **自带 Key（BYOK）**：所有 Key / URL 只存在浏览器 `localStorage`。APIMart 直连服务；自定义通道经无状态代理透传（不落盘、不记录 Key）。
- **本地持久化**：
  - 历史记录元数据存浏览器 `localStorage`。
  - 图片字节存浏览器 **IndexedDB**。APIMart 的图片链接约 24 小时过期，完成时会把图片字节缓存到本地，过期后依然能看 / 下载。
- **参数**：
  - APIMart：模型（标准 / 官方通道）、比例、分辨率（官方通道支持 1k/2k/4k）。
  - 自定义：质量（low / medium / high / auto），比例会映射成固定尺寸（21:9 / 9:21 暂不可用）。

## 架构

```
浏览器 (UI)
  ├─ APIMart 通道 ─(浏览器直连)─▶ POST {baseURL}/images/generations ──▶ task_id
  │                              └▶ 轮询 GET {baseURL}/tasks/{id} ──▶ 图片 URL ──▶ IndexedDB
  └─ 自定义通道 ─▶ /api/proxy (无状态转发) ─▶ {baseURL}/images/generations | /images/edits ──▶ b64 ──▶ IndexedDB
```

- `src/lib/apimart.ts`：APIMart 提交 / 轮询 / 响应解析（纯客户端）。
- `src/lib/customImagegen.ts`：自定义 OpenAI 兼容通道的 generate / edit。
- `src/lib/config.ts`：读写浏览器里的 Key / URL 配置。
- `src/lib/imageDb.ts`：IndexedDB 图片缓存。
- `src/components/ImageStudio.tsx`：前端主界面 + 设置弹窗。
- `src/app/api/proxy/route.ts`：自定义通道的无状态转发代理（带基本 SSRF 防护，仅允许 https、屏蔽内网/元数据地址）。

## 本地运行

```bash
npm install
npm run dev   # http://localhost:3000
```

启动后点右上角「设置」填入 Key / URL 即可使用，无需任何 `.env`。

## 部署到 Vercel

直接导入仓库、选择本分支部署即可，**不需要配置任何环境变量**。

- 应用只有一个 API 路由 `/api/proxy`（自定义通道用），Vercel 会为它创建一个 Serverless Function；`/` 仍是静态页面。
- 用户首次访问后在「设置」里填自己的 Key / URL 即可开始生图。

## 注意

- **自定义通道经代理转发**：因此不依赖目标接口的 CORS；但请求会经过你自己部署的 Vercel 函数（无状态、不落盘，Key 仅透传）。
- 自定义 URL/Key 模式仅暴露少量参数：prompt / 参考图 / 比例 / quality / 模型名。
- 自定义通道的比例会映射成固定尺寸（如 `1:1`→`1024x1024`），具体是否被接受取决于你的 endpoint 与模型。
- Key 存在浏览器属于常规 BYOK 方案，请在可信设备 / 浏览器上使用。

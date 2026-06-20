# 🎨 图片工作室（云端 / 纯前端版）

一个像 ChatGPT 网页端一样的可视化生图界面：输入提示词 → 选参数 → 点生成 → 查看 / 下载图片。

> 这是部署到 Vercel 的 **纯前端分支**。没有任何后端：用户在「设置」里填自己的 Key / URL，全部存在浏览器本地，请求直接发往对应的图片服务。生成的图片与历史记录也都缓存在浏览器里。
>
> 需要本地全栈版（含官方 `image_gen.py` 通道、服务端落盘等）请看 `main` 分支。

## 两个生图通道

- **APIMart**：`gpt-image-2` 的异步生图 API（提交任务 → 轮询 → 拿结果）。
- **自定义 URL/Key（OpenAI 兼容）**：浏览器直接调用你填写的 `Base URL + Key + 模型`，走标准的 `/images/generations` 与 `/images/edits`（图生图）。

## 特性

- **文生图 / 图生图**：支持上传参考图（最多 16 张，自动转 base64）。
- **多通道切换**：在 APIMart 与自定义 URL/Key 之间切换。
- **自带 Key（BYOK）**：所有 Key / URL 只存在浏览器 `localStorage`，请求直连服务，不经过任何后端。
- **本地持久化**：
  - 历史记录元数据存浏览器 `localStorage`。
  - 图片字节存浏览器 **IndexedDB**。APIMart 的图片链接约 24 小时过期，完成时会把图片字节缓存到本地，过期后依然能看 / 下载。
- **参数**：
  - APIMart：模型（标准 / 官方通道）、比例、分辨率（官方通道支持 1k/2k/4k）。
  - 自定义：质量（low / medium / high / auto），比例会映射成固定尺寸（21:9 / 9:21 暂不可用）。

## 架构

```
浏览器 (UI)
  ├─ APIMart 通道 ──▶ POST {baseURL}/images/generations ──▶ task_id
  │                   └▶ 轮询 GET {baseURL}/tasks/{id} ──▶ 图片 URL ──▶ 缓存进 IndexedDB
  └─ 自定义通道 ────▶ POST {baseURL}/images/generations | /images/edits ──▶ b64 ──▶ IndexedDB
```

- `src/lib/apimart.ts`：APIMart 提交 / 轮询 / 响应解析（纯客户端）。
- `src/lib/customImagegen.ts`：自定义 OpenAI 兼容通道的 generate / edit。
- `src/lib/config.ts`：读写浏览器里的 Key / URL 配置。
- `src/lib/imageDb.ts`：IndexedDB 图片缓存。
- `src/components/ImageStudio.tsx`：前端主界面 + 设置弹窗。

## 本地运行

```bash
npm install
npm run dev   # http://localhost:3000
```

启动后点右上角「设置」填入 Key / URL 即可使用，无需任何 `.env`。

## 部署到 Vercel

直接导入仓库、选择本分支部署即可，**不需要配置任何环境变量**。

- 应用没有 API 路由，`/` 是纯静态页面，Vercel 不会创建任何 Serverless Function。
- 用户首次访问后在「设置」里填自己的 Key / URL 即可开始生图。

## 注意

- **自定义通道依赖 CORS**：能否在浏览器直连取决于你填的那个 endpoint 是否允许跨域。OpenAI 官方支持；部分第三方代理可能未开启 CORS，会连接失败。
- 自定义 URL/Key 模式仅暴露少量参数：prompt / 参考图 / 比例 / quality / 模型名。
- 自定义通道的比例会映射成固定尺寸（如 `1:1`→`1024x1024`），具体是否被接受取决于你的 endpoint 与模型。
- Key 存在浏览器属于常规 BYOK 方案，请在可信设备 / 浏览器上使用。

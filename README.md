# 🎨 图片工作室 / Image Studio

一个像 ChatGPT 网页端一样的可视化生图界面：输入提示词 → 选参数 → 点生成 → 查看 / 下载图片。

🔗 **在线体验（云端版）：https://image-studio-bice.vercel.app/**

![图片工作室界面预览](public/readme-preview.png)

---

## 两个版本

本项目维护两个版本，共享同一套界面和两条生图通道，区别在于 **Key 存放位置** 和 **图片如何持久化**：

| 版本 | 分支 | 适合谁 | Key 存放 | 图片持久化 | 部署 |
| --- | --- | --- | --- | --- | --- |
| **云端 / 在线版**（前端为主） | `cloud-frontend` | 普通用户，想打开就用 | 浏览器本地 `localStorage`（自带 Key / BYOK） | 浏览器 `IndexedDB` | 已部署在 [Vercel](https://image-studio-bice.vercel.app/) |
| **本地 / 自托管全栈版** | `init`（主分支） | 开发者；需要官方 `image_gen.py` 通道、服务端落盘 | 服务端 `.env`（不暴露给浏览器） | 服务端磁盘（默认 `generated/`） | 本地 `npm run dev` 或自托管 |

两条生图通道在两个版本里都有：

- **APIMart**：`gpt-image-2` 的异步生图 API（提交任务 → 轮询 → 拿结果）。
- **自定义 URL/Key（OpenAI 兼容）**：任意兼容 OpenAI Images 接口的服务，走标准的 `/images/generations` 与 `/images/edits`（图生图）。

---

## 给用户：在线版怎么用

打开 **https://image-studio-bice.vercel.app/** ，然后：

1. 点右上角 **「设置」**，按你手上的通道填写：
   - **APIMart**：填 API Key（Base URL 默认 `https://api.apimart.ai/v1`，一般不用改）。
   - **自定义 URL/Key（OpenAI 兼容）**：填 Base URL、API Key、模型名（默认 `gpt-image-2`）。
   - 点保存。**所有 Key / URL 只保存在你当前浏览器的本地存储里，不会上传到云端，无隐私顾虑。**
2. 回主界面：输入提示词 → 选「通道 / 模型 / 比例」→（可选）点 `+` 上传参考图做图生图 → 点 **「生成」**（或快捷键 `Ctrl / ⌘ + Enter`）。
3. 生成的图片和历史记录都缓存在你的浏览器本地，可随时回看 / 下载。APIMart 的图片链接约 24 小时过期，但完成时图片字节已缓存到本地，过期后依然能看 / 下载。

> 注意：换浏览器或清除浏览器数据后，本地保存的 Key 和历史会消失，需要重新在「设置」里配置。Key 存在浏览器属于常规 BYOK 方案，请在可信设备 / 浏览器上使用。

---

## 通用特性

- **文生图 / 图生图**：支持上传参考图（最多 16 张，自动转 base64）。
- **多通道切换**：可在 APIMart 与自定义 URL/Key 之间切换。
- **参数**：
  - APIMart：模型（`gpt-image-2` 标准 / `gpt-image-2-official` 官方通道）、比例、分辨率（官方通道支持 1k/2k/4k）、官方通道回退。
  - 自定义 URL/Key：质量 `quality`（low / medium / high / auto），比例会映射成固定尺寸（`21:9` / `9:21` 暂不可用）。
- **异步轮询**：APIMart 提交后自动轮询任务状态，完成后展示图片。
- **本地历史**：生成记录保存在浏览器，可回看 / 下载。

---

## 云端 / 在线版（`cloud-frontend` 分支）

> 前端为主、几乎零后端。用户在「设置」里填自己的 Key / URL，全部存在浏览器本地。APIMart 通道由浏览器直连；自定义 OpenAI 兼容通道经一个**无状态代理路由**转发（解决部分接口不开 CORS 的问题，代理只透传、不存任何数据 / Key）。

### 架构

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
- `src/app/api/proxy/route.ts`：自定义通道的无状态转发代理（带基本 SSRF 防护：仅允许 https、屏蔽内网 / 元数据地址）。

### 本地运行

```bash
git checkout cloud-frontend
npm install
npm run dev   # http://localhost:3000
```

启动后点右上角「设置」填入 Key / URL 即可使用，**无需任何 `.env`**。

### 部署到 Vercel

导入仓库后，在 **Project Settings → Git → Production Branch** 选择 `cloud-frontend`，**不需要配置任何环境变量**，直接部署即可。

- 应用只有一个 API 路由 `/api/proxy`（自定义通道用），Vercel 会为它创建一个 Serverless Function；`/` 仍是静态页面。
- 用户首次访问后在「设置」里填自己的 Key / URL 即可开始生图。
- 绑定自定义域名：Project → Settings → **Domains** 添加你的域名并按提示配置 DNS。

---

## 本地 / 自托管全栈版（`init` 分支，主分支）

> 这是完整的全栈版本：除了 APIMart 与自定义 URL/Key，还保留了「自定义 URL/Key」经 TypeScript 包装器转调官方 `image_gen.py` 的通道，并由服务端把生成结果落盘到本地，Key 只存在服务端、不暴露给浏览器。

### 架构

```
浏览器(UI) ──prompt/provider──▶ /api/generate
                                   ├─ APIMart ──▶ POST /v1/images/generations ──▶ task_id ──▶ /api/task/[id] 轮询
                                   └─ local-imagegen ──▶ TS 包装器 ──▶ 官方 image_gen.py ──▶ 本地输出文件
```

- 服务端逻辑：
  - `src/lib/apimart.ts`：APIMart 提交、轮询、解析响应。
  - `src/lib/localImagegen.ts`：读取 env、调用官方 `image_gen.py`。
- API 路由：`src/app/api/generate/route.ts`、`src/app/api/task/[id]/route.ts`、`src/app/api/image/[file]/route.ts`。
- 前端：`src/components/ImageStudio.tsx`。
- 服务端落盘：任务完成后把图片下载保存到本地目录（默认 `generated/`），不依赖 24h 链接、清缓存也不丢；该目录已加入 `.gitignore`。Key 只存在服务端（Next.js Route Handler 代理），不会暴露给浏览器。

### 本地运行

```bash
cp .env.example .env.local
npm install
uv sync                      # 仅在使用「自定义 URL/Key」官方通道时需要
npm run dev                  # http://localhost:3000
```

如果你只使用 APIMart，可以不执行 `uv sync`。如果要启用「自定义 URL/Key」官方通道，执行 `uv sync` 会在项目根目录创建 `.venv/` 并安装 Python 依赖（`openai` 和 `pillow`）。

### 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `APIMART_API_KEY` | 否 | 使用 APIMart 时必填 |
| `APIMART_BASE_URL` | 否 | 默认 `https://api.apimart.ai/v1` |
| `LOCAL_IMAGEGEN_BASE_URL` | 否 | 使用自定义 URL/Key 时必填，直接映射到子进程 `OPENAI_BASE_URL` |
| `LOCAL_IMAGEGEN_API_KEY` | 否 | 使用自定义 URL/Key 时必填，直接映射到子进程 `OPENAI_API_KEY` |
| `OFFICIAL_IMAGEGEN_PATH` | 否 | 默认 `~/.codex/skills/.system/imagegen/scripts/image_gen.py` |
| `IMAGE_STUDIO_OUTPUT_DIR` | 否 | 图片自动保存目录，默认 `generated`（相对路径基于项目根目录） |
| `APIMART_OUTPUT_DIR` | 否 | 旧变量名，仍兼容，优先级低于 `IMAGE_STUDIO_OUTPUT_DIR` |

### Python 依赖与 `uv`

项目根目录的 `pyproject.toml` 声明了 `local-imagegen` 所需的 Python 依赖（`openai`、`pillow`）。服务端调用 `image_gen.py` 时运行顺序如下：

1. 优先使用项目根目录 `.venv/bin/python`；
2. 再尝试官方 imagegen skill 自带的 `.venv`；
3. 如果仓库存在 `pyproject.toml` 且系统安装了 `uv`，则使用 `uv run python3`；
4. 最后才回退到一次性的 `uv run --with openai --with pillow python3`。

推荐做法是用 `uv sync` 把 Python 环境固定下来，而不是依赖临时回退。

### 部署 / 自托管

- 只用 APIMart：导入仓库后在 Project Settings → Environment Variables 添加 `APIMART_API_KEY` 即可。
- 还要用自定义 URL/Key：额外配置 `LOCAL_IMAGEGEN_BASE_URL`、`LOCAL_IMAGEGEN_API_KEY`（如需再配 `OFFICIAL_IMAGEGEN_PATH`），并确保构建前执行过 `uv sync`。
- 自托管：

  ```bash
  npm install
  uv sync
  npm run build
  npm run start
  ```

> 注意：Vercel 这类无持久文件系统的平台并不适合依赖本地文件产物的长期保存；官方 `image_gen.py` 通道 + 服务端落盘更推荐用于本地 / 自托管环境。如果你想要纯在线、零运维的部署，请用上面的**云端版**（`cloud-frontend` 分支）。

---

## 其它说明

- `gpt-image-2` 比例不要传 `auto`；想用默认比例就不选（留空）。
- 分辨率 `4k` 仅支持 `16:9 / 9:16 / 2:1 / 1:2 / 21:9 / 9:21`，且只在官方通道模型下可用。
- 自定义 URL/Key 模式会把比例映射成固定尺寸（如 `1:1` → `1024x1024`），具体是否被接受取决于你的 endpoint 与模型；当前只暴露最小参数集：`prompt / 参考图 / 比例 / quality / 模型名`。

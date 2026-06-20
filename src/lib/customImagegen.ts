// Client-side replacement for the old local-imagegen provider. The original
// `image_gen.py` was just a CLI wrapper around the OpenAI Images REST API
// (`/images/generations` and `/images/edits`), so in the cloud build we make
// those HTTP calls directly from the browser against a user-configured,
// OpenAI-compatible endpoint. Results come back as base64 and are kept locally.

import {
  DEFAULT_LOCAL_IMAGEGEN_QUALITY,
  LOCAL_IMAGEGEN_DISABLED_SIZES,
  LOCAL_IMAGEGEN_QUALITIES,
  LOCAL_IMAGEGEN_SIZE_MAP,
  MAX_REFERENCE_IMAGES,
  type LocalImageQuality,
} from "@/lib/constants";
import { dataUrlToBlob } from "@/lib/imageDb";
import type { GenerateRequest } from "@/lib/types";

export interface CustomCredentials {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export class CustomImagegenError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = "CustomImagegenError";
    this.status = status;
  }
}

export interface CustomResult {
  // base64-encoded PNG data URLs, ready to store/display.
  images: string[];
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

function normalizeQuality(input?: string): LocalImageQuality {
  const quality = (input?.trim() || DEFAULT_LOCAL_IMAGEGEN_QUALITY) as LocalImageQuality;
  if (!LOCAL_IMAGEGEN_QUALITIES.includes(quality)) {
    throw new CustomImagegenError(
      `不支持的 quality：${input}。可选值：${LOCAL_IMAGEGEN_QUALITIES.join(", ")}。`,
      400,
    );
  }
  return quality;
}

function normalizeSize(input?: string): string {
  const size = input?.trim();
  if (!size) return "auto";
  if (LOCAL_IMAGEGEN_DISABLED_SIZES.includes(size as (typeof LOCAL_IMAGEGEN_DISABLED_SIZES)[number])) {
    throw new CustomImagegenError(
      `自定义 URL/Key 暂不支持比例 ${size}。当前仅支持到 2:1 / 1:2，21:9 和 9:21 已禁用。`,
      400,
    );
  }
  const mapped = LOCAL_IMAGEGEN_SIZE_MAP[size as keyof typeof LOCAL_IMAGEGEN_SIZE_MAP];
  if (!mapped) {
    throw new CustomImagegenError(`不支持的比例：${size}`, 400);
  }
  return mapped;
}

function requireCredentials(credentials: CustomCredentials): CustomCredentials {
  const baseUrl = normalizeBaseUrl(credentials.baseUrl ?? "");
  const apiKey = credentials.apiKey?.trim() ?? "";
  const model = credentials.model?.trim() ?? "";
  if (!baseUrl) {
    throw new CustomImagegenError("未配置自定义 Base URL。请在「设置」中填写。", 400);
  }
  if (!apiKey) {
    throw new CustomImagegenError("未配置自定义 API Key。请在「设置」中填写。", 400);
  }
  if (!model) {
    throw new CustomImagegenError("未配置自定义模型名。请在「设置」中填写。", 400);
  }
  return { baseUrl, apiKey, model };
}

function extFromMime(mime: string): string {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  return "png";
}

async function readError(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } | string };
    if (typeof parsed.error === "string") return parsed.error;
    if (parsed.error && typeof parsed.error.message === "string") return parsed.error.message;
  } catch {
    // Not JSON; fall through to raw text.
  }
  return text || `HTTP ${res.status}`;
}

// Normalizes the OpenAI Images response (b64_json or url) to data URLs.
async function parseImagesResponse(res: Response): Promise<string[]> {
  let parsed: { data?: Array<{ b64_json?: string; url?: string }> };
  try {
    parsed = (await res.json()) as typeof parsed;
  } catch {
    throw new CustomImagegenError("接口返回了非 JSON 响应。", 502);
  }
  const data = parsed.data ?? [];
  const images: string[] = [];
  for (const item of data) {
    if (item.b64_json) {
      images.push(`data:image/png;base64,${item.b64_json}`);
    } else if (item.url) {
      images.push(item.url);
    }
  }
  if (images.length === 0) {
    throw new CustomImagegenError("接口未返回图片。", 502);
  }
  return images;
}

async function postJson(
  url: string,
  apiKey: string,
  body: unknown,
): Promise<Response> {
  try {
    return await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new CustomImagegenError(
      `无法连接自定义接口：${err instanceof Error ? err.message : String(err)}。请检查 URL 是否正确且允许跨域 (CORS)。`,
      502,
    );
  }
}

async function postForm(
  url: string,
  apiKey: string,
  form: FormData,
): Promise<Response> {
  try {
    return await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      body: form,
    });
  } catch (err) {
    throw new CustomImagegenError(
      `无法连接自定义接口：${err instanceof Error ? err.message : String(err)}。请检查 URL 是否正确且允许跨域 (CORS)。`,
      502,
    );
  }
}

export async function generateWithCustom(
  request: GenerateRequest,
  credentials: CustomCredentials,
): Promise<CustomResult> {
  const prompt = (request.prompt ?? "").trim();
  if (!prompt) {
    throw new CustomImagegenError("prompt 不能为空。", 400);
  }

  const imageUrls = request.imageUrls ?? [];
  if (imageUrls.length > MAX_REFERENCE_IMAGES) {
    throw new CustomImagegenError(`参考图最多 ${MAX_REFERENCE_IMAGES} 张。`, 400);
  }

  const { baseUrl, apiKey, model } = requireCredentials(credentials);
  const size = normalizeSize(request.size);
  const quality = normalizeQuality(request.quality);

  let res: Response;
  if (imageUrls.length > 0) {
    const form = new FormData();
    form.append("model", model);
    form.append("prompt", prompt);
    form.append("size", size);
    form.append("quality", quality);
    form.append("n", "1");
    imageUrls.forEach((dataUrl, index) => {
      const blob = dataUrlToBlob(dataUrl);
      const ext = extFromMime(blob.type);
      form.append("image[]", blob, `reference-${index + 1}.${ext}`);
    });
    res = await postForm(`${baseUrl}/images/edits`, apiKey, form);
  } else {
    res = await postJson(`${baseUrl}/images/generations`, apiKey, {
      model,
      prompt,
      n: 1,
      size,
      quality,
    });
  }

  if (!res.ok) {
    throw new CustomImagegenError(
      `自定义接口返回 HTTP ${res.status}：${await readError(res)}`,
      res.status,
    );
  }

  return { images: await parseImagesResponse(res) };
}

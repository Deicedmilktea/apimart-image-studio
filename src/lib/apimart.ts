// Server-side helpers for talking to the APIMart image generation API.
// Ported from the user's apimart_gpt_image_2.py CLI skill.

import {
  FOUR_K_SUPPORTED_SIZES,
  MAX_REFERENCE_IMAGES,
  OFFICIAL_IMAGE_MODEL,
  STANDARD_IMAGE_MODEL,
  SUPPORTED_MODELS,
  SUPPORTED_RESOLUTIONS,
  SUPPORTED_SIZES,
  type ImageModel,
  type ImageResolution,
  type ImageSize,
} from "@/lib/constants";

export const DEFAULT_BASE_URL = "https://api.apimart.ai/v1";

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";

export class ApimartError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.name = "ApimartError";
    this.status = status;
  }
}

export interface GeneratePayload {
  model: ImageModel;
  prompt: string;
  n: number;
  size?: ImageSize;
  image_urls?: string[];
  official_fallback?: boolean;
  resolution?: ImageResolution;
}

export interface GenerateRequest {
  prompt: string;
  model?: string;
  size?: string;
  imageUrls?: string[];
  officialFallback?: boolean;
  resolution?: string;
}

function getBaseUrl(): string {
  return process.env.APIMART_BASE_URL?.trim() || DEFAULT_BASE_URL;
}

function requireApiKey(): string {
  const key = process.env.APIMART_API_KEY;
  if (!key) {
    throw new ApimartError(
      "服务端未配置 APIMART_API_KEY。请在 .env.local 中设置后重启。",
      500,
    );
  }
  return key;
}

export function buildGenerationPayload(req: GenerateRequest): GeneratePayload {
  const prompt = (req.prompt ?? "").trim();
  if (!prompt) {
    throw new ApimartError("prompt 不能为空。", 400);
  }

  const model = (req.model?.trim() || STANDARD_IMAGE_MODEL) as ImageModel;
  if (!SUPPORTED_MODELS.includes(model)) {
    throw new ApimartError(`不支持的模型：${model}`, 400);
  }

  const size = req.size?.trim() || undefined;
  if (size && !SUPPORTED_SIZES.includes(size as ImageSize)) {
    throw new ApimartError(`不支持的比例：${size}`, 400);
  }

  const resolution = req.resolution?.trim() || undefined;
  if (resolution && !SUPPORTED_RESOLUTIONS.includes(resolution as ImageResolution)) {
    throw new ApimartError(`不支持的分辨率：${resolution}`, 400);
  }

  const imageUrls = req.imageUrls ?? [];
  if (imageUrls.length > MAX_REFERENCE_IMAGES) {
    throw new ApimartError(`参考图最多 ${MAX_REFERENCE_IMAGES} 张。`, 400);
  }

  if (resolution && model !== OFFICIAL_IMAGE_MODEL) {
    throw new ApimartError(
      `resolution 仅在 ${OFFICIAL_IMAGE_MODEL} 模型下支持。`,
      400,
    );
  }
  if (req.officialFallback && model !== STANDARD_IMAGE_MODEL) {
    throw new ApimartError(
      `official_fallback 仅在 ${STANDARD_IMAGE_MODEL} 模型下支持。`,
      400,
    );
  }
  if (resolution === "4k" && (!size || !FOUR_K_SUPPORTED_SIZES.includes(size))) {
    throw new ApimartError(
      `分辨率 4k 仅支持以下比例：${FOUR_K_SUPPORTED_SIZES.join(", ")}。`,
      400,
    );
  }

  const payload: GeneratePayload = { model, prompt, n: 1 };
  if (size) payload.size = size as ImageSize;
  if (imageUrls.length > 0) payload.image_urls = imageUrls;
  if (model === STANDARD_IMAGE_MODEL) payload.official_fallback = Boolean(req.officialFallback);
  if (resolution) payload.resolution = resolution as ImageResolution;
  return payload;
}

async function apiRequestJson(
  method: "GET" | "POST",
  url: string,
  apiKey: string,
  body?: unknown,
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json",
    "User-Agent": BROWSER_USER_AGENT,
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch (err) {
    throw new ApimartError(
      `无法连接 APIMart：${err instanceof Error ? err.message : String(err)}`,
      502,
    );
  }

  const text = await res.text();
  if (!res.ok) {
    throw new ApimartError(`APIMart 返回 HTTP ${res.status}: ${text}`, res.status);
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new ApimartError(`APIMart 返回了非 JSON 响应: ${text}`, 502);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The submit endpoint returns data as an array; the status endpoint returns data
// as an object. This normalizes both shapes to a single object.
function extractDataObject(response: Record<string, unknown>): Record<string, unknown> {
  const data = response.data;
  if (isRecord(data)) return data;
  if (Array.isArray(data)) {
    for (const item of data) {
      if (isRecord(item)) return item;
    }
  }
  return {};
}

export function extractTaskId(response: Record<string, unknown>): string {
  const data = extractDataObject(response);
  const taskId = data.task_id ?? data.id;
  if (typeof taskId === "string" && taskId) return taskId;
  throw new ApimartError("APIMart 响应中没有 task_id。", 502);
}

export function extractStatus(response: Record<string, unknown>): string {
  const data = extractDataObject(response);
  const status = data.status;
  return typeof status === "string" ? status : "";
}

export function extractError(response: Record<string, unknown>): string | undefined {
  const data = extractDataObject(response);
  const err = data.error;
  if (typeof err === "string") return err;
  if (isRecord(err) && typeof err.message === "string") return err.message;
  if (err != null) return JSON.stringify(err);
  return undefined;
}

// Final downloadable URLs live at data.result.images[].url (url may be string or array).
export function extractImageUrls(response: Record<string, unknown>): string[] {
  const data = extractDataObject(response);
  const result = data.result;
  if (!isRecord(result)) return [];
  const images = result.images;
  if (!Array.isArray(images)) return [];

  const urls: string[] = [];
  for (const image of images) {
    if (!isRecord(image)) continue;
    const url = image.url;
    if (Array.isArray(url)) {
      for (const item of url) {
        if (typeof item === "string" && item) urls.push(item);
      }
    } else if (typeof url === "string" && url) {
      urls.push(url);
    }
  }
  return urls;
}

export async function submitGeneration(payload: GeneratePayload): Promise<{
  taskId: string;
  status: string;
  raw: Record<string, unknown>;
}> {
  const apiKey = requireApiKey();
  const response = await apiRequestJson(
    "POST",
    `${getBaseUrl()}/images/generations`,
    apiKey,
    payload,
  );
  const taskId = extractTaskId(response);
  return { taskId, status: extractStatus(response) || "submitted", raw: response };
}

export interface TaskResult {
  taskId: string;
  status: string;
  images: string[];
  error?: string;
  raw: Record<string, unknown>;
}

export async function getTaskStatus(taskId: string, language = "en"): Promise<TaskResult> {
  const apiKey = requireApiKey();
  const url = `${getBaseUrl()}/tasks/${encodeURIComponent(taskId)}?language=${encodeURIComponent(language)}`;
  const response = await apiRequestJson("GET", url, apiKey);
  return {
    taskId,
    status: extractStatus(response),
    images: extractImageUrls(response),
    error: extractError(response),
    raw: response,
  };
}

// TypeScript wrapper around the official imagegen CLI. It reads the project's
// env files, maps LOCAL_IMAGEGEN_* to OPENAI_* for the child process, and then
// delegates all actual image generation/editing to image_gen.py.

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_LOCAL_IMAGEGEN_QUALITY,
  LOCAL_IMAGEGEN_DISABLED_SIZES,
  LOCAL_IMAGEGEN_MODEL_LABEL,
  LOCAL_IMAGEGEN_PROVIDER,
  LOCAL_IMAGEGEN_QUALITIES,
  LOCAL_IMAGEGEN_SIZE_MAP,
  MAX_REFERENCE_IMAGES,
  type ImageSize,
  type LocalImageQuality,
} from "@/lib/constants";
import { buildLocalImageUrl, ensureOutputDir, getOutputDir, type SavedImageInfo } from "@/lib/storage";
import type { GenerateRequest } from "@/lib/types";

const DEFAULT_OFFICIAL_IMAGEGEN_PATH = path.join(
  os.homedir(),
  ".codex",
  "skills",
  ".system",
  "imagegen",
  "scripts",
  "image_gen.py",
);

const DATA_URL_PATTERN = /^data:([^;,]+)?;base64,(.+)$/;

export class LocalImagegenError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = "LocalImagegenError";
    this.status = status;
  }
}

interface DotenvSource {
  path?: string;
  values: Record<string, string>;
}

interface LocalImagegenResult {
  taskId: string;
  status: "completed";
  provider: typeof LOCAL_IMAGEGEN_PROVIDER;
  images: string[];
  saved: SavedImageInfo[];
  savedDir: string;
}

interface PythonRuntime {
  command: string;
  args: string[];
  description: string;
}

function expandHome(inputPath: string): string {
  if (inputPath === "~") return os.homedir();
  if (inputPath.startsWith("~/")) return path.join(os.homedir(), inputPath.slice(2));
  return inputPath;
}

function parseDotenv(raw: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of raw.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice(7).trim();

    const separator = line.indexOf("=");
    if (separator <= 0) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

async function loadProjectDotenv(): Promise<DotenvSource> {
  const projectRoot = /* turbopackIgnore: true */ process.cwd();
  const candidates = [
    path.join(projectRoot, ".env.local"),
    path.join(projectRoot, ".env"),
  ];

  for (const candidate of candidates) {
    try {
      const raw = await readFile(candidate, "utf-8");
      return { path: candidate, values: parseDotenv(raw) };
    } catch {
      // Ignore missing env files; runtime env fallback may still exist.
    }
  }
  return { values: {} };
}

function pickEnvValue(dotenv: DotenvSource, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const fromDotenv = dotenv.values[key]?.trim();
    if (fromDotenv) return fromDotenv;
    const fromRuntime = process.env[key]?.trim();
    if (fromRuntime) return fromRuntime;
  }
  return undefined;
}

async function resolveOfficialImagegenPath(): Promise<string> {
  const configured = process.env.OFFICIAL_IMAGEGEN_PATH?.trim();
  const resolved = expandHome(configured || DEFAULT_OFFICIAL_IMAGEGEN_PATH);
  try {
    await access(resolved);
  } catch {
    throw new LocalImagegenError(
      `官方 imagegen 脚本不存在：${resolved}。请检查 OFFICIAL_IMAGEGEN_PATH。`,
      500,
    );
  }
  return resolved;
}

async function commandHasOpenAI(command: string, args: string[] = []): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command, [...args, "-c", "import openai"], {
      cwd: /* turbopackIgnore: true */ process.cwd(),
      stdio: ["ignore", "ignore", "ignore"],
    });

    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

async function commandExists(command: string, args: string[] = ["--version"]): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: /* turbopackIgnore: true */ process.cwd(),
      stdio: ["ignore", "ignore", "ignore"],
    });

    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

async function hasProjectUvConfig(): Promise<boolean> {
  const projectRoot = /* turbopackIgnore: true */ process.cwd();
  try {
    await access(path.join(projectRoot, "pyproject.toml"));
    return true;
  } catch {
    return false;
  }
}

async function resolvePythonRuntime(): Promise<PythonRuntime> {
  const candidates = [
    path.join(process.cwd(), ".venv", "bin", "python"),
    path.join(process.cwd(), ".venv", "bin", "python3"),
    path.join(os.homedir(), ".codex", "skills", ".system", "imagegen", ".venv", "bin", "python"),
    path.join(os.homedir(), ".codex", "skills", ".system", "imagegen", ".venv", "bin", "python3"),
  ];

  for (const command of candidates) {
    if (await commandHasOpenAI(command)) {
      return { command, args: [], description: command };
    }
  }

  if (await commandExists("uv")) {
    if (await hasProjectUvConfig() && await commandHasOpenAI("uv", ["run", "python3"])) {
      return {
        command: "uv",
        args: ["run", "python3"],
        description: "uv run python3",
      };
    }

    return {
      command: "uv",
      args: ["run", "--with", "openai", "--with", "pillow", "python3"],
      description: "uv run --with openai --with pillow python3",
    };
  }

  for (const command of ["python3", "python"]) {
    if (await commandHasOpenAI(command)) {
      return { command, args: [], description: command };
    }
  }

  throw new LocalImagegenError(
    "当前环境缺少 openai SDK。请先运行 `uv sync`，或提供可用的 Python 解释器。",
    500,
  );
}

function normalizeQuality(input?: string): LocalImageQuality {
  const quality = (input?.trim() || DEFAULT_LOCAL_IMAGEGEN_QUALITY) as LocalImageQuality;
  if (!LOCAL_IMAGEGEN_QUALITIES.includes(quality)) {
    throw new LocalImagegenError(
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
    throw new LocalImagegenError(
      `自定义 URL/Key 暂不支持比例 ${size}。当前仅支持到 2:1 / 1:2，21:9 和 9:21 已禁用。`,
      400,
    );
  }
  const mapped = LOCAL_IMAGEGEN_SIZE_MAP[size as keyof typeof LOCAL_IMAGEGEN_SIZE_MAP];
  if (!mapped) {
    throw new LocalImagegenError(`不支持的比例：${size}`, 400);
  }
  return mapped;
}

function parseDataUrl(dataUrl: string): { mimeType: string; buffer: Buffer; ext: string } {
  const match = dataUrl.match(DATA_URL_PATTERN);
  if (!match) {
    throw new LocalImagegenError("参考图不是合法的 data URL。", 400);
  }

  const mimeType = match[1] || "image/png";
  const base64 = match[2];
  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64, "base64");
  } catch {
    throw new LocalImagegenError("参考图 base64 解码失败。", 400);
  }

  const ext = mimeType === "image/jpeg"
    ? "jpg"
    : mimeType === "image/webp"
      ? "webp"
      : mimeType === "image/gif"
        ? "gif"
        : "png";

  return { mimeType, buffer, ext };
}

async function writeReferenceImages(tempDir: string, imageUrls: string[]): Promise<string[]> {
  const files: string[] = [];
  for (let i = 0; i < imageUrls.length; i++) {
    const { buffer, ext } = parseDataUrl(imageUrls[i]);
    const filename = path.join(tempDir, `reference-${i + 1}.${ext}`);
    try {
      await writeFile(filename, buffer);
    } catch {
      throw new LocalImagegenError(`参考图写入失败：reference-${i + 1}.${ext}`, 500);
    }
    files.push(filename);
  }
  return files;
}

function createChildEnv(baseUrl: string, apiKey: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    OPENAI_BASE_URL: baseUrl,
    OPENAI_API_KEY: apiKey,
  };
}

async function runOfficialImagegen(
  scriptPath: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ stdout: string; stderr: string }> {
  const runtime = await resolvePythonRuntime();
  return new Promise((resolve, reject) => {
    const child = spawn(runtime.command, [...runtime.args, scriptPath, ...args], {
      cwd: /* turbopackIgnore: true */ process.cwd(),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      reject(
        new LocalImagegenError(
          `无法启动官方 imagegen 脚本：${err.message}。当前运行方式：${runtime.description}。`,
          500,
        ),
      );
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const detail = stderr.trim() || stdout.trim() || `退出码 ${code ?? "unknown"}`;
      reject(new LocalImagegenError(`官方 imagegen 执行失败：${detail}`, 502));
    });
  });
}

function createSavedInfo(filename: string, filePath: string): SavedImageInfo {
  return {
    filename,
    path: filePath,
    url: buildLocalImageUrl(filename),
  };
}

export async function generateWithLocalImagegen(
  request: GenerateRequest,
): Promise<LocalImagegenResult> {
  const prompt = (request.prompt ?? "").trim();
  if (!prompt) {
    throw new LocalImagegenError("prompt 不能为空。", 400);
  }

  const imageUrls = request.imageUrls ?? [];
  if (imageUrls.length > MAX_REFERENCE_IMAGES) {
    throw new LocalImagegenError(`参考图最多 ${MAX_REFERENCE_IMAGES} 张。`, 400);
  }

  const size = normalizeSize(request.size as ImageSize | undefined);
  const quality = normalizeQuality(request.quality);
  const dotenv = await loadProjectDotenv();
  const baseUrl = pickEnvValue(dotenv, "LOCAL_IMAGEGEN_BASE_URL", "OPENAI_BASE_URL");
  const apiKey = pickEnvValue(dotenv, "LOCAL_IMAGEGEN_API_KEY", "OPENAI_API_KEY");

  if (!baseUrl) {
    const location = dotenv.path ? `${dotenv.path} 或运行环境` : "运行环境";
    throw new LocalImagegenError(
      `未配置 LOCAL_IMAGEGEN_BASE_URL（或 OPENAI_BASE_URL）。请检查 ${location}。`,
      500,
    );
  }
  if (!apiKey) {
    const location = dotenv.path ? `${dotenv.path} 或运行环境` : "运行环境";
    throw new LocalImagegenError(
      `未配置 LOCAL_IMAGEGEN_API_KEY（或 OPENAI_API_KEY）。请检查 ${location}。`,
      500,
    );
  }

  const scriptPath = await resolveOfficialImagegenPath();
  const outputDir = await ensureOutputDir();
  const taskId = `local-imagegen-${randomUUID()}`;
  const filename = `${taskId}.png`;
  const outputPath = path.join(outputDir, filename);
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "local-imagegen-"));

  try {
    const args = imageUrls.length > 0 ? ["edit"] : ["generate"];
    args.push("--prompt", prompt, "--size", size, "--quality", quality, "--out", outputPath);

    if (imageUrls.length > 0) {
      const referencePaths = await writeReferenceImages(tempDir, imageUrls);
      for (const referencePath of referencePaths) {
        args.push("--image", referencePath);
      }
    }

    await runOfficialImagegen(scriptPath, args, createChildEnv(baseUrl, apiKey));

    try {
      await access(outputPath);
    } catch {
      throw new LocalImagegenError("官方 imagegen 执行成功，但没有生成输出文件。", 502);
    }

    const saved = [createSavedInfo(filename, outputPath)];
    return {
      taskId,
      status: "completed",
      provider: LOCAL_IMAGEGEN_PROVIDER,
      images: saved.map((item) => item.url),
      saved,
      savedDir: getOutputDir(),
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export { LOCAL_IMAGEGEN_MODEL_LABEL };

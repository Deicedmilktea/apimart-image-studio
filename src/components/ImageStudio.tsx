"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  APIMART_PROVIDER,
  DEFAULT_LOCAL_IMAGEGEN_QUALITY,
  FOUR_K_SUPPORTED_SIZES,
  LOCAL_IMAGEGEN_DISABLED_SIZES,
  LOCAL_IMAGEGEN_MODEL_HINT,
  LOCAL_IMAGEGEN_PROVIDER,
  LOCAL_IMAGEGEN_QUALITIES,
  MAX_REFERENCE_IMAGES,
  MODEL_LABELS,
  OFFICIAL_IMAGE_MODEL,
  PROVIDER_LABELS,
  STANDARD_IMAGE_MODEL,
  SUPPORTED_MODELS,
  SUPPORTED_RESOLUTIONS,
  SUPPORTED_SIZES,
  type ImageModel,
  type ImageProvider,
  type LocalImageQuality,
} from "@/lib/constants";
import {
  ApimartError,
  buildGenerationPayload,
  getTaskStatus,
  submitGeneration,
} from "@/lib/apimart";
import { CustomImagegenError, generateWithCustom } from "@/lib/customImagegen";
import {
  cacheBlob,
  cacheRemoteImage,
  clearImages,
  dataUrlToBlob,
  deleteImages,
  getImage,
} from "@/lib/imageDb";
import {
  type AppConfig,
  defaultConfig,
  loadConfig,
  saveConfig,
} from "@/lib/config";
import type { HistoryItem, ReferenceImage, StoredImage } from "@/lib/types";

const HISTORY_KEY = "apimart-image-studio:history";
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 180_000;

type Phase = "idle" | "submitting" | "polling" | "done" | "error";

function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function imageIds(images: StoredImage[]): string[] {
  return images.map((img) => img.id).filter((id): id is string => Boolean(id));
}

// Resolves a StoredImage to a usable <img> src: prefers the locally cached
// bytes (IndexedDB), falling back to the original remote URL.
function useImageSrc(image: StoredImage): string | undefined {
  const [objectUrl, setObjectUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!image.id) return;
    let cancelled = false;
    let created: string | undefined;

    getImage(image.id)
      .then((blob) => {
        if (cancelled || !blob) return;
        created = URL.createObjectURL(blob);
        setObjectUrl(created);
      })
      .catch(() => {
        // Fall back to the remote URL below.
      });

    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [image.id]);

  return objectUrl ?? image.url;
}

async function blobUrlForImage(image: StoredImage): Promise<string | undefined> {
  if (image.id) {
    const blob = await getImage(image.id);
    if (blob) return URL.createObjectURL(blob);
  }
  return undefined;
}

async function downloadStoredImage(image: StoredImage, filename: string) {
  const objectUrl = await blobUrlForImage(image);
  if (objectUrl) {
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
    return;
  }
  if (!image.url) return;
  try {
    const res = await fetch(image.url, { mode: "cors" });
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(blobUrl);
  } catch {
    window.open(image.url, "_blank", "noopener,noreferrer");
  }
}

function sanitizeLocalImagegenSize(size?: string): string {
  if (!size) return "";
  return LOCAL_IMAGEGEN_DISABLED_SIZES.includes(
    size as (typeof LOCAL_IMAGEGEN_DISABLED_SIZES)[number],
  )
    ? ""
    : size;
}

export default function ImageStudio() {
  const [prompt, setPrompt] = useState("");
  const [provider, setProvider] = useState<ImageProvider>(APIMART_PROVIDER);
  const [model, setModel] = useState<ImageModel>(STANDARD_IMAGE_MODEL);
  const [size, setSize] = useState<string>("");
  const [resolution, setResolution] = useState<string>("");
  const [officialFallback, setOfficialFallback] = useState(true);
  const [quality, setQuality] = useState<LocalImageQuality>(DEFAULT_LOCAL_IMAGEGEN_QUALITY);
  const [references, setReferences] = useState<ReferenceImage[]>([]);

  const [phase, setPhase] = useState<Phase>("idle");
  const [statusText, setStatusText] = useState<string>("");
  const [images, setImages] = useState<StoredImage[]>([]);
  const [error, setError] = useState<string>("");
  const [history, setHistory] = useState<HistoryItem[]>([]);

  const [config, setConfig] = useState<AppConfig>(defaultConfig());
  const [settingsOpen, setSettingsOpen] = useState(false);

  const cancelRef = useRef(false);
  const busy = phase === "submitting" || phase === "polling";

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) setConfig(loadConfig());
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      try {
        const raw = localStorage.getItem(HISTORY_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as HistoryItem[];
          setHistory(
            parsed
              .filter((item) => Array.isArray(item.images))
              .map((item) => ({
                ...item,
                provider: item.provider ?? APIMART_PROVIDER,
              })),
          );
        }
      } catch {
        // Ignore malformed history.
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const persistHistory = useCallback((items: HistoryItem[]) => {
    setHistory(items);
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 50)));
    } catch {
      // Storage may be full or unavailable; non-fatal.
    }
  }, []);

  const isOfficial = model === OFFICIAL_IMAGE_MODEL;
  const isApimart = provider === APIMART_PROVIDER;
  const isLocalImagegen = provider === LOCAL_IMAGEGEN_PROVIDER;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const providerConfigured = isApimart
    ? Boolean(config.apimartApiKey)
    : Boolean(config.customBaseUrl && config.customApiKey && config.customModel);

  const handleReferenceFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const incoming: ReferenceImage[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      try {
        const dataUrl = await readFileAsDataUrl(file);
        incoming.push({ id: uid(), name: file.name, dataUrl });
      } catch {
        // Skip files that fail to read.
      }
    }
    setReferences((prev) => [...prev, ...incoming].slice(0, MAX_REFERENCE_IMAGES));
  };

  const removeReference = (id: string) =>
    setReferences((prev) => prev.filter((r) => r.id !== id));

  const reset = () => {
    cancelRef.current = true;
    setPhase("idle");
    setError("");
    setStatusText("");
  };

  const finish = useCallback(
    (stored: StoredImage[], item: HistoryItem) => {
      setImages(stored);
      setPhase("done");
      setStatusText("");
      persistHistory([item, ...history.filter((h) => h.id !== item.id)]);
    },
    [history, persistHistory],
  );

  const generate = useCallback(async () => {
    const trimmed = prompt.trim();
    if (!trimmed || busy) return;

    cancelRef.current = false;
    setError("");
    setImages([]);
    setPhase("submitting");
    setStatusText("正在提交任务…");

    const request = {
      provider,
      prompt: trimmed,
      model: isApimart ? model : undefined,
      size: size || undefined,
      resolution: isApimart && isOfficial ? resolution || undefined : undefined,
      officialFallback: isApimart && !isOfficial ? officialFallback : undefined,
      quality: isLocalImagegen ? quality : undefined,
      imageUrls: references.map((r) => r.dataUrl),
    };

    try {
      if (isLocalImagegen) {
        setStatusText("正在生成图片…");
        const result = await generateWithCustom(request, {
          baseUrl: config.customBaseUrl,
          apiKey: config.customApiKey,
          model: config.customModel,
        });
        if (cancelRef.current) return;
        const stored: StoredImage[] = await Promise.all(
          result.images.map(async (dataUrl) => {
            const id = await cacheBlob(dataUrlToBlob(dataUrl));
            return id ? { id } : { url: dataUrl };
          }),
        );
        if (cancelRef.current) return;
        finish(stored, {
          id: uid(),
          prompt: trimmed,
          provider,
          modelLabel: config.customModel,
          quality,
          size: size || undefined,
          images: stored,
          createdAt: Date.now(),
        });
        return;
      }

      const credentials = {
        apiKey: config.apimartApiKey,
        baseUrl: config.apimartBaseUrl,
      };
      const payload = buildGenerationPayload(request);
      const { taskId } = await submitGeneration(payload, credentials);
      if (cancelRef.current) return;

      setPhase("polling");
      setStatusText("已提交，正在生成图片…");

      const deadline = Date.now() + POLL_TIMEOUT_MS;
      while (Date.now() < deadline) {
        if (cancelRef.current) return;
        await sleep(POLL_INTERVAL_MS);
        if (cancelRef.current) return;

        const task = await getTaskStatus(taskId, credentials);
        const status = task.status || "";
        setStatusText(`生成中… (状态: ${status || "处理中"})`);

        if (status === "completed") {
          const urls = task.images;
          if (urls.length === 0) throw new Error("任务完成但没有返回图片 URL。");
          const stored: StoredImage[] = await Promise.all(
            urls.map(async (url) => {
              const id = await cacheRemoteImage(url);
              return { id, url };
            }),
          );
          if (cancelRef.current) return;
          finish(stored, {
            id: taskId,
            prompt: trimmed,
            provider,
            model,
            modelLabel: MODEL_LABELS[model],
            size: size || undefined,
            images: stored,
            createdAt: Date.now(),
          });
          return;
        }
        if (status === "failed") {
          throw new Error(task.error || "任务失败。");
        }
      }
      throw new Error("生成超时，请稍后重试。");
    } catch (err) {
      if (cancelRef.current) return;
      setPhase("error");
      setStatusText("");
      if (err instanceof ApimartError || err instanceof CustomImagegenError) {
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : "未知错误");
      }
    }
  }, [
    prompt,
    busy,
    provider,
    model,
    size,
    resolution,
    isOfficial,
    isApimart,
    isLocalImagegen,
    officialFallback,
    quality,
    references,
    config,
    finish,
  ]);

  const handleDeleteHistory = useCallback(
    (item: HistoryItem) => {
      void deleteImages(imageIds(item.images));
      persistHistory(history.filter((h) => h.id !== item.id));
    },
    [history, persistHistory],
  );

  const handleClearHistory = useCallback(() => {
    void clearImages();
    persistHistory([]);
  }, [persistHistory]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6 lg:flex-row lg:items-start">
      <button
        type="button"
        onClick={() => setSettingsOpen(true)}
        className="fixed right-4 top-3 z-30 flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-sm text-white/70 shadow backdrop-blur hover:bg-white/10"
        data-testid="open-settings"
      >
        <span aria-hidden>⚙</span> 设置
      </button>

      {settingsOpen ? (
        <SettingsModal
          config={config}
          onClose={() => setSettingsOpen(false)}
          onSave={(next) => {
            saveConfig(next);
            setConfig(next);
            setSettingsOpen(false);
          }}
        />
      ) : null}

      {/* Main column */}
      <div className="flex flex-1 flex-col gap-5">
        <ResultArea phase={phase} statusText={statusText} error={error} images={images} />

        {/* Composer */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 shadow-lg">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                void generate();
              }
            }}
            placeholder="描述你想生成的画面，例如：夕阳下窗台上的橘猫，水彩风格…"
            rows={3}
            className="w-full resize-none bg-transparent text-base outline-none placeholder:text-white/30"
            data-testid="prompt-input"
          />

          <ReferenceStrip
            references={references}
            onRemove={removeReference}
            onAdd={handleReferenceFiles}
            disabled={busy}
          />

          <div className="mt-3 flex flex-wrap items-end gap-3">
            <Field label="通道">
              <select
                value={provider}
                onChange={(e) => {
                  const nextProvider = e.target.value as ImageProvider;
                  setProvider(nextProvider);
                  if (nextProvider === LOCAL_IMAGEGEN_PROVIDER) {
                    setSize((current) => sanitizeLocalImagegenSize(current));
                  }
                }}
                disabled={busy}
                className="select"
                data-testid="provider-select"
              >
                {Object.entries(PROVIDER_LABELS).map(([value, label]) => (
                  <option key={value} value={value} className="bg-zinc-900">
                    {label}
                  </option>
                ))}
              </select>
            </Field>

            {isApimart ? (
              <Field label="模型">
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value as ImageModel)}
                  disabled={busy}
                  className="select"
                  data-testid="model-select"
                >
                  {SUPPORTED_MODELS.map((m) => (
                    <option key={m} value={m} className="bg-zinc-900">
                      {MODEL_LABELS[m]}
                    </option>
                  ))}
                </select>
              </Field>
            ) : (
              <Field label="模型">
                <select
                  value={config.customModel || "未配置"}
                  disabled
                  className="select w-[10.5rem] max-w-[calc(100vw-4rem)]"
                  data-testid="local-imagegen-model"
                  title={LOCAL_IMAGEGEN_MODEL_HINT}
                >
                  <option value={config.customModel || "未配置"} className="bg-zinc-900">
                    {config.customModel || "未配置"}
                  </option>
                </select>
              </Field>
            )}

            <Field label="比例">
              <select
                value={size}
                onChange={(e) => setSize(e.target.value)}
                disabled={busy}
                className="select"
                data-testid="size-select"
              >
                <option value="" className="bg-zinc-900">
                  默认
                </option>
                {SUPPORTED_SIZES.map((s) => (
                  <option
                    key={s}
                    value={s}
                    disabled={
                      isLocalImagegen &&
                      LOCAL_IMAGEGEN_DISABLED_SIZES.includes(
                        s as (typeof LOCAL_IMAGEGEN_DISABLED_SIZES)[number],
                      )
                    }
                    className="bg-zinc-900"
                  >
                    {s}
                  </option>
                ))}
              </select>
            </Field>

            {isLocalImagegen ? (
              <Field label="质量">
                <select
                  value={quality}
                  onChange={(e) => setQuality(e.target.value as LocalImageQuality)}
                  disabled={busy}
                  className="select"
                  data-testid="quality-select"
                >
                  {LOCAL_IMAGEGEN_QUALITIES.map((item) => (
                    <option key={item} value={item} className="bg-zinc-900">
                      {item}
                    </option>
                  ))}
                </select>
              </Field>
            ) : isOfficial ? (
              <Field label="分辨率">
                <select
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value)}
                  disabled={busy}
                  className="select"
                  data-testid="resolution-select"
                >
                  <option value="" className="bg-zinc-900">
                    默认
                  </option>
                  {SUPPORTED_RESOLUTIONS.map((r) => (
                    <option
                      key={r}
                      value={r}
                      disabled={r === "4k" && !FOUR_K_SUPPORTED_SIZES.includes(size)}
                      className="bg-zinc-900"
                    >
                      {r}
                    </option>
                  ))}
                </select>
              </Field>
            ) : (
              <label className="flex cursor-pointer items-center gap-2 pb-1 text-sm text-white/70">
                <input
                  type="checkbox"
                  checked={officialFallback}
                  onChange={(e) => setOfficialFallback(e.target.checked)}
                  disabled={busy}
                  className="size-4 accent-indigo-500"
                />
                官方通道回退
              </label>
            )}

            <div className="ml-auto flex items-center gap-2">
              {busy ? (
                <button
                  type="button"
                  onClick={reset}
                  className="rounded-lg border border-white/15 px-4 py-2 text-sm text-white/70 hover:bg-white/5"
                >
                  取消
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void generate()}
                disabled={busy || prompt.trim().length === 0}
                className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white shadow transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
                data-testid="generate-button"
              >
                {busy ? "生成中…" : "生成"}
              </button>
            </div>
          </div>
          <p className="mt-2 text-xs text-white/30">
            提示：Ctrl / ⌘ + Enter 快速生成。
            {isLocalImagegen
              ? " 自定义 URL/Key 直接调用 OpenAI 兼容接口，比例会映射成固定尺寸，21:9 和 9:21 暂不可用。"
              : " 生成的图片会缓存到本地浏览器，链接过期也不丢。"}
          </p>
          {!providerConfigured ? (
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="mt-2 text-xs text-amber-300/90 hover:text-amber-200"
              data-testid="config-warning"
            >
              ⚠ 当前通道还没有配置 Key / URL，点击这里前往「设置」。
            </button>
          ) : null}
        </div>
      </div>

      {/* History */}
      <HistoryPanel
        history={history}
        onClear={handleClearHistory}
        onDelete={handleDeleteHistory}
        onSelect={(item) => {
          setImages(item.images);
          setPrompt(item.prompt);
          setProvider(item.provider);
          setSize(
            item.provider === LOCAL_IMAGEGEN_PROVIDER
              ? sanitizeLocalImagegenSize(item.size)
              : item.size ?? "",
          );
          if (item.provider === APIMART_PROVIDER) {
            if (item.model) setModel(item.model);
          } else if (item.quality) {
            setQuality(item.quality);
          }
          setPhase("done");
          setError("");
        }}
        onDownload={downloadStoredImage}
      />

      {/* Component-scoped utility classes */}
      <style>{`
        .select {
          box-sizing: border-box;
          height: 1.525rem;
          min-height: 2.25rem;
          border-radius: 0.5rem;
          border: 1px solid rgba(255,255,255,0.15);
          background: rgba(255,255,255,0.03);
          padding: 0 0.55rem;
          font-size: 0.875rem;
          line-height: 1rem;
          color: inherit;
          outline: none;
        }
        .field-input {
          width: 100%;
          box-sizing: border-box;
          border-radius: 0.5rem;
          border: 1px solid rgba(255,255,255,0.15);
          background: rgba(255,255,255,0.03);
          padding: 0.5rem 0.65rem;
          font-size: 0.875rem;
          color: inherit;
          outline: none;
        }
        .field-input:focus {
          border-color: rgba(99,102,241,0.7);
        }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-white/50">
      {label}
      {children}
    </label>
  );
}

function SettingsModal({
  config,
  onClose,
  onSave,
}: {
  config: AppConfig;
  onClose: () => void;
  onSave: (config: AppConfig) => void;
}) {
  const [draft, setDraft] = useState<AppConfig>(config);

  const set = (patch: Partial<AppConfig>) => setDraft((prev) => ({ ...prev, ...patch }));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/10 bg-zinc-950 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        data-testid="settings-modal"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">设置</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-white/50 hover:bg-white/5 hover:text-white/80"
            aria-label="关闭"
          >
            ×
          </button>
        </div>

        <p className="mb-4 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/50">
          所有 Key / URL 只保存在你当前浏览器的本地存储里，请求直接发往对应服务，不会经过任何后端。
        </p>

        <section className="mb-5">
          <h3 className="mb-2 text-sm font-medium text-white/80">APIMart</h3>
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-xs text-white/50">
              API Key
              <input
                type="password"
                value={draft.apimartApiKey}
                onChange={(e) => set({ apimartApiKey: e.target.value })}
                placeholder="sk-..."
                className="field-input"
                data-testid="apimart-key-input"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-white/50">
              Base URL
              <input
                type="text"
                value={draft.apimartBaseUrl}
                onChange={(e) => set({ apimartBaseUrl: e.target.value })}
                placeholder="https://api.apimart.ai/v1"
                className="field-input"
                data-testid="apimart-url-input"
              />
            </label>
          </div>
        </section>

        <section className="mb-5">
          <h3 className="mb-2 text-sm font-medium text-white/80">自定义 URL/Key（OpenAI 兼容）</h3>
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-xs text-white/50">
              Base URL
              <input
                type="text"
                value={draft.customBaseUrl}
                onChange={(e) => set({ customBaseUrl: e.target.value })}
                placeholder="https://your-endpoint.example.com/v1"
                className="field-input"
                data-testid="custom-url-input"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-white/50">
              API Key
              <input
                type="password"
                value={draft.customApiKey}
                onChange={(e) => set({ customApiKey: e.target.value })}
                placeholder="sk-..."
                className="field-input"
                data-testid="custom-key-input"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-white/50">
              模型名
              <input
                type="text"
                value={draft.customModel}
                onChange={(e) => set({ customModel: e.target.value })}
                placeholder="gpt-image-1"
                className="field-input"
                data-testid="custom-model-input"
              />
            </label>
          </div>
          <p className="mt-2 text-xs text-white/30">
            需要接口支持浏览器跨域 (CORS)。请求会发到 <code>{"{Base URL}"}/images/generations</code>（或图生图的 <code>/images/edits</code>）。
          </p>
        </section>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/15 px-4 py-2 text-sm text-white/70 hover:bg-white/5"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => onSave(draft)}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
            data-testid="save-settings"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

function ReferenceStrip({
  references,
  onRemove,
  onAdd,
  disabled,
}: {
  references: ReferenceImage[];
  onRemove: (id: string) => void;
  onAdd: (files: FileList | null) => void;
  disabled: boolean;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {references.map((ref) => (
        <div key={ref.id} className="group relative size-14 overflow-hidden rounded-lg border border-white/10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={ref.dataUrl} alt={ref.name} className="size-full object-cover" />
          <button
            type="button"
            onClick={() => onRemove(ref.id)}
            className="absolute right-0.5 top-0.5 hidden size-5 items-center justify-center rounded-full bg-black/70 text-xs text-white group-hover:flex"
            aria-label="移除参考图"
          >
            ×
          </button>
        </div>
      ))}
      <label className="flex size-14 cursor-pointer items-center justify-center rounded-lg border border-dashed border-white/20 text-2xl text-white/40 hover:border-white/40 hover:text-white/70">
        +
        <input
          type="file"
          accept="image/*"
          multiple
          hidden
          disabled={disabled}
          onChange={(e) => {
            onAdd(e.target.files);
            e.target.value = "";
          }}
        />
      </label>
      {references.length > 0 ? (
        <span className="text-xs text-white/40">参考图（图生图）{references.length}/{MAX_REFERENCE_IMAGES}</span>
      ) : (
        <span className="text-xs text-white/30">可选：上传参考图做图生图</span>
      )}
    </div>
  );
}

function StudioImage({
  image,
  alt,
  className,
}: {
  image: StoredImage;
  alt: string;
  className?: string;
}) {
  const src = useImageSrc(image);
  if (!src) {
    return <div className={className} />;
  }
  return (
    <a href={src} target="_blank" rel="noopener noreferrer" className="block h-full w-full">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} className={className} />
    </a>
  );
}

function ResultArea({
  phase,
  statusText,
  error,
  images,
}: {
  phase: Phase;
  statusText: string;
  error: string;
  images: StoredImage[];
}) {
  return (
    <div className="flex min-h-[430px] flex-1 flex-col rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      {phase === "error" ? (
        <div
          className="flex flex-1 items-center justify-center rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-center text-sm text-red-300"
          data-testid="error-box"
        >
          {error}
        </div>
      ) : phase === "submitting" || phase === "polling" ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-white/60" data-testid="loading-box">
          <div className="size-10 animate-spin rounded-full border-2 border-white/15 border-t-indigo-400" />
          <p className="text-sm">{statusText}</p>
        </div>
      ) : images.length > 0 ? (
        <div
          className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2"
          data-testid="result-grid"
        >
          {images.map((image, i) => (
            <div
              key={image.id ?? image.url ?? i}
              className="group relative overflow-hidden rounded-xl border border-white/10 bg-black/30"
            >
              <StudioImage
                image={image}
                alt={`生成结果 ${i + 1}`}
                className="h-full w-full object-contain transition group-hover:scale-[1.01]"
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-white/30">
          <div className="text-4xl">🎨</div>
          <p className="text-sm">输入提示词，点击「生成」开始创作</p>
        </div>
      )}
    </div>
  );
}

function HistoryThumb({ image, alt }: { image: StoredImage; alt: string }) {
  const src = useImageSrc(image);
  if (!src) {
    return <div className="mb-2 h-24 w-full rounded-lg bg-white/[0.03]" />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} className="mb-2 h-24 w-full rounded-lg object-cover" />
  );
}

function HistoryPanel({
  history,
  onClear,
  onDelete,
  onSelect,
  onDownload,
}: {
  history: HistoryItem[];
  onClear: () => void;
  onDelete: (item: HistoryItem) => void;
  onSelect: (item: HistoryItem) => void;
  onDownload: (image: StoredImage, filename: string) => void;
}) {
  const [confirmClear, setConfirmClear] = useState(false);
  return (
    <aside className="flex w-full flex-col rounded-2xl border border-white/10 bg-white/[0.02] p-4 lg:w-72 lg:self-start">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium text-white/70">历史记录</h2>
        {history.length > 0 ? (
          confirmClear ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-white/40">确认清空？</span>
              <button
                type="button"
                onClick={() => {
                  onClear();
                  setConfirmClear(false);
                }}
                className="text-xs text-rose-300 hover:text-rose-200"
              >
                确认
              </button>
              <button
                type="button"
                onClick={() => setConfirmClear(false)}
                className="text-xs text-white/40 hover:text-white/70"
              >
                取消
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmClear(true)}
              className="text-xs text-white/40 hover:text-white/70"
            >
              清空
            </button>
          )
        ) : null}
      </div>
      {history.length === 0 ? (
        <p className="text-xs text-white/30">这里会显示你生成过的图片。</p>
      ) : (
        <ul className="flex max-h-[calc(100dvh-12rem)] flex-col gap-3 overflow-y-auto pr-1">
          {history.map((item) => {
            const first = item.images[0];
            return (
              <li
                key={item.id}
                className="group relative rounded-xl border border-white/5 bg-white/[0.02] p-2"
              >
                <button
                  type="button"
                  onClick={() => onDelete(item)}
                  aria-label="删除这条记录"
                  title="删除"
                  className="absolute right-1 top-1 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-black/50 text-xs text-white/60 opacity-0 transition hover:bg-rose-500/80 hover:text-white group-hover:opacity-100"
                >
                  ✕
                </button>
                <button
                  type="button"
                  onClick={() => onSelect(item)}
                  className="block w-full text-left"
                >
                  {first ? <HistoryThumb image={first} alt={item.prompt} /> : null}
                  <p className="line-clamp-2 text-xs text-white/60">
                    {item.prompt}
                  </p>
                </button>
                <div className="mt-1 flex items-center justify-between">
                  <div className="flex flex-col">
                    <span className="text-[10px] text-white/40">
                      {PROVIDER_LABELS[item.provider]}
                      {item.modelLabel ? ` · ${item.modelLabel}` : ""}
                      {item.quality ? ` · ${item.quality}` : ""}
                    </span>
                    <span className="text-[10px] text-white/30">
                      {new Date(item.createdAt).toLocaleString()}
                    </span>
                  </div>
                  {first ? (
                    <button
                      type="button"
                      onClick={() =>
                        onDownload(first, `image-studio-${item.provider}-${item.id}.png`)
                      }
                      className="text-[10px] text-indigo-300 hover:text-indigo-200"
                    >
                      下载
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}

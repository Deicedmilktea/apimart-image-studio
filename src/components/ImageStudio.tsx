"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  FOUR_K_SUPPORTED_SIZES,
  MAX_REFERENCE_IMAGES,
  MODEL_LABELS,
  OFFICIAL_IMAGE_MODEL,
  STANDARD_IMAGE_MODEL,
  SUPPORTED_MODELS,
  SUPPORTED_RESOLUTIONS,
  SUPPORTED_SIZES,
  type ImageModel,
} from "@/lib/constants";
import type {
  GenerateResponse,
  HistoryItem,
  ReferenceImage,
  TaskResponse,
} from "@/lib/types";

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

async function downloadImage(url: string, filename: string) {
  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
  } catch {
    // Cross-origin download may be blocked; fall back to opening in a new tab.
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

export default function ImageStudio() {
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState<ImageModel>(STANDARD_IMAGE_MODEL);
  const [size, setSize] = useState<string>("");
  const [resolution, setResolution] = useState<string>("");
  const [officialFallback, setOfficialFallback] = useState(true);
  const [references, setReferences] = useState<ReferenceImage[]>([]);

  const [phase, setPhase] = useState<Phase>("idle");
  const [statusText, setStatusText] = useState<string>("");
  const [images, setImages] = useState<string[]>([]);
  const [error, setError] = useState<string>("");
  const [history, setHistory] = useState<HistoryItem[]>([]);

  const cancelRef = useRef(false);
  const busy = phase === "submitting" || phase === "polling";

  useEffect(() => {
    // Read persisted history after mount (avoids SSR/localStorage hydration
    // mismatch). Deferred to a microtask so it isn't a synchronous effect setState.
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      try {
        const raw = localStorage.getItem(HISTORY_KEY);
        if (raw) setHistory(JSON.parse(raw) as HistoryItem[]);
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
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

  const generate = useCallback(async () => {
    const trimmed = prompt.trim();
    if (!trimmed || busy) return;

    cancelRef.current = false;
    setError("");
    setImages([]);
    setPhase("submitting");
    setStatusText("正在提交任务…");

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: trimmed,
          model,
          size: size || undefined,
          resolution: isOfficial ? resolution || undefined : undefined,
          officialFallback: isOfficial ? undefined : officialFallback,
          imageUrls: references.map((r) => r.dataUrl),
        }),
      });
      const data = (await res.json()) as GenerateResponse;
      if (!res.ok || !data.taskId) {
        throw new Error(data.error || `提交失败 (HTTP ${res.status})`);
      }

      const taskId = data.taskId;
      setPhase("polling");
      setStatusText("已提交，正在生成图片…");

      const deadline = Date.now() + POLL_TIMEOUT_MS;
      while (Date.now() < deadline) {
        if (cancelRef.current) return;
        await sleep(POLL_INTERVAL_MS);
        if (cancelRef.current) return;

        const taskRes = await fetch(`/api/task/${encodeURIComponent(taskId)}`, {
          cache: "no-store",
        });
        const task = (await taskRes.json()) as TaskResponse;
        if (!taskRes.ok) throw new Error(task.error || `查询失败 (HTTP ${taskRes.status})`);

        const status = task.status ?? "";
        setStatusText(`生成中… (状态: ${status || "处理中"})`);

        if (status === "completed") {
          const urls = task.images ?? [];
          if (urls.length === 0) throw new Error("任务完成但没有返回图片 URL。");
          setImages(urls);
          setPhase("done");
          setStatusText("");
          persistHistory([
            {
              id: taskId,
              prompt: trimmed,
              model,
              size: size || undefined,
              images: urls,
              createdAt: Date.now(),
            },
            ...history.filter((h) => h.id !== taskId),
          ]);
          return;
        }
        if (status === "failed") {
          throw new Error(task.error || "任务失败。");
        }
      }
      throw new Error("生成超时，请稍后用任务记录重试。");
    } catch (err) {
      if (cancelRef.current) return;
      setPhase("error");
      setStatusText("");
      setError(err instanceof Error ? err.message : "未知错误");
    }
  }, [
    prompt,
    busy,
    model,
    size,
    resolution,
    isOfficial,
    officialFallback,
    references,
    history,
    persistHistory,
  ]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6 lg:flex-row">
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
                  <option key={s} value={s} className="bg-zinc-900">
                    {s}
                  </option>
                ))}
              </select>
            </Field>

            {isOfficial ? (
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
            提示：Ctrl / ⌘ + Enter 快速生成。图片链接 24 小时内有效，请及时下载。
          </p>
        </div>
      </div>

      {/* History */}
      <HistoryPanel
        history={history}
        onClear={() => persistHistory([])}
        onSelect={(item) => {
          setImages(item.images);
          setPrompt(item.prompt);
          setPhase("done");
          setError("");
        }}
        onDownload={downloadImage}
      />

      {/* Component-scoped utility classes */}
      <style>{`
        .select {
          border-radius: 0.5rem;
          border: 1px solid rgba(255,255,255,0.15);
          background: rgba(255,255,255,0.03);
          padding: 0.4rem 0.6rem;
          font-size: 0.875rem;
          color: inherit;
          outline: none;
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

function ResultArea({
  phase,
  statusText,
  error,
  images,
}: {
  phase: Phase;
  statusText: string;
  error: string;
  images: string[];
}) {
  return (
    <div className="flex min-h-[320px] flex-1 flex-col rounded-2xl border border-white/10 bg-white/[0.02] p-4">
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
          {images.map((url, i) => (
            <a
              key={`${url}-${i}`}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="group relative overflow-hidden rounded-xl border border-white/10 bg-black/30"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={`生成结果 ${i + 1}`}
                className="h-full w-full object-contain transition group-hover:scale-[1.01]"
              />
            </a>
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

function HistoryPanel({
  history,
  onClear,
  onSelect,
  onDownload,
}: {
  history: HistoryItem[];
  onClear: () => void;
  onSelect: (item: HistoryItem) => void;
  onDownload: (url: string, filename: string) => void;
}) {
  return (
    <aside className="flex w-full flex-col rounded-2xl border border-white/10 bg-white/[0.02] p-4 lg:w-72">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium text-white/70">历史记录</h2>
        {history.length > 0 ? (
          <button
            type="button"
            onClick={onClear}
            className="text-xs text-white/40 hover:text-white/70"
          >
            清空
          </button>
        ) : null}
      </div>
      {history.length === 0 ? (
        <p className="text-xs text-white/30">这里会显示你生成过的图片。</p>
      ) : (
        <ul className="flex flex-col gap-3 overflow-y-auto">
          {history.map((item) => (
            <li key={item.id} className="rounded-xl border border-white/5 bg-white/[0.02] p-2">
              <button
                type="button"
                onClick={() => onSelect(item)}
                className="block w-full text-left"
              >
                {item.images[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.images[0]}
                    alt={item.prompt}
                    className="mb-2 h-24 w-full rounded-lg object-cover"
                  />
                ) : null}
                <p className="line-clamp-2 text-xs text-white/60">{item.prompt}</p>
              </button>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-[10px] text-white/30">
                  {new Date(item.createdAt).toLocaleString()}
                </span>
                {item.images[0] ? (
                  <button
                    type="button"
                    onClick={() => onDownload(item.images[0], `apimart-${item.id}.png`)}
                    className="text-[10px] text-indigo-300 hover:text-indigo-200"
                  >
                    下载
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

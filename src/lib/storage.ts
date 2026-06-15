// Server-side persistence of generated images to local disk.
// Generated image links from APIMart expire (~24h), so we download and save a
// copy locally when a task completes.

import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SavedImageInfo } from "@/lib/types";

export type { SavedImageInfo };

// Output directory for saved images. Configurable via IMAGE_STUDIO_OUTPUT_DIR;
// relative paths resolve against the project root (process.cwd()).
export function getOutputDir(): string {
  const configured =
    process.env.IMAGE_STUDIO_OUTPUT_DIR?.trim() ||
    process.env.APIMART_OUTPUT_DIR?.trim() ||
    "generated";
  return path.isAbsolute(configured)
    ? configured
    : path.join(/* turbopackIgnore: true */ process.cwd(), configured);
}

export async function ensureOutputDir(): Promise<string> {
  const dir = getOutputDir();
  await mkdir(dir, { recursive: true });
  return dir;
}

export function buildLocalImageUrl(filename: string): string {
  return `/api/image/${encodeURIComponent(filename)}`;
}

function extFromUrl(url: string): string {
  const clean = url.split("?")[0].split("#")[0];
  const match = clean.match(/\.(png|jpe?g|webp|gif)$/i);
  if (!match) return "png";
  return match[1].toLowerCase() === "jpeg" ? "jpg" : match[1].toLowerCase();
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

// Downloads each image URL and writes it under getOutputDir(). Idempotent:
// filenames are deterministic (`{taskId}-{n}.{ext}`) and existing files are
// not re-downloaded, so repeated polls don't duplicate work. Individual
// failures are skipped so one bad URL doesn't block the rest.
export async function saveImages(
  taskId: string,
  urls: string[],
): Promise<SavedImageInfo[]> {
  const dir = await ensureOutputDir();

  const saved: SavedImageInfo[] = [];
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const filename = `${taskId}-${i + 1}.${extFromUrl(url)}`;
    const filePath = path.join(dir, filename);
    try {
      if (!(await fileExists(filePath))) {
        const res = await fetch(url);
        if (!res.ok) continue;
        const buffer = Buffer.from(await res.arrayBuffer());
        await writeFile(filePath, buffer);
      }
      saved.push({ filename, path: filePath, url });
    } catch {
      // Skip this image; keep trying the others.
    }
  }
  return saved;
}

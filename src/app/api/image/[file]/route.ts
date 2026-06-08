import { NextRequest } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getOutputDir } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

// Serves images previously auto-saved under getOutputDir() so previews keep
// working after the original APIMart links expire.
export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ file: string }> },
) {
  const { file } = await ctx.params;
  // Only allow plain filenames; reject anything that could traverse paths.
  if (!file || file.includes("..") || !/^[A-Za-z0-9._-]+$/.test(file)) {
    return Response.json({ error: "非法文件名。" }, { status: 400 });
  }

  const filePath = path.join(getOutputDir(), file);
  try {
    const data = await readFile(filePath);
    const ext = file.split(".").pop()?.toLowerCase() ?? "";
    const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return Response.json({ error: "文件不存在。" }, { status: 404 });
  }
}

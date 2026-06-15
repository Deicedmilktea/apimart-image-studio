import { NextRequest } from "next/server";
import { ApimartError, getTaskStatus } from "@/lib/apimart";
import { APIMART_PROVIDER } from "@/lib/constants";
import { getOutputDir, saveImages, type SavedImageInfo } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!id) {
    return Response.json({ error: "缺少 task id。" }, { status: 400 });
  }

  try {
    const result = await getTaskStatus(id);

    let saved: SavedImageInfo[] | undefined;
    let savedDir: string | undefined;
    if (result.status === "completed" && result.images.length > 0) {
      saved = await saveImages(id, result.images);
      savedDir = getOutputDir();
    }

    return Response.json({
      taskId: result.taskId,
      status: result.status,
      images: result.images,
      error: result.error,
      saved,
      savedDir,
      provider: APIMART_PROVIDER,
    });
  } catch (err) {
    if (err instanceof ApimartError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    return Response.json(
      { error: err instanceof Error ? err.message : "未知错误" },
      { status: 500 },
    );
  }
}

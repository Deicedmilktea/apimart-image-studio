import { NextRequest } from "next/server";
import { ApimartError, getTaskStatus } from "@/lib/apimart";

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
    return Response.json({
      taskId: result.taskId,
      status: result.status,
      images: result.images,
      error: result.error,
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

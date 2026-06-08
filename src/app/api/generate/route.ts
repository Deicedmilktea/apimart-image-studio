import { NextRequest } from "next/server";
import {
  ApimartError,
  buildGenerationPayload,
  submitGeneration,
  type GenerateRequest,
} from "@/lib/apimart";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let body: GenerateRequest;
  try {
    body = (await request.json()) as GenerateRequest;
  } catch {
    return Response.json({ error: "请求体不是合法的 JSON。" }, { status: 400 });
  }

  try {
    const payload = buildGenerationPayload(body);
    const { taskId, status } = await submitGeneration(payload);
    return Response.json({ taskId, status });
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

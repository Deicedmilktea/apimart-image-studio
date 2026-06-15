import { NextRequest } from "next/server";
import {
  ApimartError,
  buildGenerationPayload,
  submitGeneration,
} from "@/lib/apimart";
import { APIMART_PROVIDER, LOCAL_IMAGEGEN_PROVIDER } from "@/lib/constants";
import { LocalImagegenError, generateWithLocalImagegen } from "@/lib/localImagegen";
import type { GenerateRequest } from "@/lib/types";

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
    const provider = body.provider ?? APIMART_PROVIDER;
    if (provider === LOCAL_IMAGEGEN_PROVIDER) {
      const result = await generateWithLocalImagegen(body);
      return Response.json(result);
    }
    if (provider !== APIMART_PROVIDER) {
      return Response.json({ error: `不支持的 provider：${provider}` }, { status: 400 });
    }

    const payload = buildGenerationPayload(body);
    const { taskId, status } = await submitGeneration(payload);
    return Response.json({ taskId, status, provider });
  } catch (err) {
    if (err instanceof ApimartError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof LocalImagegenError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    return Response.json(
      { error: err instanceof Error ? err.message : "未知错误" },
      { status: 500 },
    );
  }
}

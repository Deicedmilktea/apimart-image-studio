// Thin, stateless pass-through for the "自定义 URL/Key" channel. Some
// OpenAI-compatible endpoints (e.g. beeapi.ai) reject browser CORS preflights,
// so the browser cannot call them directly. This route forwards the request
// from same-origin to the user-supplied endpoint. It stores nothing: the target
// URL and the user's API key are passed per-request from the browser and only
// relayed upstream.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TARGET_HEADER = "x-target-url";

// Block obvious internal / metadata targets to limit SSRF abuse of the proxy.
function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "0.0.0.0" || host === "::1" || host === "[::1]") return true;
  if (host === "169.254.169.254") return true; // cloud metadata
  if (host === "127.0.0.1" || host.startsWith("127.")) return true;
  if (host.startsWith("10.")) return true;
  if (host.startsWith("192.168.")) return true;
  const m = host.match(/^172\.(\d+)\./);
  if (m) {
    const second = Number(m[1]);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

function validateTarget(raw: string | null): URL {
  if (!raw) {
    throw new Response(JSON.stringify({ error: "缺少 x-target-url。" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Response(JSON.stringify({ error: `非法的目标 URL：${raw}` }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (url.protocol !== "https:") {
    throw new Response(JSON.stringify({ error: "目标 URL 必须是 https。" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (isBlockedHost(url.hostname)) {
    throw new Response(JSON.stringify({ error: "目标主机不被允许。" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  return url;
}

export async function POST(request: Request) {
  let target: URL;
  try {
    target = validateTarget(request.headers.get(TARGET_HEADER));
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }

  const headers = new Headers();
  const auth = request.headers.get("authorization");
  if (auth) headers.set("Authorization", auth);
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("Content-Type", contentType);
  headers.set("Accept", "application/json");

  const body = await request.arrayBuffer();

  let upstream: Response;
  try {
    upstream = await fetch(target.toString(), {
      method: "POST",
      headers,
      body,
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: `无法连接目标接口：${err instanceof Error ? err.message : String(err)}`,
      }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }

  const respBody = await upstream.arrayBuffer();
  return new Response(respBody, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "application/json",
    },
  });
}

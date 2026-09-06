import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const VERSION = "6.0.0";
const DIRECT_COLLECTOR = "coletor-olx-direto-v1";
const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") ?? "").trim().replace(/\/+$/, "");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function forwardHeaders(req: Request): Record<string, string> {
  const out: Record<string, string> = { "Content-Type": "application/json" };
  const apiKey = req.headers.get("apikey");
  const authorization = req.headers.get("authorization");
  if (apiKey) out.apikey = apiKey;
  if (authorization) out.Authorization = authorization;
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  if (body.action !== "collect") {
    return json({
      ok: true,
      function: "coletor-lj-v2",
      version: VERSION,
      strategy: "direct_source_router",
      collection_route: DIRECT_COLLECTOR,
      external_search_engine: false,
      quality_mode: "direct_source_only",
    });
  }

  if (!SUPABASE_URL) return json({ ok: false, error: "supabase_url_missing" }, 500);

  const payload = {
    ...body,
    action: "collect",
    max_pages: Math.max(1, Math.min(5, Number(body.max_pages ?? 2))),
  };

  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/${DIRECT_COLLECTOR}`, {
      method: "POST",
      headers: forwardHeaders(req),
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({})) as Record<string, unknown>;
    return json({
      ...data,
      function: "coletor-lj-v2",
      version: VERSION,
      routed_to: DIRECT_COLLECTOR,
      external_search_engine: false,
    }, response.status);
  } catch (error) {
    return json({
      ok: false,
      function: "coletor-lj-v2",
      version: VERSION,
      routed_to: DIRECT_COLLECTOR,
      error: error instanceof Error ? error.message : String(error),
    }, 502);
  }
});

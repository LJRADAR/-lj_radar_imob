import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const VERSION = "3.0.0";
const FUNCTION_NAME = "enriquecedor-intencao-lj-v1";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization,x-lji-cron-key,content-type,apikey,x-client-info",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  const body = await req.json().catch(() => ({}));
  if (body?.action === "health") {
    return json({
      ok: true,
      function: FUNCTION_NAME,
      version: VERSION,
      status: "paused_pending_safe_replacement",
      external_fetch_enabled: false,
      external_search_engine: false,
      replacement_strategy: "threads_official_and_apify_source_router",
    });
  }
  return json({
    ok: false,
    function: FUNCTION_NAME,
    version: VERSION,
    status: "paused",
    collection_performed: false,
    error: "legacy_intent_enricher_disabled_pending_safe_replacement",
  }, 503);
});

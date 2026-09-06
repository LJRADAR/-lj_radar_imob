import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const VERSION = "1.1.0";
const FUNCTION_NAME = "coletor-olx-direto-v1";
const URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const INTERNAL_SECRET_NAME = "radar_lj_v2_collector";

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

function internalSecret(): string {
  try {
    const secrets = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}") as Record<string, unknown>;
    return typeof secrets[INTERNAL_SECRET_NAME] === "string" ? String(secrets[INTERNAL_SECRET_NAME]).trim() : "";
  } catch {
    return "";
  }
}

async function authorized(req: Request): Promise<boolean> {
  const apiKey = (req.headers.get("apikey") ?? "").trim();
  const secret = internalSecret();
  if (secret && apiKey === secret) return true;

  const authorization = req.headers.get("Authorization") ?? "";
  if (!authorization || !ANON || !URL) return false;
  const client = createClient(URL, ANON, { global: { headers: { Authorization: authorization } } });
  const { data: { user } } = await client.auth.getUser();
  if (!user) return false;
  const { data: allowed } = await client.rpc("lj_v2_has_permission", { p_permission_key: "run_manual_collector" });
  return allowed === true;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  if (body.action !== "collect") {
    return json({
      ok: true,
      function: FUNCTION_NAME,
      version: VERSION,
      strategy: "direct_source_runtime_pending",
      external_search_engine: false,
      collection_enabled: false,
      reason: "Direct OLX requests from the current Supabase execution origin receive HTTP 403. Collection must run through the approved Render/Cloudflare runtime before reactivation.",
    });
  }

  if (!(await authorized(req))) return json({ ok: false, error: "collect_authentication_failed" }, 401);

  return json({
    ok: false,
    function: FUNCTION_NAME,
    version: VERSION,
    status: "paused",
    external_search_engine: false,
    collection_performed: false,
    error: "direct_source_runtime_required",
    next_runtime: "Render/Cloudflare",
  }, 503);
});

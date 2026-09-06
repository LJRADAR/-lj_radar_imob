import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@^2";

const VERSION = "6.0.0";
const URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization,x-client-info,apikey,content-type,x-lji-cron-key",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};
const REGIONS = [
  "Santo André",
  "São Bernardo do Campo",
  "São Caetano do Sul",
  "Diadema",
  "São Paulo — Centro",
  "São Paulo — Zona Sul",
  "São Paulo — Zona Leste",
  "São Paulo — Zona Oeste",
  "São Paulo — Zona Norte",
];

const clean = (v: unknown) => typeof v === "string" ? v.trim() : "";
const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { ...CORS, "Content-Type": "application/json" },
});

async function authorize(req: Request, sb: any, body: Record<string, unknown>) {
  const cron = clean(req.headers.get("x-lji-cron-key"));
  if (cron) {
    const { data } = await sb.from("lji_internal_secrets").select("secret").eq("key", "intent_cron").maybeSingle();
    if (data?.secret === cron) return { workspace: clean(body.workspace_id), mode: "cron" };
  }

  const bearer = req.headers.get("Authorization") ?? "";
  if (!bearer || !ANON) return null;
  const userClient = createClient(URL, ANON, { global: { headers: { Authorization: bearer } } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return null;
  const { data: member } = await sb.from("lji_workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  return member ? { workspace: member.workspace_id, mode: "user" } : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    if (!URL || !SERVICE) return json({ ok: false, error: "supabase_env_missing" }, 500);
    const sb = createClient(URL, SERVICE);
    const auth = await authorize(req, sb, body);
    if (!auth?.workspace) return json({ ok: false, error: "unauthorized" }, 401);

    const region = clean(body.region);
    if (region && !REGIONS.includes(region)) {
      return json({ ok: false, error: "invalid_region", regions: REGIONS }, 400);
    }

    return json({
      ok: true,
      version: VERSION,
      status: "paused_until_direct_source",
      provider: "none",
      external_search_engine: false,
      collection_performed: false,
      region: region || null,
      regions: REGIONS,
      report: [{
        region: region || null,
        found: 0,
        qualified: 0,
        saved: 0,
        owner_leads_synced: 0,
        search_errors: 0,
        status: "awaiting_direct_source_collector",
      }],
    });
  } catch (error) {
    return json({ ok: false, version: VERSION, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

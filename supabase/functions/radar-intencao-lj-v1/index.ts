import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@^2";

const VERSION = "6.2.0";
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
const COLLECTOR_CITY: Record<string, string> = {
  "Santo André": "Santo André",
  "São Bernardo do Campo": "São Bernardo do Campo",
  "São Caetano do Sul": "São Caetano do Sul",
  "Diadema": "Diadema",
  "São Paulo — Centro": "São Paulo Centro Expandido",
  "São Paulo — Zona Sul": "São Paulo Zona Sul",
  "São Paulo — Zona Leste": "São Paulo Zona Leste",
  "São Paulo — Zona Oeste": "São Paulo Zona Oeste",
  "São Paulo — Zona Norte": "São Paulo Zona Norte",
};

const clean = (v: unknown) => typeof v === "string" ? v.trim() : "";
const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
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

async function runOlxCollector(req: Request, auth: any, body: Record<string, unknown>, region: string) {
  if (auth.mode !== "user") return null;
  const city = COLLECTOR_CITY[region];
  const transactionType = clean(body.transaction_type);
  if (!city || !["sale", "rent"].includes(transactionType)) return null;

  const response = await fetch(`${URL}/functions/v1/coletor-lj-v2`, {
    method: "POST",
    headers: {
      apikey: ANON,
      Authorization: req.headers.get("Authorization") ?? "",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "collect",
      workspace_id: auth.workspace,
      state_code: "SP",
      city,
      transaction_type: transactionType,
      property_type_code: clean(body.property_type) || null,
      source: "olx",
      results_per_query: 10,
      query_limit: 1,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
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

    if (auth.mode === "user" && region) {
      const collector = await runOlxCollector(req, auth, body, region);
      if (collector) {
        const c = collector.payload?.counters ?? {};
        const sourceReport = Array.isArray(collector.payload?.source_report) ? collector.payload.source_report : [];
        if (!collector.response.ok || collector.payload?.ok !== true) {
          return json({
            ok: true,
            version: VERSION,
            status: "collector_failed",
            provider: "source_router",
            external_search_engine: false,
            collection_performed: false,
            error_code: collector.payload?.error ?? `collector_http_${collector.response.status}`,
            region,
            regions: REGIONS,
            collector: collector.payload,
            report: [{
              region,
              queries: Math.max(1, sourceReport.length),
              found: 0,
              qualified: 0,
              saved: 0,
              owner_leads_synced: 0,
              search_errors: Math.max(1, sourceReport.length),
              status: collector.payload?.error ?? "collector_failed",
            }],
          });
        }

        return json({
          ok: true,
          version: VERSION,
          status: collector.payload?.status ?? "completed",
          provider: "source_router",
          external_search_engine: false,
          collection_performed: true,
          region,
          regions: REGIONS,
          collector: {
            function: collector.payload?.function,
            version: collector.payload?.version,
            run_id: collector.payload?.run_id,
            source: collector.payload?.source,
            counters: c,
          },
          report: [{
            region,
            queries: Math.max(1, sourceReport.length),
            found: Number(c.raw_results || 0),
            qualified: Number(c.qualified_results || 0),
            saved: Number(c.new_results || 0),
            owner_leads_synced: 0,
            search_errors: Number(c.errors || 0),
            status: collector.payload?.status ?? "completed",
          }],
        });
      }
    }

    return json({
      ok: true,
      version: VERSION,
      status: "paused_until_source_credentials",
      provider: "source_router",
      external_search_engine: false,
      collection_performed: false,
      error_code: "source_credentials_missing",
      region: region || null,
      regions: REGIONS,
      report: [{
        region: region || null,
        queries: 1,
        found: 0,
        qualified: 0,
        saved: 0,
        owner_leads_synced: 0,
        search_errors: 1,
        status: "awaiting_threads_or_apify_credentials",
      }],
    });
  } catch (error) {
    return json({ ok: false, version: VERSION, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

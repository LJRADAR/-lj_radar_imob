import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const FUNCTION_NAME = "radar-lj-v2";
const VERSION = "2.0.0";
const COLLECTOR_FUNCTION = "coletor-lj-v2";
const NAMED_SECRET_KEY = "radar_lj_v2_collector";

type Json = Record<string, unknown>;
type RadarRequest = {
  action?: "health" | "run";
  wait?: boolean;
  workspace_id?: string;
  state_code?: string;
  state?: string;
  uf?: string;
  city?: string;
  cidade?: string;
  transaction_type?: "sale" | "rent";
  transaction?: "sale" | "rent";
  property_type_code?: string | null;
  property_type?: string | null;
  type?: string | null;
  source?: string;
  query_limit?: number;
  results_per_query?: number;
  refresh_opportunities?: boolean;
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function text(value: unknown): string | null {
  const v = String(value ?? "").trim();
  return v || null;
}

function namedSecret(): string {
  try {
    const parsed = JSON.parse(String(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}")) as Json;
    const value = parsed[NAMED_SECRET_KEY];
    return typeof value === "string" ? value.trim() : "";
  } catch {
    return "";
  }
}

function runtime() {
  return {
    url: String(Deno.env.get("SUPABASE_URL") ?? "").trim().replace(/\/+$/, ""),
    service: String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim(),
    internal: namedSecret(),
  };
}

function requestCredential(req: Request): string {
  const apiKey = String(req.headers.get("apikey") ?? "").trim();
  if (apiKey) return apiKey;
  const auth = String(req.headers.get("authorization") ?? "").trim();
  return auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
}

function authorized(req: Request, rt: ReturnType<typeof runtime>): boolean {
  const c = requestCredential(req);
  return Boolean(c && ((rt.internal && c === rt.internal) || (rt.service && c === rt.service)));
}

async function callCollector(rt: ReturnType<typeof runtime>, body: Json): Promise<{ status: number; data: Json }> {
  const r = await fetch(`${rt.url}/functions/v1/${COLLECTOR_FUNCTION}`, {
    method: "POST",
    headers: {
      apikey: rt.internal,
      Authorization: `Bearer ${rt.internal}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({})) as Json;
  return { status: r.status, data };
}

async function rpc(rt: ReturnType<typeof runtime>, name: string, body: Json = {}): Promise<unknown> {
  const r = await fetch(`${rt.url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: rt.service,
      Authorization: `Bearer ${rt.service}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${name}_http_${r.status}`);
  return data;
}

function normalizeRequest(body: RadarRequest) {
  const stateCode = String(body.state_code ?? body.state ?? body.uf ?? "").trim().toUpperCase();
  const city = text(body.city ?? body.cidade);
  const transaction = body.transaction_type ?? body.transaction;
  const propertyType = text(body.property_type_code ?? body.property_type ?? body.type);
  const source = text(body.source)?.toLowerCase() ?? "all";
  const queryLimit = Math.min(20, Math.max(1, Number(body.query_limit || 4)));
  const resultsPerQuery = Math.min(10, Math.max(1, Number(body.results_per_query || 10)));
  return { stateCode, city, transaction, propertyType, source, queryLimit, resultsPerQuery };
}

async function health(rt: ReturnType<typeof runtime>) {
  let collectorHealth: Json | null = null;
  if (rt.url && rt.internal) {
    try {
      const result = await callCollector(rt, { action: "health" });
      if (result.status === 200) collectorHealth = result.data;
    } catch {
      collectorHealth = null;
    }
  }

  return {
    ok: true,
    function: FUNCTION_NAME,
    version: VERSION,
    architecture: "structured_source_router_payload",
    automatic_html_enricher: false,
    external_search_engine: false,
    collector: COLLECTOR_FUNCTION,
    collector_version: collectorHealth?.version ?? null,
    collection_enabled: collectorHealth?.collection_enabled === true,
    ready_sources: Array.isArray(collectorHealth?.ready_sources) ? collectorHealth?.ready_sources : [],
    source_readiness: collectorHealth?.source_readiness ?? {},
    pipeline: [
      "coletor-lj-v2",
      "lji_auto_process_source_router_payload",
      "lji_process_source_router_discoveries",
      "lji_sync_promoted_opportunities",
      "lji_opportunity_index:review",
      "lji_auto_promote_opportunities:quality_gate",
    ],
    quinto_verification: "separate_positive_only_pipeline",
    legacy_opportunities_write: false,
  };
}

async function run(body: RadarRequest, rt: ReturnType<typeof runtime>): Promise<{ status: number; payload: Json }> {
  const n = normalizeRequest(body);
  if (n.stateCode !== "SP" || !n.city || (n.transaction !== "sale" && n.transaction !== "rent")) {
    return {
      status: 400,
      payload: { ok: false, function: FUNCTION_NAME, version: VERSION, error: "invalid_request", required: ["state_code=SP", "city", "transaction_type"] },
    };
  }

  const collector = await callCollector(rt, {
    action: "collect",
    workspace_id: text(body.workspace_id),
    state_code: n.stateCode,
    city: n.city,
    transaction_type: n.transaction,
    property_type_code: n.propertyType,
    source: n.source,
    query_limit: n.queryLimit,
    results_per_query: n.resultsPerQuery,
  });

  if (collector.status !== 200 || collector.data.ok !== true) {
    const paused = collector.status === 503 || collector.data.status === "paused";
    return {
      status: paused ? 503 : collector.status >= 400 ? collector.status : 502,
      payload: {
        ok: false,
        function: FUNCTION_NAME,
        version: VERSION,
        status: paused ? "paused" : "failed",
        collection_performed: false,
        collector: collector.data,
      },
    };
  }

  let synced = 0;
  let syncError: string | null = null;
  try {
    const result = await rpc(rt, "lji_sync_promoted_opportunities", {});
    synced = Number(result ?? 0) || 0;
  } catch (error) {
    syncError = error instanceof Error ? error.message : String(error);
  }

  const runId = text(collector.data.run_id);
  const collectorCounters = (collector.data.counters && typeof collector.data.counters === "object")
    ? collector.data.counters as Json
    : {};

  return {
    status: syncError ? 207 : 200,
    payload: {
      ok: !syncError,
      function: FUNCTION_NAME,
      version: VERSION,
      status: syncError ? "partial" : "completed",
      run_id: runId,
      collection_performed: true,
      target: { state_code: n.stateCode, city: n.city, transaction_type: n.transaction, property_type_code: n.propertyType },
      source: n.source,
      collector: {
        function: COLLECTOR_FUNCTION,
        version: collector.data.version ?? null,
        status: collector.data.status ?? null,
        counters: collectorCounters,
        source_report: collector.data.source_report ?? [],
      },
      processing: {
        structured_payload_trigger: true,
        external_fetch: false,
        legacy_html_enricher_called: false,
        opportunities_synced_to_review_index: synced,
        sync_error: syncError,
      },
      approval: {
        automatic_direct_approval: false,
        destination: "lji_opportunity_index",
        initial_status: "review",
        quality_gate: "lji_auto_promote_opportunities",
        requires_real_published_at: true,
        max_age_days: 365,
      },
      quinto: {
        inline_verification: false,
        mode: "separate_positive_only",
        absence_means: "inconclusive",
      },
    },
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const body = await req.json().catch(() => ({})) as RadarRequest;
  const rt = runtime();
  if (!rt.url || !rt.internal || !rt.service) {
    return json({ ok: false, function: FUNCTION_NAME, version: VERSION, error: "runtime_not_configured" }, 500);
  }

  if (body.action === "health") return json(await health(rt));
  if (!authorized(req, rt)) return json({ ok: false, function: FUNCTION_NAME, version: VERSION, error: "orchestrator_authentication_failed" }, 401);

  const requestId = crypto.randomUUID();
  if (body.wait === false) {
    EdgeRuntime.waitUntil(run(body, rt).catch((error) => {
      console.error(`[${FUNCTION_NAME}] ${requestId} failed`, error);
    }));
    return json({ ok: true, function: FUNCTION_NAME, version: VERSION, mode: "background", status: "started", request_id: requestId }, 202);
  }

  try {
    const result = await run(body, rt);
    return json({ ...result.payload, request_id: requestId }, result.status);
  } catch (error) {
    return json({
      ok: false,
      function: FUNCTION_NAME,
      version: VERSION,
      status: "failed",
      collection_performed: false,
      request_id: requestId,
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});

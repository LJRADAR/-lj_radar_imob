import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const VERSION = "6.6.0";
const FUNCTION_NAME = "coletor-lj-v2";
const NAMED_SECRET_KEY = "radar_lj_v2_collector";
const URL = String(Deno.env.get("SUPABASE_URL") ?? "").trim().replace(/\/+$/, "");
const SERVICE = String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
const ANON = String(Deno.env.get("SUPABASE_ANON_KEY") ?? "").trim();
const SUPPORTED_SOURCES = ["all", "threads", "olx", "instagram", "facebook", "telegram"];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function text(value) {
  const v = String(value ?? "").trim();
  return v || null;
}

function namedSecrets() {
  try {
    return JSON.parse(String(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"));
  } catch {
    return {};
  }
}

function signingSecret() {
  const value = namedSecrets()[NAMED_SECRET_KEY];
  return typeof value === "string" ? value.trim() : "";
}

function bearer(req) {
  const auth = String(req.headers.get("authorization") ?? "").trim();
  return auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
}

function adminHeaders(extra = {}) {
  return {
    apikey: SERVICE,
    Authorization: `Bearer ${SERVICE}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function adminGet(path) {
  const r = await fetch(`${URL}/rest/v1/${path}`, { headers: adminHeaders() });
  const data = await r.json().catch(() => []);
  if (!r.ok) throw new Error(`admin_get_${r.status}:${JSON.stringify(data)}`);
  return data;
}

async function adminPost(path, body, extraHeaders = {}) {
  const r = await fetch(`${URL}/rest/v1/${path}`, {
    method: "POST",
    headers: adminHeaders(extraHeaders),
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`admin_post_${r.status}:${JSON.stringify(data)}`);
  return data;
}

async function adminPatch(path, body) {
  const r = await fetch(`${URL}/rest/v1/${path}`, {
    method: "PATCH",
    headers: adminHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => []);
  if (!r.ok) throw new Error(`admin_patch_${r.status}:${JSON.stringify(data)}`);
  return data;
}

async function rpc(name, body = {}) {
  return adminPost(`rpc/${name}`, body);
}

async function authorize(req) {
  const incomingApiKey = String(req.headers.get("apikey") ?? "").trim();
  const incomingBearer = bearer(req);
  const named = signingSecret();

  if ((named && (incomingApiKey === named || incomingBearer === named)) || (SERVICE && incomingBearer === SERVICE)) {
    return { ok: true, mode: "secret", userId: null };
  }

  if (!ANON || !incomingBearer) return { ok: false, mode: "none", userId: null };

  const userResponse = await fetch(`${URL}/auth/v1/user`, {
    headers: { apikey: ANON, Authorization: `Bearer ${incomingBearer}` },
  });
  const user = await userResponse.json().catch(() => ({}));
  if (!userResponse.ok || !user?.id) return { ok: false, mode: "user", userId: null };

  const permissionResponse = await fetch(`${URL}/rest/v1/rpc/lj_v2_has_permission`, {
    method: "POST",
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${incomingBearer}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_permission_key: "run_manual_collector" }),
  });
  const allowed = await permissionResponse.json().catch(() => false);
  return { ok: permissionResponse.ok && allowed === true, mode: "user", userId: user.id };
}

async function internalConfig() {
  let routerUrl = text(Deno.env.get("LJI_SOURCE_ROUTER_URL"));
  if (!routerUrl && URL && SERVICE) {
    const rows = await adminGet("lji_internal_secrets?select=key,secret&key=eq.source_router_url&limit=1");
    if (Array.isArray(rows) && rows[0]?.secret) routerUrl = text(rows[0].secret);
  }
  if (routerUrl) routerUrl = routerUrl.replace(/\/+$/, "");
  return { routerUrl };
}

async function resolveWorkspace(auth, body) {
  const explicit = text(body?.workspace_id);

  if (auth.mode === "user" && auth.userId) {
    const rows = await adminGet(
      `lji_workspace_members?select=workspace_id&user_id=eq.${encodeURIComponent(auth.userId)}&is_active=eq.true`,
    );
    const memberships = Array.isArray(rows)
      ? [...new Set(rows.map((row) => text(row?.workspace_id)).filter(Boolean))]
      : [];
    if (explicit) {
      if (!memberships.includes(explicit)) throw new Error("workspace_forbidden");
      return explicit;
    }
    if (memberships.length === 1) return memberships[0];
    if (memberships.length > 1) throw new Error("workspace_id_required_for_multi_workspace_user");
    throw new Error("workspace_forbidden");
  }

  if (explicit) return explicit;
  const workspaces = await adminGet("lji_workspaces?select=id&order=created_at.asc&limit=2");
  if (Array.isArray(workspaces) && workspaces.length === 1) return text(workspaces[0].id);
  throw new Error("workspace_id_required");
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function base64(bytes) {
  let binary = "";
  for (const b of new Uint8Array(bytes)) binary += String.fromCharCode(b);
  return btoa(binary);
}

async function hmacSignature(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return base64(signature);
}

async function createRun({ workspaceId, auth, stateCode, city, transactionType, propertyType, source }) {
  const rows = await adminPost("lj_v2_collector_runs", [{
    workspace_id: workspaceId,
    run_mode: auth.mode === "user" ? "manual" : "scheduled",
    status: "running",
    requested_by: auth.userId,
    state_code: stateCode,
    city,
    transaction_type: transactionType,
    property_type_code: propertyType,
    started_at: new Date().toISOString(),
    system_snapshot: {
      collector_version: VERSION,
      strategy: "source_router_multi_provider_db_ingest",
      source,
      external_search_engine: false,
      providers: ["threads_api", "apify"],
      router_auth: "hmac-sha256-v1",
      persistence: "lji_ingest_source_router_discovery",
    },
    metadata: { source_router: true, requested_source: source },
  }], { Prefer: "return=representation" });

  const run = Array.isArray(rows) ? rows[0] : null;
  if (!run?.id) throw new Error("collector_run_create_failed");
  return run.id;
}

async function updateRun(runId, patch) {
  await adminPatch(`lj_v2_collector_runs?id=eq.${encodeURIComponent(runId)}`, {
    ...patch,
    updated_at: new Date().toISOString(),
  });
}

async function routerHealth(routerUrl) {
  if (!routerUrl) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`${routerUrl}/health`, { signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    return response.ok ? data : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function callRouter(routerUrl, secret, body) {
  const rawBody = JSON.stringify(body);
  const bodySha256 = await sha256(rawBody);
  const timestamp = String(Date.now());
  const nonce = crypto.randomUUID();
  const message = `POST\n/collect\n${timestamp}\n${nonce}\n${bodySha256}`;
  const signature = await hmacSignature(secret, message);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch(`${routerUrl}/collect`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-lji-auth-version": "hmac-sha256-v1",
        "x-lji-timestamp": timestamp,
        "x-lji-nonce": nonce,
        "x-lji-signature": signature,
      },
      body: rawBody,
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok !== true) {
      throw new Error(`source_router_${response.status}:${text(data?.error) ?? "collection_failed"}`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function persistViaDb(runId, item, position) {
  const result = await rpc("lji_ingest_source_router_discovery", {
    p_run_id: runId,
    p_item: item,
    p_position: position,
  });
  if (!result || result.saved !== true || !result.discovery_id) {
    throw new Error(`db_ingest_failed:${JSON.stringify(result)}`);
  }
  return result;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const body = await req.json().catch(() => ({}));
  const action = body?.action === "collect" ? "collect" : "health";

  if (!URL || !SERVICE) return json({ ok: false, error: "supabase_runtime_missing" }, 500);

  const cfg = await internalConfig();
  const secret = signingSecret();

  if (action === "health") {
    const remote = await routerHealth(cfg.routerUrl);
    return json({
      ok: true,
      function: FUNCTION_NAME,
      version: VERSION,
      strategy: "source_router_multi_provider_db_ingest",
      persistence: "lji_ingest_source_router_discovery",
      external_search_engine: false,
      auth_scheme: "hmac-sha256-v1",
      source_router_url_configured: Boolean(cfg.routerUrl),
      router_auth_signing_configured: Boolean(secret),
      router_reachable: Boolean(remote),
      router_version: text(remote?.version),
      supported_sources: SUPPORTED_SOURCES.filter((s) => s !== "all"),
      ready_sources: Array.isArray(remote?.ready_sources) ? remote.ready_sources : [],
      disabled_sources: Array.isArray(remote?.disabled_sources) ? remote.disabled_sources : ["mercadolivre"],
      source_readiness: remote?.sources ?? {},
      apify_cost_guard: remote?.apify_cost_guard ?? null,
      collection_enabled: Boolean(cfg.routerUrl && secret && remote?.collection_ready === true),
    });
  }

  const auth = await authorize(req);
  if (!auth.ok) return json({ ok: false, error: "collect_authentication_failed" }, 401);

  if (!cfg.routerUrl || !secret) {
    return json({
      ok: false,
      function: FUNCTION_NAME,
      version: VERSION,
      status: "paused",
      error: "source_router_auth_not_configured",
      collection_performed: false,
    }, 503);
  }

  const stateCode = String(body?.state_code ?? "").trim().toUpperCase();
  const city = text(body?.city);
  const transactionType = body?.transaction_type === "sale" || body?.transaction_type === "rent"
    ? body.transaction_type
    : null;
  const propertyType = text(body?.property_type_code);
  const source = String(body?.source ?? "all").trim().toLowerCase();

  if (stateCode !== "SP" || !city || !transactionType) {
    return json({
      ok: false,
      error: "invalid_request",
      required: ["state_code=SP", "city", "transaction_type"],
    }, 400);
  }

  if (!SUPPORTED_SOURCES.includes(source)) {
    return json({ ok: false, error: "source_not_supported" }, 400);
  }

  const canRun = await rpc("lj_v2_collector_can_run", {});
  if (canRun !== true) return json({ ok: false, error: "collector_disabled_by_master_control" }, 423);

  let workspaceId;
  try {
    workspaceId = String(await resolveWorkspace(auth, body));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ ok: false, error: message }, message === "workspace_forbidden" ? 403 : 400);
  }

  let runId = null;
  try {
    const limit = Math.max(
      10,
      Math.min(200, Number(body?.results_per_query || 10) * Math.max(1, Number(body?.query_limit || 4))),
    );

    const routerResult = await callRouter(cfg.routerUrl, secret, {
      source,
      state_code: stateCode,
      city,
      transaction_type: transactionType,
      property_type_code: propertyType,
      limit,
    });

    runId = await createRun({
      workspaceId,
      auth,
      stateCode,
      city,
      transactionType,
      propertyType,
      source,
    });

    const results = Array.isArray(routerResult?.results) ? routerResult.results : [];
    let newResults = 0;
    let existingResults = 0;
    let persistErrors = 0;
    const persistenceErrorSamples = [];
    const samples = [];

    let position = 0;
    for (const item of results) {
      position += 1;
      try {
        const persisted = await persistViaDb(runId, item, position);
        if (persisted.was_new === true) newResults += 1;
        else existingResults += 1;

        if (samples.length < 5) {
          samples.push({
            source: text(item?.source_name),
            title: text(item?.title),
            url: text(item?.source_url),
            property_type: text(item?.property_type),
            transaction_type: text(item?.transaction_type),
            price: Number.isFinite(Number(item?.price)) ? Number(item.price) : null,
            city: text(item?.city),
          });
        }
      } catch (error) {
        persistErrors += 1;
        const message = error instanceof Error ? error.message : String(error);
        if (persistenceErrorSamples.length < 3) persistenceErrorSamples.push(message.slice(0, 400));
        console.error(`[${FUNCTION_NAME}] persist error`, message);
      }
    }

    const routerStatus = text(routerResult?.status) ?? "completed";
    const sourceReport = Array.isArray(routerResult?.source_report) ? routerResult.source_report : [];
    const finalStatus = persistErrors > 0 || routerStatus === "partial" ? "partial" : "completed";

    await updateRun(runId, {
      status: finalStatus,
      finished_at: new Date().toISOString(),
      total_queries: sourceReport.length > 0 ? sourceReport.length : 1,
      total_raw_results: Number(routerResult?.raw_count ?? results.length),
      total_unique_results: newResults + existingResults,
      total_new_results: newResults,
      total_existing_results: existingResults,
      total_errors: persistErrors,
      counters: {
        source,
        source_report: sourceReport,
        router_status: routerStatus,
        router_raw_results: Number(routerResult?.raw_count ?? results.length),
        router_qualified_results: Number(routerResult?.qualified_count ?? results.length),
        persisted_results: newResults + existingResults,
        new_results: newResults,
        existing_results: existingResults,
        skipped_results: 0,
        persistence_errors: persistErrors,
        persistence_error_samples: persistenceErrorSamples,
      },
      error_message: persistErrors > 0 ? `${persistErrors} persistence errors` : null,
    });

    return json({
      ok: persistErrors === 0,
      function: FUNCTION_NAME,
      version: VERSION,
      status: finalStatus,
      run_id: runId,
      source,
      source_report: sourceReport,
      external_search_engine: false,
      auth_scheme: "hmac-sha256-v1",
      persistence: "lji_ingest_source_router_discovery",
      target: {
        state_code: stateCode,
        city,
        transaction_type: transactionType,
        property_type_code: propertyType,
      },
      counters: {
        raw_results: Number(routerResult?.raw_count ?? results.length),
        qualified_results: Number(routerResult?.qualified_count ?? results.length),
        new_results: newResults,
        existing_results: existingResults,
        skipped_results: 0,
        errors: persistErrors,
      },
      persistence_error_samples: persistenceErrorSamples,
      samples,
    }, persistErrors === 0 ? 200 : 207);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (runId) {
      await updateRun(runId, {
        status: "failed",
        finished_at: new Date().toISOString(),
        total_errors: 1,
        error_message: message.slice(0, 1000),
      }).catch(() => {});
    }

    const status = /source_router_503:/.test(message) ? 503 : 502;
    return json({
      ok: false,
      function: FUNCTION_NAME,
      version: VERSION,
      run_id: runId,
      status: status === 503 ? "paused" : "failed",
      collection_performed: false,
      error: message,
    }, status);
  }
});

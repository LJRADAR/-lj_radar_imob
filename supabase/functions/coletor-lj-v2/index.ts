import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const VERSION = "6.2.0";
const FUNCTION_NAME = "coletor-lj-v2";
const NAMED_SECRET_KEY = "radar_lj_v2_collector";
const ROUTER_SECRET_KEY = "source_router_token";
const URL = String(Deno.env.get("SUPABASE_URL") ?? "").trim().replace(/\/+$/, "");
const SERVICE = String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
const ANON = String(Deno.env.get("SUPABASE_ANON_KEY") ?? "").trim();

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
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
  const secrets = namedSecrets();
  const incomingApiKey = String(req.headers.get("apikey") ?? "").trim();
  const incomingBearer = bearer(req);
  const named = text(secrets[NAMED_SECRET_KEY]);

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
  const envRouterUrl = text(Deno.env.get("LJI_SOURCE_ROUTER_URL"));
  const envRouterToken = text(Deno.env.get("LJI_SOURCE_ROUTER_TOKEN"));
  const secrets = namedSecrets();
  let routerUrl = envRouterUrl;
  let routerToken = envRouterToken ?? text(secrets[ROUTER_SECRET_KEY]);

  if ((!routerUrl || !routerToken) && URL && SERVICE) {
    const rows = await adminGet(
      `lji_internal_secrets?select=key,secret&key=in.(source_router_url,source_router_token)`,
    );
    for (const row of Array.isArray(rows) ? rows : []) {
      if (row?.key === "source_router_url" && !routerUrl) routerUrl = text(row.secret);
      if (row?.key === "source_router_token" && !routerToken) routerToken = text(row.secret);
    }
  }

  if (routerUrl) routerUrl = routerUrl.replace(/\/+$/, "");
  return { routerUrl, routerToken };
}

async function resolveWorkspace(auth, body) {
  const explicit = text(body?.workspace_id);
  if (explicit) return explicit;

  if (auth.mode === "user" && auth.userId) {
    const rows = await adminGet(
      `lji_workspace_members?select=workspace_id&user_id=eq.${encodeURIComponent(auth.userId)}&is_active=eq.true&limit=2`,
    );
    if (Array.isArray(rows) && rows.length === 1) return text(rows[0].workspace_id);
    if (Array.isArray(rows) && rows.length > 1) throw new Error("workspace_id_required_for_multi_workspace_user");
  }

  const workspaces = await adminGet("lji_workspaces?select=id&order=created_at.asc&limit=2");
  if (Array.isArray(workspaces) && workspaces.length === 1) return text(workspaces[0].id);
  throw new Error("workspace_id_required");
}

function canonicalUrl(raw) {
  try {
    const u = new URL(String(raw));
    if (!/^https?:$/.test(u.protocol)) return null;
    u.hash = "";
    for (const key of [...u.searchParams.keys()]) {
      const k = key.toLowerCase();
      if (k.startsWith("utm_") || ["fbclid", "gclid", "ref", "source"].includes(k)) u.searchParams.delete(key);
    }
    if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, "");
    return u.toString();
  } catch {
    return null;
  }
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function isoOrNull(value) {
  const raw = text(value);
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function resultSnippet(item) {
  const description = text(item?.description);
  if (description) return description;
  const parts = [];
  if (Number.isFinite(Number(item?.price))) parts.push(`R$ ${Number(item.price).toLocaleString("pt-BR")}`);
  if (text(item?.neighborhood)) parts.push(text(item.neighborhood));
  return parts.join(" · ") || null;
}

const SOURCE_FALLBACK = {
  mercadolivre: "Mercado Livre Imóveis",
  threads: "Threads público",
};

async function sourceIdByName(name) {
  if (!name) return null;
  const rows = await adminGet(
    `lj_v2_sources?select=id&name=eq.${encodeURIComponent(name)}&is_active=eq.true&limit=1`,
  );
  return Array.isArray(rows) && rows[0]?.id ? rows[0].id : null;
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
      strategy: "source_router_multi_source",
      source,
      external_search_engine: false,
    },
    metadata: { source_router: true, multi_source: source === "all" },
  }], { Prefer: "return=representation" });
  const run = Array.isArray(rows) ? rows[0] : null;
  if (!run?.id) throw new Error("collector_run_create_failed");
  return run.id;
}

async function persistDiscovery({ item, runId, sourceId, request, position }) {
  const originalUrl = text(item?.source_url);
  const normalizedUrl = originalUrl ? canonicalUrl(originalUrl) : null;
  if (!originalUrl || !normalizedUrl) return { saved: false, wasNew: false, reason: "invalid_url" };

  const existingRows = await adminGet(
    `lj_v2_raw_discoveries?select=id,occurrence_count,metadata,discovery_status&original_url=eq.${encodeURIComponent(originalUrl)}&limit=1`,
  );
  const existing = Array.isArray(existingRows) ? existingRows[0] : null;
  const now = new Date().toISOString();
  const publishedAt = isoOrNull(item?.published_at);
  const metadata = {
    ...(existing?.metadata && typeof existing.metadata === "object" ? existing.metadata : {}),
    source_router: {
      source_name: text(item?.source_name),
      source_item_id: text(item?.source_item_id),
      official_api: item?.raw_quality?.official_api === true,
      exact_city_or_zone: item?.raw_quality?.exact_city_or_zone === true,
      owner_signal: item?.raw_quality?.owner_signal === true,
      collected_at: now,
      collector_version: VERSION,
    },
  };
  const common = {
    source_id: sourceId,
    normalized_url: normalizedUrl,
    url_hash: await sha256(normalizedUrl),
    title: text(item?.title),
    snippet: resultSnippet(item),
    advertised_price: Number.isFinite(Number(item?.price)) ? Number(item.price) : null,
    detected_state_code: text(item?.state_code) ?? request.state_code,
    detected_city: text(item?.city) ?? request.city,
    detected_neighborhood: text(item?.neighborhood),
    detected_transaction: text(item?.transaction_type) ?? request.transaction_type,
    detected_property_type: text(item?.property_type) ?? request.property_type_code,
    advertiser_hint: text(item?.seller_nickname),
    ...(publishedAt ? { published_at: publishedAt } : {}),
    last_seen_at: now,
    latest_run_id: runId,
    raw_payload: item,
    metadata,
  };

  let discoveryId;
  let wasNew = false;
  if (existing?.id) {
    discoveryId = existing.id;
    await adminPatch(`lj_v2_raw_discoveries?id=eq.${encodeURIComponent(discoveryId)}`, {
      ...common,
      occurrence_count: Math.max(1, Number(existing.occurrence_count || 1)) + 1,
    });
  } else {
    const rows = await adminPost("lj_v2_raw_discoveries", [{
      original_url: originalUrl,
      ...common,
      discovery_status: "raw",
    }], { Prefer: "return=representation" });
    discoveryId = Array.isArray(rows) ? rows[0]?.id : null;
    wasNew = Boolean(discoveryId);
  }

  if (!discoveryId) return { saved: false, wasNew: false, reason: "discovery_id_missing" };
  await adminPost("lj_v2_collector_run_discoveries?on_conflict=run_id,discovery_id", [{
    run_id: runId,
    discovery_id: discoveryId,
    query_text: `source_router:${text(item?.source_name) ?? "unknown"}`,
    result_position: position,
    relevance_score: null,
    was_new: wasNew,
  }], { Prefer: "resolution=merge-duplicates,return=minimal" });

  return { saved: true, wasNew, discoveryId };
}

async function updateRun(runId, patch) {
  await adminPatch(`lj_v2_collector_runs?id=eq.${encodeURIComponent(runId)}`, {
    ...patch,
    updated_at: new Date().toISOString(),
  });
}

async function callRouter(routerUrl, routerToken, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(`${routerUrl}/collect`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${routerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const body = await req.json().catch(() => ({}));
  const action = body?.action === "collect" ? "collect" : "health";

  if (!URL || !SERVICE) return json({ ok: false, error: "supabase_runtime_missing" }, 500);

  const cfg = await internalConfig();
  if (action === "health") {
    return json({
      ok: true,
      function: FUNCTION_NAME,
      version: VERSION,
      strategy: "source_router_multi_source",
      external_search_engine: false,
      source_router_url_configured: Boolean(cfg.routerUrl),
      source_router_token_configured: Boolean(cfg.routerToken),
      collection_enabled: Boolean(cfg.routerUrl && cfg.routerToken),
      default_source: "all",
      supported_sources: ["mercadolivre", "threads"],
    });
  }

  const auth = await authorize(req);
  if (!auth.ok) return json({ ok: false, error: "collect_authentication_failed" }, 401);
  if (!cfg.routerUrl || !cfg.routerToken) {
    return json({
      ok: false,
      function: FUNCTION_NAME,
      version: VERSION,
      status: "paused",
      error: "source_router_not_configured",
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
  if (!["all", "mercadolivre", "threads"].includes(source)) {
    return json({ ok: false, error: "source_not_supported" }, 400);
  }

  const canRun = await rpc("lj_v2_collector_can_run", {});
  if (canRun !== true) return json({ ok: false, error: "collector_disabled_by_master_control" }, 423);

  const workspaceId = await resolveWorkspace(auth, body);
  let runId = null;
  try {
    const routerResult = await callRouter(cfg.routerUrl, cfg.routerToken, {
      source,
      state_code: stateCode,
      city,
      transaction_type: transactionType,
      property_type_code: propertyType,
      limit: Math.max(
        10,
        Math.min(80, Number(body?.results_per_query || 10) * Math.max(1, Number(body?.query_limit || 4))),
      ),
    });

    runId = await createRun({ workspaceId, auth, stateCode, city, transactionType, propertyType, source });
    const results = Array.isArray(routerResult?.results) ? routerResult.results : [];
    const sourceIdCache = new Map();

    let newResults = 0;
    let existingResults = 0;
    let persistErrors = 0;
    let skippedResults = 0;
    const samples = [];
    let position = 0;

    for (const item of results) {
      position += 1;
      try {
        const itemSourceName = text(item?.source_name) ?? SOURCE_FALLBACK[source] ?? "Web aberta com contato";
        let sourceId = sourceIdCache.get(itemSourceName);
        if (sourceId === undefined) {
          sourceId = await sourceIdByName(itemSourceName);
          if (!sourceId) sourceId = await sourceIdByName("Web aberta com contato");
          sourceIdCache.set(itemSourceName, sourceId ?? null);
        }

        const persisted = await persistDiscovery({
          item,
          runId,
          sourceId: sourceId ?? null,
          request: {
            state_code: stateCode,
            city,
            transaction_type: transactionType,
            property_type_code: propertyType,
          },
          position,
        });
        if (!persisted.saved) {
          skippedResults += 1;
          continue;
        }
        if (persisted.wasNew) newResults += 1;
        else existingResults += 1;
        if (samples.length < 5) {
          samples.push({
            source: itemSourceName,
            title: text(item?.title),
            url: text(item?.source_url),
            property_type: text(item?.property_type),
          });
        }
      } catch (error) {
        persistErrors += 1;
        console.error(`[${FUNCTION_NAME}] persist error`, error);
      }
    }

    const routerStatus = text(routerResult?.status) ?? "completed";
    const finalStatus = persistErrors > 0 || routerStatus === "partial" ? "partial" : "completed";
    const sourceReport = Array.isArray(routerResult?.source_report) ? routerResult.source_report : [];
    const queriesRun = sourceReport.length > 0 ? sourceReport.length : 1;

    await updateRun(runId, {
      status: finalStatus,
      finished_at: new Date().toISOString(),
      total_queries: queriesRun,
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
        skipped_results: skippedResults,
        persistence_errors: persistErrors,
      },
      error_message: persistErrors > 0 ? `${persistErrors} persistence errors` : null,
    });

    return json({
      ok: true,
      function: FUNCTION_NAME,
      version: VERSION,
      status: finalStatus,
      run_id: runId,
      source,
      source_report: sourceReport,
      external_search_engine: false,
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
        skipped_results: skippedResults,
        errors: persistErrors,
      },
      samples,
    });
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
    return json({
      ok: false,
      function: FUNCTION_NAME,
      version: VERSION,
      run_id: runId,
      status: "failed",
      error: message,
    }, 502);
  }
});

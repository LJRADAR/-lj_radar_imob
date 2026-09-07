import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const VERSION = "6.4.0";
const FUNCTION_NAME = "coletor-lj-v2";
const NAMED_SECRET_KEY = "radar_lj_v2_collector";
const URL = String(Deno.env.get("SUPABASE_URL") ?? "").trim().replace(/\/+$/, "");
const SERVICE = String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
const ANON = String(Deno.env.get("SUPABASE_ANON_KEY") ?? "").trim();
const SUPPORTED_SOURCES = ["all", "threads", "olx", "instagram", "facebook", "telegram"];
const SOURCE_FALLBACK: Record<string, string> = {
  threads: "Threads público",
  olx: "OLX Imóveis",
  instagram: "Instagram público",
  facebook: "Facebook público",
  telegram: "Telegram público",
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function text(value: unknown): string | null {
  const v = String(value ?? "").trim();
  return v || null;
}

function namedSecrets(): Record<string, unknown> {
  try {
    return JSON.parse(String(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"));
  } catch {
    return {};
  }
}

function signingSecret(): string {
  const value = namedSecrets()[NAMED_SECRET_KEY];
  return typeof value === "string" ? value.trim() : "";
}

function bearer(req: Request) {
  const auth = String(req.headers.get("authorization") ?? "").trim();
  return auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
}

function adminHeaders(extra: Record<string, string> = {}) {
  return {
    apikey: SERVICE,
    Authorization: `Bearer ${SERVICE}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function adminGet(path: string) {
  const r = await fetch(`${URL}/rest/v1/${path}`, { headers: adminHeaders() });
  const data = await r.json().catch(() => []);
  if (!r.ok) throw new Error(`admin_get_${r.status}:${JSON.stringify(data)}`);
  return data;
}

async function adminPost(path: string, body: unknown, extraHeaders: Record<string, string> = {}) {
  const r = await fetch(`${URL}/rest/v1/${path}`, {
    method: "POST",
    headers: adminHeaders(extraHeaders),
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`admin_post_${r.status}:${JSON.stringify(data)}`);
  return data;
}

async function adminPatch(path: string, body: unknown) {
  const r = await fetch(`${URL}/rest/v1/${path}`, {
    method: "PATCH",
    headers: adminHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => []);
  if (!r.ok) throw new Error(`admin_patch_${r.status}:${JSON.stringify(data)}`);
  return data;
}

async function rpc(name: string, body: Record<string, unknown> = {}) {
  return adminPost(`rpc/${name}`, body);
}

async function authorize(req: Request) {
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

async function resolveWorkspace(auth: { mode: string; userId: string | null }, body: Record<string, unknown>) {
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

function canonicalUrl(raw: unknown) {
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

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function base64(bytes: ArrayBuffer) {
  let binary = "";
  for (const b of new Uint8Array(bytes)) binary += String.fromCharCode(b);
  return btoa(binary);
}

async function hmacSignature(secret: string, message: string) {
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

function isoOrNull(value: unknown) {
  const raw = text(value);
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function resultSnippet(item: any) {
  const description = text(item?.description);
  if (description) return description;
  const parts: string[] = [];
  if (Number.isFinite(Number(item?.price))) parts.push(`R$ ${Number(item.price).toLocaleString("pt-BR")}`);
  if (text(item?.neighborhood)) parts.push(text(item.neighborhood) as string);
  return parts.join(" · ") || null;
}

async function sourceIdByName(name: string | null) {
  if (!name) return null;
  const rows = await adminGet(`lj_v2_sources?select=id&name=eq.${encodeURIComponent(name)}&is_active=eq.true&limit=1`);
  return Array.isArray(rows) && rows[0]?.id ? rows[0].id : null;
}

async function createRun(args: {
  workspaceId: string; auth: any; stateCode: string; city: string; transactionType: string; propertyType: string | null; source: string;
}) {
  const rows = await adminPost("lj_v2_collector_runs", [{
    workspace_id: args.workspaceId,
    run_mode: args.auth.mode === "user" ? "manual" : "scheduled",
    status: "running",
    requested_by: args.auth.userId,
    state_code: args.stateCode,
    city: args.city,
    transaction_type: args.transactionType,
    property_type_code: args.propertyType,
    started_at: new Date().toISOString(),
    system_snapshot: {
      collector_version: VERSION,
      strategy: "source_router_multi_provider",
      source: args.source,
      external_search_engine: false,
      providers: ["threads_api", "apify"],
      router_auth: "hmac-sha256-v1",
    },
    metadata: { source_router: true, requested_source: args.source },
  }], { Prefer: "return=representation" });
  const run = Array.isArray(rows) ? rows[0] : null;
  if (!run?.id) throw new Error("collector_run_create_failed");
  return run.id as string;
}

async function persistDiscovery(args: { item: any; runId: string; sourceId: string | null; request: any; position: number }) {
  const originalUrl = text(args.item?.source_url);
  const normalizedUrl = originalUrl ? canonicalUrl(originalUrl) : null;
  if (!originalUrl || !normalizedUrl) return { saved: false, wasNew: false, reason: "invalid_url" };

  const existingRows = await adminGet(
    `lj_v2_raw_discoveries?select=id,occurrence_count,metadata,discovery_status&original_url=eq.${encodeURIComponent(originalUrl)}&limit=1`,
  );
  const existing = Array.isArray(existingRows) ? existingRows[0] : null;
  const now = new Date().toISOString();
  const publishedAt = isoOrNull(args.item?.published_at);
  const provider = args.item?.raw_quality?.apify === true
    ? "apify"
    : args.item?.raw_quality?.official_api === true
      ? "official_api"
      : "source_router";
  const metadata = {
    ...(existing?.metadata && typeof existing.metadata === "object" ? existing.metadata : {}),
    source_router: {
      source_name: text(args.item?.source_name),
      source_item_id: text(args.item?.source_item_id),
      provider,
      official_api: args.item?.raw_quality?.official_api === true,
      apify: args.item?.raw_quality?.apify === true,
      exact_city_or_zone: args.item?.raw_quality?.exact_city_or_zone === true,
      owner_signal: args.item?.raw_quality?.owner_signal === true,
      collected_at: now,
      collector_version: VERSION,
      router_auth: "hmac-sha256-v1",
    },
  };
  const common = {
    source_id: args.sourceId,
    normalized_url: normalizedUrl,
    url_hash: await sha256(normalizedUrl),
    title: text(args.item?.title),
    snippet: resultSnippet(args.item),
    advertised_price: Number.isFinite(Number(args.item?.price)) ? Number(args.item.price) : null,
    detected_state_code: text(args.item?.state_code) ?? args.request.state_code,
    detected_city: text(args.item?.city) ?? args.request.city,
    detected_neighborhood: text(args.item?.neighborhood),
    detected_transaction: text(args.item?.transaction_type) ?? args.request.transaction_type,
    detected_property_type: text(args.item?.property_type) ?? args.request.property_type_code,
    advertiser_hint: text(args.item?.seller_nickname),
    ...(publishedAt ? { published_at: publishedAt } : {}),
    last_seen_at: now,
    latest_run_id: args.runId,
    raw_payload: args.item,
    metadata,
  };

  let discoveryId: string | null = null;
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
    discoveryId = Array.isArray(rows) ? rows[0]?.id ?? null : null;
    wasNew = Boolean(discoveryId);
  }

  if (!discoveryId) return { saved: false, wasNew: false, reason: "discovery_id_missing" };
  await adminPost("lj_v2_collector_run_discoveries?on_conflict=run_id,discovery_id", [{
    run_id: args.runId,
    discovery_id: discoveryId,
    query_text: `source_router:${text(args.item?.source_name) ?? "unknown"}`,
    result_position: args.position,
    relevance_score: null,
    was_new: wasNew,
  }], { Prefer: "resolution=merge-duplicates,return=minimal" });

  return { saved: true, wasNew, discoveryId };
}

async function updateRun(runId: string, patch: Record<string, unknown>) {
  await adminPatch(`lj_v2_collector_runs?id=eq.${encodeURIComponent(runId)}`, {
    ...patch,
    updated_at: new Date().toISOString(),
  });
}

async function routerHealth(routerUrl: string | null) {
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

async function callRouter(routerUrl: string, secret: string, body: Record<string, unknown>) {
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
      const err = new Error(`source_router_${response.status}:${text(data?.error) ?? "collection_failed"}`) as Error & { status?: number; router?: any };
      err.status = response.status;
      err.router = data;
      throw err;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
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
      strategy: "source_router_multi_provider",
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
  const transactionType = body?.transaction_type === "sale" || body?.transaction_type === "rent" ? body.transaction_type : null;
  const propertyType = text(body?.property_type_code);
  const source = String(body?.source ?? "all").trim().toLowerCase();

  if (stateCode !== "SP" || !city || !transactionType) {
    return json({ ok: false, error: "invalid_request", required: ["state_code=SP", "city", "transaction_type"] }, 400);
  }
  if (!SUPPORTED_SOURCES.includes(source)) {
    return json({
      ok: false,
      error: source === "mercadolivre" ? "source_temporarily_disabled_pending_official_access" : "source_not_supported",
    }, 400);
  }

  const canRun = await rpc("lj_v2_collector_can_run", {});
  if (canRun !== true) return json({ ok: false, error: "collector_disabled_by_master_control" }, 423);

  let workspaceId: string;
  try {
    workspaceId = String(await resolveWorkspace(auth, body));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ ok: false, error: message }, message === "workspace_forbidden" ? 403 : 400);
  }

  let runId: string | null = null;
  try {
    const routerResult = await callRouter(cfg.routerUrl, secret, {
      source,
      state_code: stateCode,
      city,
      transaction_type: transactionType,
      property_type_code: propertyType,
      limit: Math.max(10, Math.min(80, Number(body?.results_per_query || 10) * Math.max(1, Number(body?.query_limit || 4)))),
    });

    runId = await createRun({ workspaceId, auth, stateCode, city, transactionType, propertyType, source });
    const results = Array.isArray(routerResult?.results) ? routerResult.results : [];
    const sourceIdCache = new Map<string, string | null>();
    let newResults = 0;
    let existingResults = 0;
    let persistErrors = 0;
    let skippedResults = 0;
    const samples: Array<Record<string, unknown>> = [];
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
          request: { state_code: stateCode, city, transaction_type: transactionType, property_type_code: propertyType },
          position,
        });
        if (!persisted.saved) {
          skippedResults += 1;
          continue;
        }
        if (persisted.wasNew) newResults += 1;
        else existingResults += 1;
        if (samples.length < 5) {
          samples.push({ source: itemSourceName, title: text(item?.title), url: text(item?.source_url), property_type: text(item?.property_type) });
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
      auth_scheme: "hmac-sha256-v1",
      target: { state_code: stateCode, city, transaction_type: transactionType, property_type_code: propertyType },
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

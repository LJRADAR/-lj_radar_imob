import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@^2";

const VERSION = "4.1.0";
const FUNCTION_NAME = "verificador-quinto-lj";
const COLLECTOR_SECRET_KEY = "radar_lj_v2_collector";
const URL = Deno.env.get("SUPABASE_URL") || "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") || "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization,x-lji-cron-key,content-type,apikey,x-client-info",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};

const clean = (v: any) => typeof v === "string" ? v.trim() : "";
const num = (v: any) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const json = (x: any, status = 200) => new Response(JSON.stringify(x), {
  status,
  headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
});

function namedSecrets() {
  try {
    return JSON.parse(String(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"));
  } catch {
    return {};
  }
}

function signingSecret() {
  return clean(namedSecrets()[COLLECTOR_SECRET_KEY]);
}

function bearer(req: Request) {
  const raw = clean(req.headers.get("Authorization"));
  return raw.toLowerCase().startsWith("bearer ") ? raw.slice(7).trim() : "";
}

async function authContext(req: Request, sb: any) {
  const cron = clean(req.headers.get("x-lji-cron-key"));
  if (cron) {
    const { data } = await sb.from("lji_internal_secrets").select("secret").eq("key", "intent_cron").maybeSingle();
    if (data?.secret && data.secret === cron) return { ok: true, mode: "cron", userId: null };
  }

  const incomingApiKey = clean(req.headers.get("apikey"));
  const incomingBearer = bearer(req);
  const named = signingSecret();
  if (named && (incomingApiKey === named || incomingBearer === named)) {
    return { ok: true, mode: "internal", userId: null };
  }
  if (SERVICE && incomingBearer === SERVICE) {
    return { ok: true, mode: "service", userId: null };
  }

  if (!incomingBearer || !ANON) return { ok: false, mode: "none", userId: null };
  const uc = createClient(URL, ANON, { global: { headers: { Authorization: `Bearer ${incomingBearer}` } } });
  const { data: { user } } = await uc.auth.getUser();
  if (!user?.id) return { ok: false, mode: "user", userId: null };

  const { data: allowed } = await uc.rpc("lj_v2_has_permission", { p_permission_key: "run_manual_collector" });
  if (allowed !== true) return { ok: false, mode: "user", userId: user.id };
  return { ok: true, mode: "user", userId: user.id };
}

function isQaUrl(v: any) {
  try {
    const h = new URL(String(v || "")).hostname.replace(/^www\./, "").toLowerCase();
    return h === "quintoandar.com.br" || h.endsWith(".quintoandar.com.br");
  } catch {
    return false;
  }
}

async function authorizeAndHydrateCandidate(sb: any, auth: any, rawCandidate: any) {
  const listingId = clean(rawCandidate?.listing_id);
  if (!listingId) return { ok: false, status: 400, error: "listing_id_required" };

  const { data: listing, error: listingError } = await sb
    .from("lj_v2_listings")
    .select("id,property_id,original_url,title,transaction_type,price,advertised_city,advertised_neighborhood,advertised_address")
    .eq("id", listingId)
    .maybeSingle();
  if (listingError) return { ok: false, status: 500, error: "listing_lookup_failed" };
  if (!listing?.id) return { ok: false, status: 404, error: "listing_not_found" };

  if (auth.mode === "user") {
    const { data: memberships, error: memberError } = await sb
      .from("lji_workspace_members")
      .select("workspace_id")
      .eq("user_id", auth.userId)
      .eq("is_active", true);
    if (memberError) return { ok: false, status: 500, error: "workspace_membership_lookup_failed" };
    const workspaceIds = [...new Set((memberships || []).map((r: any) => clean(r.workspace_id)).filter(Boolean))];
    if (!workspaceIds.length) return { ok: false, status: 403, error: "workspace_forbidden" };

    const { data: owned, error: ownedError } = await sb
      .from("lji_opportunity_index")
      .select("id")
      .in("workspace_id", workspaceIds)
      .contains("raw_snapshot", { listing_id: listingId })
      .limit(1);
    if (ownedError) return { ok: false, status: 500, error: "object_authorization_lookup_failed" };
    if (!owned?.length) return { ok: false, status: 403, error: "listing_not_in_user_workspace" };
  }

  let property: any = null;
  if (listing.property_id) {
    const { data, error } = await sb
      .from("lj_v2_properties")
      .select("id,property_type,city,neighborhood,postal_code,canonical_address,area_m2,bedrooms,parking_spaces")
      .eq("id", listing.property_id)
      .maybeSingle();
    if (error) return { ok: false, status: 500, error: "property_lookup_failed" };
    property = data;
  }

  return {
    ok: true,
    candidate: {
      listing_id: listing.id,
      property_id: listing.property_id || property?.id || null,
      source_url: clean(listing.original_url) || null,
      title: clean(listing.title) || null,
      city: clean(property?.city) || clean(listing.advertised_city) || null,
      neighborhood: clean(property?.neighborhood) || clean(listing.advertised_neighborhood) || null,
      address: clean(property?.canonical_address) || clean(listing.advertised_address) || null,
      cep: clean(property?.postal_code) || null,
      property_type: clean(property?.property_type) || null,
      transaction_type: clean(listing.transaction_type) || null,
      price: num(listing.price),
      area_m2: num(property?.area_m2),
      bedrooms: num(property?.bedrooms),
      parking_spaces: num(property?.parking_spaces),
    },
  };
}

async function persist(sb: any, c: any, p: any) {
  const listing = clean(c.listing_id);
  const property = clean(c.property_id);
  if (!listing) return { attempted: false };
  const row = {
    listing_id: listing,
    property_id: property || null,
    verifier_version: VERSION,
    status: p.status,
    approved_for_pipeline: p.approved_for_pipeline === true,
    confidence: p.confidence ?? null,
    reason: p.reason || null,
    strong_match_evidence: p.strong_match_evidence === true,
    best_match: p.best_match || null,
    matches: p.matches || [],
    failed_queries: p.failed_queries || [],
    searches_planned: p.searches_planned || 0,
    searches_run: p.searches_run || 0,
    searches_failed: p.searches_failed || 0,
    results_checked: p.results_checked || 0,
    generic_results_ignored: p.generic_results_ignored || 0,
    checked_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const { error } = await sb.from("lj_v2_quinto_checks").upsert(row, { onConflict: "listing_id" });
  return { attempted: true, ok: !error, error: error?.message || null };
}

async function routerUrl(sb: any) {
  const env = clean(Deno.env.get("LJI_SOURCE_ROUTER_URL"));
  if (env) return env.replace(/\/+$/, "");
  const { data } = await sb.from("lji_internal_secrets").select("secret").eq("key", "source_router_url").maybeSingle();
  return clean(data?.secret).replace(/\/+$/, "");
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
  return base64(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

async function callRouterVerifier(sb: any, candidate: any) {
  const base = await routerUrl(sb);
  const secret = signingSecret();
  if (!base || !secret) {
    return { ok: true, status: "inconclusive", confidence: 0, approved_for_pipeline: false, provider: "none", reason: "source_router_not_configured", results_checked: 0 };
  }

  const path = "/verify-quinto";
  const rawBody = JSON.stringify({ candidate });
  const bodySha = await sha256(rawBody);
  const timestamp = String(Date.now());
  const nonce = crypto.randomUUID();
  const signature = await hmacSignature(secret, `POST\n${path}\n${timestamp}\n${nonce}\n${bodySha}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch(`${base}${path}`, {
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
      return { ok: true, status: "inconclusive", confidence: 0, approved_for_pipeline: false, provider: "source_router", reason: `source_router_${response.status}`, results_checked: 0 };
    }
    return data;
  } catch (e) {
    const reason = e instanceof Error && e.name === "AbortError" ? "source_router_timeout" : "source_router_verifier_failed";
    return { ok: true, status: "inconclusive", confidence: 0, approved_for_pipeline: false, provider: "source_router", reason, results_checked: 0 };
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const sb = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
    const action = clean(body.action || "verify").toLowerCase();

    if (action === "health") {
      const base = await routerUrl(sb);
      return json({
        ok: true,
        function: FUNCTION_NAME,
        version: VERSION,
        candidate_hydration_from_database: true,
        object_authorization: true,
        provider: "source_router_apify_positive_only",
        external_search_engine: false,
        source_router_configured: Boolean(base),
        router_auth_signing_configured: Boolean(signingSecret()),
        positive_match_only: true,
        absence_means: "inconclusive",
        fail_closed: true,
      });
    }

    const auth = await authContext(req, sb);
    if (!auth.ok) return json({ ok: false, error: "unauthorized" }, 401);

    const hydrated = await authorizeAndHydrateCandidate(sb, auth, body.candidate || body);
    if (!hydrated.ok) return json({ ok: false, error: hydrated.error }, hydrated.status || 403);
    const c = hydrated.candidate;
    const source = clean(c.source_url || c.url || c.link);

    if (isQaUrl(source)) {
      const p: any = {
        ok: true,
        status: "found_on_quintoandar",
        approved_for_pipeline: false,
        confidence: 100,
        reason: "source_is_quintoandar",
        strong_match_evidence: true,
        best_match: { link: source, match_score: 100, match_reasons: ["source_is_quintoandar"] },
        matches: [{ link: source }],
        provider: "direct_url",
        external_search_engine: false,
        searches_planned: 0,
        searches_run: 0,
        searches_failed: 0,
        results_checked: 1,
      };
      p.database_write = await persist(sb, c, p);
      return json({ ...p, version: VERSION });
    }

    const identifying = [c.address, c.cep, c.neighborhood, c.area_m2, c.bedrooms, c.parking_spaces, c.price]
      .filter((x) => x !== null && x !== undefined && String(x).trim() !== "");

    if (identifying.length < 3 || !c.city || !["sale", "rent"].includes(c.transaction_type)) {
      const p: any = {
        ok: true,
        status: "inconclusive",
        approved_for_pipeline: false,
        confidence: 0,
        reason: "insufficient_identifiers",
        strong_match_evidence: false,
        best_match: null,
        matches: [],
        failed_queries: [],
        provider: "none",
        external_search_engine: false,
        searches_planned: 0,
        searches_run: 0,
        searches_failed: 0,
        results_checked: 0,
        generic_results_ignored: 0,
      };
      p.database_write = await persist(sb, c, p);
      return json({ ...p, version: VERSION });
    }

    const remote: any = await callRouterVerifier(sb, c);
    const found = remote.status === "found_on_quintoandar";
    const bestMatch = found ? {
      link: clean(remote.match_url) || null,
      external_id: clean(remote.match_id) || null,
      match_score: num(remote.confidence) || 0,
      match_reasons: Array.isArray(remote.evidence) ? remote.evidence : [],
    } : null;

    const p: any = {
      ok: true,
      status: found ? "found_on_quintoandar" : "inconclusive",
      approved_for_pipeline: false,
      confidence: found ? (num(remote.confidence) || 0) : Math.min(69, num(remote.confidence) || 0),
      reason: clean(remote.reason) || (found ? "strong_positive_match" : "verification_inconclusive"),
      strong_match_evidence: found,
      best_match: bestMatch,
      matches: bestMatch ? [bestMatch] : [],
      failed_queries: [],
      provider: clean(remote.provider) || "source_router",
      external_search_engine: false,
      searches_planned: 1,
      searches_run: 1,
      searches_failed: 0,
      results_checked: Number(remote.results_checked || 0),
      generic_results_ignored: 0,
      positive_match_only: true,
    };
    p.database_write = await persist(sb, c, p);
    return json({ ...p, version: VERSION });
  } catch (e) {
    return json({ ok: false, version: VERSION, error: String((e as Error)?.message || e) }, 500);
  }
});

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@^2";

const VERSION = "3.3.0";
const FUNCTION_NAME = "verificador-quinto-lj";
const COLLECTOR_SECRET_KEY = "radar_lj_v2_collector";
const URL = Deno.env.get("SUPABASE_URL") || "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") || "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const TAVILY = Deno.env.get("TAVILY_API_KEY") || "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization,x-lji-cron-key,content-type,apikey,x-client-info",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};

const clean = (v: any) => typeof v === "string" ? v.trim() : "";
const norm = (v: any) => String(v ?? "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9\s]/g, " ")
  .replace(/\s+/g, " ")
  .trim();
const num = (v: any) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const json = (x: any, status = 200) => new Response(JSON.stringify(x), {
  status,
  headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
});
const cepDigits = (v: any) => {
  const d = String(v || "").replace(/\D/g, "");
  return d.length === 8 ? d : "";
};

function namedSecrets() {
  try {
    return JSON.parse(String(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"));
  } catch {
    return {};
  }
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
  const named = clean(namedSecrets()[COLLECTOR_SECRET_KEY]);
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

function individualQa(v: any) {
  if (!isQaUrl(v)) return false;
  try {
    return /^\/imovel\/\d+(?:\/|$)/.test(new URL(String(v)).pathname.toLowerCase());
  } catch {
    return false;
  }
}

function usefulAddressTokens(v: any) {
  const ignored = new Set(["rua", "avenida", "av", "alameda", "travessa", "estrada", "rodovia", "praca", "de", "da", "do", "das", "dos", "numero"]);
  return norm(v).split(" ").filter((x) => x.length >= 4 && !ignored.has(x) && !/^\d+$/.test(x)).slice(0, 7);
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

  const candidate = {
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
  };

  return { ok: true, candidate };
}

function candidateQuery(c: any) {
  const city = clean(c.city || c.cidade);
  const bairro = clean(c.neighborhood || c.bairro);
  const address = clean(c.address || c.endereco);
  const cep = cepDigits(c.cep || c.postal_code);
  const type = clean(c.property_type || c.type || c.tipo);
  const area = num(c.area_m2 || c.area);
  const beds = num(c.bedrooms || c.quartos);
  const price = num(c.price || c.valor);
  const parts = [`site:quintoandar.com.br/imovel \"${city}\"`];
  if (address) parts.push(`\"${address}\"`);
  else if (cep) parts.push(`\"${cep.slice(0, 5)}-${cep.slice(5)}\"`);
  else if (bairro) parts.push(`\"${bairro}\"`);
  if (type) parts.push(`\"${type}\"`);
  if (area) parts.push(`\"${Math.round(area)} m²\"`);
  if (beds) parts.push(`\"${Math.round(beds)} quartos\"`);
  if (price) parts.push(`\"R$ ${Math.round(price).toLocaleString("pt-BR")}\"`);
  return parts.join(" ");
}

async function search(q: string) {
  const r = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { Authorization: `Bearer ${TAVILY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      query: q,
      search_depth: "basic",
      max_results: 10,
      topic: "general",
      include_domains: ["quintoandar.com.br"],
      country: "brazil",
      include_answer: false,
      include_raw_content: false,
      include_images: false,
      auto_parameters: false,
      safe_search: true,
    }),
  });
  if (!r.ok) {
    const b = await r.text().catch(() => "");
    throw new Error(`Tavily ${r.status}: ${b.slice(0, 180)}`);
  }
  const j = await r.json().catch(() => ({}));
  return (Array.isArray(j.results) ? j.results : []).map((x: any) => ({ title: x.title || "", link: x.url || "", snippet: x.content || "" }));
}

function firstInt(raw: string, rx: RegExp) {
  const m = raw.match(rx);
  if (!m?.[1]) return null;
  const n = Number(m[1].replace(/\D/g, ""));
  return Number.isFinite(n) ? n : null;
}

function extractPrice(raw: string) {
  const m = raw.match(/R\$\s*([\d.]{4,})/i);
  if (!m?.[1]) return null;
  const n = Number(m[1].replace(/\./g, ""));
  return Number.isFinite(n) ? n : null;
}

function extractCep(raw: string) {
  const m = String(raw || "").match(/\b(\d{5})-?(\d{3})\b/);
  return m ? `${m[1]}${m[2]}` : "";
}

function evalMatch(c: any, r: any) {
  const raw = `${r.title || ""} ${r.snippet || ""}`;
  const text = norm(`${raw} ${r.link || ""}`);
  const reasons: string[] = [];
  const mismatches: string[] = [];
  let score = 0;
  const city = norm(c.city || c.cidade);
  const bairro = norm(c.neighborhood || c.bairro);
  const type = norm(c.property_type || c.type || c.tipo);
  const address = clean(c.address || c.endereco);
  const cep = cepDigits(c.cep || c.postal_code);
  const area = num(c.area_m2 || c.area);
  const beds = num(c.bedrooms || c.quartos);
  const park = num(c.parking_spaces || c.parking || c.vagas);
  const price = num(c.price || c.valor);

  if (isQaUrl(r.link)) { score += 10; reasons.push("quintoandar_domain"); }
  if (city && text.includes(city)) { score += 15; reasons.push("same_city"); }
  if (bairro && text.includes(bairro)) { score += 15; reasons.push("same_neighborhood"); }
  if (cep) {
    const rc = extractCep(raw);
    if (rc === cep) { score += 30; reasons.push("same_cep"); }
    else if (rc) { score -= 25; reasons.push("cep_mismatch"); mismatches.push("cep"); }
  }
  const at = usefulAddressTokens(address);
  if (at.length) {
    const hit = at.filter((x) => text.includes(x)).length;
    const ratio = hit / at.length;
    if (ratio >= .8) { score += 35; reasons.push("strong_address_match"); }
    else if (ratio >= .5) { score += 20; reasons.push("partial_address_match"); }
  }
  if (type) {
    const apartment = type.includes("apart");
    const house = type.includes("casa") || type.includes("sobrado");
    if ((apartment && /\bapartamento\b/.test(text)) || (house && /\b(casa|sobrado)\b/.test(text)) || (!apartment && !house && text.includes(type))) {
      score += 10; reasons.push("same_property_type");
    } else if ((apartment && /\b(casa|sobrado)\b/.test(text)) || (house && /\bapartamento\b/.test(text))) {
      score -= 25; reasons.push("property_type_mismatch"); mismatches.push("type");
    }
  }
  if (area) {
    const v = firstInt(raw, /\b(\d{2,5})\s*m(?:²|2)\b/i);
    if (v) {
      const ratio = Math.abs(v - area) / area;
      if (Math.abs(v - area) <= 2 || ratio <= .02) { score += 20; reasons.push("exact_area"); }
      else if (ratio <= .05) { score += 8; reasons.push("approximate_area"); }
      else { score -= 25; reasons.push("area_mismatch"); mismatches.push("area"); }
    }
  }
  if (beds) {
    const v = firstInt(norm(raw), /\b(\d+)\s+(?:quarto|quartos|dormitorio|dormitorios)\b/i);
    if (v === beds) { score += 10; reasons.push("same_bedrooms"); }
    else if (v) { score -= 15; reasons.push("bedrooms_mismatch"); mismatches.push("bedrooms"); }
  }
  if (park) {
    const v = firstInt(norm(raw), /\b(\d+)\s+(?:vaga|vagas)\b/i);
    if (v === park) { score += 8; reasons.push("same_parking_spaces"); }
    else if (v) { score -= 8; reasons.push("parking_spaces_mismatch"); mismatches.push("parking"); }
  }
  if (price) {
    const v = extractPrice(raw);
    if (v) {
      const ratio = Math.abs(v - price) / price;
      if (ratio <= .015) { score += 12; reasons.push("same_price"); }
      else if (ratio <= .05) { score += 4; reasons.push("approximate_price"); }
      else { score -= 12; reasons.push("price_mismatch"); mismatches.push("price"); }
    }
  }
  return {
    title: r.title || null,
    link: r.link || null,
    snippet: r.snippet || null,
    match_score: Math.max(0, Math.min(100, score)),
    match_reasons: reasons,
    mismatches,
    candidate_fields: {
      has_address: Boolean(address), has_cep: Boolean(cep), has_neighborhood: Boolean(bairro),
      has_area: Boolean(area), has_bedrooms: Boolean(beds), has_parking: Boolean(park),
      has_price: Boolean(price), has_type: Boolean(type),
    },
  };
}

function strictIdentity(m: any) {
  if (!m || m.mismatches?.length) return false;
  const r = new Set(m.match_reasons || []);
  const f = m.candidate_fields || {};
  const corroborators = ["exact_area", "same_price", "same_bedrooms", "same_parking_spaces", "same_property_type"].filter((x) => r.has(x)).length;
  if (r.has("strong_address_match")) return corroborators >= 2;
  if (r.has("same_cep")) return r.has("same_property_type") && corroborators >= 2;
  if (r.has("partial_address_match")) return r.has("exact_area") && r.has("same_price") && r.has("same_property_type") && (!f.has_bedrooms || r.has("same_bedrooms"));
  if (!r.has("same_neighborhood") || !r.has("same_property_type") || !r.has("exact_area") || !r.has("same_price")) return false;
  if (f.has_bedrooms && !r.has("same_bedrooms")) return false;
  if (f.has_parking && !r.has("same_parking_spaces")) return false;
  return true;
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const sb = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
    const action = clean(body.action || "verify").toLowerCase();

    if (action === "health") {
      return json({
        ok: true,
        function: FUNCTION_NAME,
        version: VERSION,
        strict_identity: true,
        candidate_hydration_from_database: true,
        object_authorization: true,
        provider: "tavily",
        tavily_configured: Boolean(TAVILY),
      });
    }

    const auth = await authContext(req, sb);
    if (!auth.ok) return json({ ok: false, error: "unauthorized" }, 401);

    const hydrated = await authorizeAndHydrateCandidate(sb, auth, body.candidate || body);
    if (!hydrated.ok) return json({ ok: false, error: hydrated.error }, hydrated.status || 403);
    const c = hydrated.candidate;

    if (!TAVILY) return json({ ok: false, error: "quinto_search_provider_not_configured" }, 503);
    const source = clean(c.source_url || c.url || c.link);
    const city = clean(c.city || c.cidade);
    if (!city) return json({ ok: false, error: "city_required" }, 400);

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
        provider: "tavily",
        searches_planned: 0,
        searches_run: 0,
        searches_failed: 0,
      };
      p.database_write = await persist(sb, c, p);
      return json({ ...p, version: VERSION });
    }

    const identifying = [c.address, c.cep, c.neighborhood, c.area_m2, c.bedrooms, c.parking_spaces, c.price]
      .filter((x) => x !== null && x !== undefined && String(x).trim() !== "");
    if (identifying.length < 3) {
      const p: any = {
        ok: true,
        status: "inconclusive",
        approved_for_pipeline: false,
        confidence: null,
        reason: "insufficient_identifiers",
        strong_match_evidence: false,
        matches: [],
        provider: "tavily",
        searches_planned: 0,
        searches_run: 0,
        searches_failed: 0,
      };
      p.database_write = await persist(sb, c, p);
      return json({ ...p, version: VERSION });
    }

    const q = candidateQuery(c);
    let rows: any[] = [];
    try {
      rows = await search(q);
    } catch (e) {
      const p: any = {
        ok: true,
        status: "inconclusive",
        approved_for_pipeline: false,
        confidence: null,
        reason: "search_provider_error",
        strong_match_evidence: false,
        matches: [],
        failed_queries: [{ query: q, error: String((e as Error)?.message || e) }],
        provider: "tavily",
        searches_planned: 1,
        searches_run: 0,
        searches_failed: 1,
      };
      p.database_write = await persist(sb, c, p);
      return json({ ...p, version: VERSION });
    }

    let generic = 0;
    const individual = rows.filter((r) => {
      if (!individualQa(r.link)) { generic++; return false; }
      return true;
    });
    const matches = individual.map((r) => evalMatch(c, r)).sort((a, b) => b.match_score - a.match_score);
    const best = matches[0] || null;
    const strong = strictIdentity(best);
    let status = "no_public_match_found";
    let approved = true;
    let reason = "no_strong_public_match";
    let confidence = 80;
    if (best && (strong || best.match_score >= 55)) {
      status = strong && best.match_score >= 80 ? "found_on_quintoandar" : "inconclusive";
      approved = false;
      reason = status === "found_on_quintoandar" ? "strict_identity_match" : "similar_listing_not_identity_proven";
      confidence = best.match_score;
    }

    const p: any = {
      ok: true,
      status,
      approved_for_pipeline: approved,
      confidence,
      reason,
      strong_match_evidence: strong,
      best_match: status === "found_on_quintoandar" ? best : null,
      matches: matches.slice(0, 5),
      failed_queries: [],
      provider: "tavily",
      searches_planned: 1,
      searches_run: 1,
      searches_failed: 0,
      results_checked: matches.length,
      generic_results_ignored: generic,
    };
    p.database_write = await persist(sb, c, p);
    return json({ ...p, version: VERSION });
  } catch (e) {
    return json({ ok: false, version: VERSION, error: String((e as Error)?.message || e) }, 500);
  }
});

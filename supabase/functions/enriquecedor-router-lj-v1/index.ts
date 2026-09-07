import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const FUNCTION_NAME = "enriquecedor-router-lj-v1";
const VERSION = "1.0.0";
const NAMED_SECRET_KEY = "radar_lj_v2_collector";
const MAX_AGE_DAYS = 365;
const MAX_BATCH = 30;
const URL = String(Deno.env.get("SUPABASE_URL") ?? "").trim().replace(/\/+$/, "");

type Json = Record<string, any>;

type Discovery = {
  id: string;
  source_id: string | null;
  original_url: string;
  title: string | null;
  snippet: string | null;
  advertised_price: number | null;
  detected_state_code: string | null;
  detected_city: string | null;
  detected_neighborhood: string | null;
  detected_transaction: string | null;
  detected_property_type: string | null;
  advertiser_hint: string | null;
  published_at: string | null;
  raw_payload: Json;
  metadata: Json;
};

const RESIDENTIAL = new Set(["Apartamento", "Casa", "Studio", "Cobertura"]);

function reply(payload: unknown, status = 200) {
  return Response.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

function text(value: unknown): string | null {
  const v = String(value ?? "").replace(/\s+/g, " ").trim();
  return v || null;
}

function norm(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function smallInt(value: unknown): number | null {
  const n = finite(value);
  return n === null ? null : Math.max(0, Math.min(100, Math.trunc(n)));
}

function iso(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function namedSecret(): string {
  try {
    const parsed = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}") as Json;
    const value = parsed[NAMED_SECRET_KEY];
    return typeof value === "string" ? value.trim() : "";
  } catch {
    return "";
  }
}

function authorized(req: Request): boolean {
  const expected = namedSecret();
  if (!expected) return false;
  const apiKey = String(req.headers.get("apikey") ?? "").trim();
  const auth = String(req.headers.get("authorization") ?? "").trim();
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  return apiKey === expected || bearer === expected;
}

function adminClient() {
  const secret = namedSecret();
  if (!URL || !secret) return null;
  return createClient(URL, secret, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function normalizePropertyType(value: unknown): string | null {
  const n = norm(value);
  if (!n) return null;
  if (/\b(apartamento|apartamentos|apto|apartment)\b/.test(n)) return "Apartamento";
  if (/\b(casa|casas|sobrado|sobrados|house|home)\b/.test(n)) return "Casa";
  if (/\b(cobertura|coberturas|penthouse)\b/.test(n)) return "Cobertura";
  if (/\b(studio|studios|kitnet|kitnets|flat)\b/.test(n)) return "Studio";
  if (/\b(sala comercial|galpao|loja|escritorio|terreno|lote|fazenda|sitio|chacara)\b/.test(n)) return "Não residencial";
  return null;
}

function inferPropertyType(row: Discovery): string | null {
  return normalizePropertyType(row.raw_payload?.property_type)
    ?? normalizePropertyType(row.detected_property_type)
    ?? normalizePropertyType(`${row.title ?? ""} ${row.snippet ?? ""} ${row.raw_payload?.description ?? ""}`);
}

function professionalClassification(row: Discovery): "broker" | "real_estate_agency" | "developer" | null {
  const raw = row.raw_payload ?? {};
  const sellerType = norm(raw?.seller_type ?? raw?.attributes?.seller_type);
  const content = norm(`${raw?.seller_nickname ?? ""} ${row.title ?? ""} ${row.snippet ?? ""} ${raw?.description ?? ""}`);
  if (/\b(incorporadora|construtora|empreendimentos imobiliarios)\b/.test(content)) return "developer";
  if (/\b(imobiliaria|imoveis ltda|negocios imobiliarios)\b/.test(content)) return "real_estate_agency";
  if (/\b(corretor|corretora|creci|consultor imobiliario|consultora imobiliaria)\b/.test(content)) return "broker";
  if (["business", "professional", "company", "loja", "dealer"].includes(sellerType)) return "broker";
  return null;
}

function advertiserClassification(row: Discovery): {
  classification: "probable_owner" | "individual_unconfirmed" | "not_identified";
  entityType: "person" | "unknown";
  confidence: number;
  evidence: string;
} {
  const raw = row.raw_payload ?? {};
  if (raw?.raw_quality?.official_api === true && raw?.raw_quality?.owner_signal === true) {
    return {
      classification: "probable_owner",
      entityType: "person",
      confidence: 85,
      evidence: "Explicit first-person owner signal accepted by the official Threads collector.",
    };
  }
  const sellerType = norm(raw?.seller_type ?? raw?.attributes?.seller_type);
  if (["private", "individual", "pessoa fisica", "person"].includes(sellerType)) {
    return {
      classification: "individual_unconfirmed",
      entityType: "person",
      confidence: 65,
      evidence: "Source identifies the advertiser as an individual/private seller; ownership is not yet confirmed.",
    };
  }
  return {
    classification: "not_identified",
    entityType: text(raw?.seller_nickname) ? "person" : "unknown",
    confidence: 50,
    evidence: "Advertiser identity is public in the source payload, but ownership is not confirmed.",
  };
}

function normalizePhone(value: unknown): { raw: string | null; normalized: string | null; ddd: string | null } {
  const raw = text(value);
  if (!raw) return { raw: null, normalized: null, ddd: null };
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) digits = digits.slice(2);
  if (digits.length !== 10 && digits.length !== 11) return { raw: null, normalized: null, ddd: null };
  const ddd = digits.slice(0, 2);
  if (!/^[1-9][0-9]$/.test(ddd)) return { raw: null, normalized: null, ddd: null };
  return { raw, normalized: `55${digits}`, ddd };
}

function safePublicUrl(value: unknown): boolean {
  try {
    const u = new URL(String(value ?? ""));
    if (!/^https?:$/.test(u.protocol) || u.username || u.password) return false;
    const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
    if (!h || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return false;
    if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.)/.test(h)) return false;
    const m = h.match(/^172\.(\d+)\./);
    if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return false;
    return true;
  } catch {
    return false;
  }
}

function quality(row: Discovery) {
  const raw = row.raw_payload ?? {};
  const q = raw?.raw_quality ?? {};
  const source = text(raw?.source_name) ?? text(row.metadata?.source_router?.source_name) ?? "unknown";
  const trustedPayload = q.official_api === true || (q.apify === true && q.task_normalized === true);
  if (!trustedPayload) return { promote: false, status: "prefiltered", reason: "untrusted_source_payload", source };
  if (!safePublicUrl(row.original_url)) return { promote: false, status: "rejected", reason: "unsafe_source_url", source };

  const publishedAt = iso(raw?.published_at ?? row.published_at);
  if (publishedAt && Date.parse(publishedAt) < Date.now() - MAX_AGE_DAYS * 86400000) {
    return { promote: false, status: "rejected", reason: "expired_over_365_days", source };
  }

  const propertyType = inferPropertyType(row);
  if (!propertyType || !RESIDENTIAL.has(propertyType)) {
    return { promote: false, status: "rejected", reason: "non_residential_or_unconfirmed_type", source, propertyType };
  }

  const professional = professionalClassification(row);
  if (professional) {
    return { promote: false, status: "rejected", reason: `professional_advertiser:${professional}`, source, propertyType };
  }

  const exactGeo = q.exact_city_or_zone === true;
  if (!exactGeo) {
    return { promote: false, status: "prefiltered", reason: "location_not_verified", source, propertyType };
  }

  if (!(q.official_api === true || (q.apify === true && source === "OLX Imóveis"))) {
    return { promote: false, status: "prefiltered", reason: "source_not_enabled_for_payload_promotion", source, propertyType };
  }

  return { promote: true, status: "accepted_for_enrichment", reason: "trusted_source_payload", source, propertyType };
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function writeNormalized(db: ReturnType<typeof createClient>, row: Discovery, propertyType: string) {
  const raw = row.raw_payload ?? {};
  const now = new Date().toISOString();
  const city = text(raw?.city) ?? text(row.detected_city);
  const neighborhood = text(raw?.neighborhood) ?? text(row.detected_neighborhood);
  const stateCode = (text(raw?.state_code) ?? text(row.detected_state_code) ?? "SP")?.toUpperCase() ?? "SP";
  const transaction = raw?.transaction_type === "rent" || row.detected_transaction === "rent" ? "rent" : "sale";
  const priceValue = finite(raw?.price ?? row.advertised_price);
  const price = priceValue !== null && priceValue >= 0 ? priceValue : null;
  const publishedAt = iso(raw?.published_at ?? row.published_at);
  const postalCode = text(raw?.postal_code ?? raw?.attributes?.postal_code);
  const area = finite(raw?.area_m2);
  const bedrooms = smallInt(raw?.bedrooms);
  const bathrooms = smallInt(raw?.bathrooms);
  const parking = smallInt(raw?.parking_spaces);
  const mainImage = safePublicUrl(raw?.main_image_url) ? text(raw?.main_image_url) : null;
  const sourceItemId = text(raw?.source_item_id);
  const sellerName = text(raw?.seller_nickname);
  const advertiser = advertiserClassification(row);
  const phone = normalizePhone(raw?.attributes?.phone);
  const whatsappRaw = text(raw?.attributes?.whatsapp);
  const whatsappStatus = whatsappRaw ? "probable" : phone.normalized ? "not_confirmed" : "not_found";

  const { data: existingListing } = await db
    .from("lj_v2_listings")
    .select("id,property_id,raw_data")
    .eq("original_url", row.original_url)
    .limit(1)
    .maybeSingle();

  let propertyId = existingListing?.property_id ?? null;
  const propertyPayload: Json = {
    property_type: propertyType,
    country_code: "BR",
    state_code: stateCode,
    city,
    neighborhood,
    postal_code: postalCode,
    area_m2: area,
    bedrooms,
    bathrooms,
    parking_spaces: parking,
    main_image_url: mainImage,
    current_status: "active",
    last_seen_at: now,
    metadata: {
      source_router_payload: {
        function: FUNCTION_NAME,
        version: VERSION,
        discovery_id: row.id,
        source_name: raw?.source_name ?? null,
        external_fetch: false,
        updated_at: now,
      },
    },
  };

  if (propertyId) {
    const { error } = await db.from("lj_v2_properties").update(propertyPayload).eq("id", propertyId);
    if (error) throw new Error(`property_update_failed:${error.message}`);
  } else {
    const { data, error } = await db.from("lj_v2_properties").insert(propertyPayload).select("id").single();
    if (error || !data?.id) throw new Error(`property_insert_failed:${error?.message ?? "missing_id"}`);
    propertyId = data.id;
  }

  const listingPayload: Json = {
    property_id: propertyId,
    source_id: row.source_id,
    external_listing_id: sourceItemId,
    original_url: row.original_url,
    title: text(raw?.title) ?? row.title,
    description: text(raw?.description) ?? row.snippet,
    transaction_type: transaction,
    price,
    advertised_city: city,
    advertised_neighborhood: neighborhood,
    advertiser_name: sellerName,
    published_at: publishedAt,
    last_seen_at: now,
    listing_status: "active",
    raw_data: {
      ...(existingListing?.raw_data && typeof existingListing.raw_data === "object" ? existingListing.raw_data : {}),
      source_router_payload: {
        function: FUNCTION_NAME,
        version: VERSION,
        discovery_id: row.id,
        source_name: raw?.source_name ?? null,
        source_item_id: sourceItemId,
        provider: raw?.raw_quality?.apify === true ? "apify" : "official_api",
        external_fetch: false,
        updated_at: now,
      },
    },
  };

  let listingId = existingListing?.id ?? null;
  if (listingId) {
    const { error } = await db.from("lj_v2_listings").update(listingPayload).eq("id", listingId);
    if (error) throw new Error(`listing_update_failed:${error.message}`);
  } else {
    const { data, error } = await db.from("lj_v2_listings").insert(listingPayload).select("id").single();
    if (error || !data?.id) throw new Error(`listing_insert_failed:${error?.message ?? "missing_id"}`);
    listingId = data.id;
  }

  let contactId: string | null = null;
  if (sellerName || phone.normalized) {
    const { data: relation } = await db
      .from("lj_v2_listing_contacts")
      .select("contact_id")
      .eq("listing_id", listingId)
      .eq("relationship_type", "advertiser")
      .eq("is_primary", true)
      .limit(1)
      .maybeSingle();
    contactId = relation?.contact_id ?? null;

    const contactPayload: Json = {
      display_name: sellerName,
      entity_type: advertiser.entityType,
      advertiser_classification: advertiser.classification,
      phone_raw: phone.raw,
      phone_normalized: phone.normalized,
      ddd: phone.ddd,
      whatsapp_status: whatsappStatus,
      whatsapp_evidence: whatsappRaw ? "WhatsApp signal supplied by the source payload; number-link match not independently re-fetched." : null,
      contact_evidence: advertiser.evidence,
      public_profile_url: row.original_url,
      discovered_source_id: row.source_id,
      last_seen_at: now,
      metadata: {
        source_router_payload: {
          function: FUNCTION_NAME,
          version: VERSION,
          discovery_id: row.id,
          external_fetch: false,
          updated_at: now,
        },
      },
    };

    if (contactId) {
      const { error } = await db.from("lj_v2_contacts").update(contactPayload).eq("id", contactId);
      if (error) throw new Error(`contact_update_failed:${error.message}`);
    } else {
      const { data, error } = await db.from("lj_v2_contacts").insert(contactPayload).select("id").single();
      if (error || !data?.id) throw new Error(`contact_insert_failed:${error?.message ?? "missing_id"}`);
      contactId = data.id;
      const { error: relError } = await db.from("lj_v2_listing_contacts").insert({
        listing_id: listingId,
        contact_id: contactId,
        relationship_type: "advertiser",
        is_primary: true,
        confidence_score: advertiser.confidence,
        evidence: advertiser.evidence,
      });
      if (relError) throw new Error(`listing_contact_insert_failed:${relError.message}`);
    }
  }

  return {
    propertyId,
    listingId,
    contactId,
    advertiser,
    facts: { city, neighborhood, stateCode, transaction, price, publishedAt, area, bedrooms, bathrooms, parking, postalCode },
  };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return reply({ ok: false, error: "method_not_allowed" }, 405);
  const body = await req.json().catch(() => ({})) as Json;
  const action = body?.action === "process" ? "process" : "health";

  if (action === "health") {
    return reply({
      ok: true,
      function: FUNCTION_NAME,
      version: VERSION,
      external_fetch: false,
      accepted_payloads: ["threads_official_api", "olx_apify"],
      social_apify_promotion: "paused_until_geo_validation",
      professional_advertisers_promoted: false,
      max_age_days: MAX_AGE_DAYS,
      named_secret_available: Boolean(namedSecret()),
    });
  }

  if (!authorized(req)) return reply({ ok: false, error: "authentication_failed" }, 401);
  const db = adminClient();
  if (!db) return reply({ ok: false, error: "admin_client_unavailable" }, 500);

  const ids = Array.isArray(body?.discovery_ids)
    ? [...new Set(body.discovery_ids.filter((v: unknown) => typeof v === "string" && v.length >= 20))].slice(0, MAX_BATCH)
    : [];
  if (ids.length === 0) return reply({ ok: true, status: "nothing_to_process", selected: 0, processed: 0, promoted: 0, rejected: 0, results: [] });

  const { data, error } = await db
    .from("lj_v2_raw_discoveries")
    .select("id,source_id,original_url,title,snippet,advertised_price,detected_state_code,detected_city,detected_neighborhood,detected_transaction,detected_property_type,advertiser_hint,published_at,raw_payload,metadata")
    .in("id", ids);
  if (error) return reply({ ok: false, error: `discovery_load_failed:${error.message}` }, 500);

  let promoted = 0;
  let rejected = 0;
  let prefiltered = 0;
  let errors = 0;
  const results: Json[] = [];

  for (const row of (data ?? []) as Discovery[]) {
    const gate = quality(row);
    if (!gate.promote) {
      const nextMetadata = {
        ...(row.metadata ?? {}),
        enrichment: {
          function: FUNCTION_NAME,
          version: VERSION,
          completed_at: new Date().toISOString(),
          pipeline_outcome: "not_promoted",
          rejection_reason: gate.reason,
          source_name: gate.source,
          external_fetch: false,
          retryable: false,
        },
      };
      const { error: updateError } = await db.from("lj_v2_raw_discoveries").update({
        discovery_status: gate.status,
        metadata: nextMetadata,
      }).eq("id", row.id);
      if (updateError) errors += 1;
      if (gate.status === "rejected") rejected += 1;
      else prefiltered += 1;
      results.push({ discovery_id: row.id, ok: !updateError, pipeline_outcome: "not_promoted", reason: gate.reason, source: gate.source });
      continue;
    }

    try {
      const normalized = await writeNormalized(db, row, gate.propertyType!);
      const nextMetadata = {
        ...(row.metadata ?? {}),
        enrichment: {
          function: FUNCTION_NAME,
          version: VERSION,
          completed_at: new Date().toISOString(),
          pipeline_outcome: "promoted",
          promotion_reason: gate.reason,
          listing_id: normalized.listingId,
          property_id: normalized.propertyId,
          contact_id: normalized.contactId,
          advertiser_classification: normalized.advertiser.classification,
          source_name: gate.source,
          external_fetch: false,
          retryable: false,
          ...normalized.facts,
        },
      };
      const { error: updateError } = await db.from("lj_v2_raw_discoveries").update({
        discovery_status: "accepted_for_enrichment",
        advertised_price: normalized.facts.price,
        detected_city: normalized.facts.city,
        detected_neighborhood: normalized.facts.neighborhood,
        detected_transaction: normalized.facts.transaction,
        detected_property_type: gate.propertyType,
        published_at: normalized.facts.publishedAt,
        metadata: nextMetadata,
      }).eq("id", row.id);
      if (updateError) throw new Error(`discovery_update_failed:${updateError.message}`);
      promoted += 1;
      results.push({
        discovery_id: row.id,
        ok: true,
        pipeline_outcome: "promoted",
        source: gate.source,
        listing_id: normalized.listingId,
        property_id: normalized.propertyId,
        contact_id: normalized.contactId,
        advertiser_classification: normalized.advertiser.classification,
      });
    } catch (error) {
      errors += 1;
      results.push({ discovery_id: row.id, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return reply({
    ok: errors === 0,
    function: FUNCTION_NAME,
    version: VERSION,
    status: errors === 0 ? "completed" : promoted > 0 ? "partial" : "failed",
    selected: data?.length ?? 0,
    processed: (data?.length ?? 0),
    promoted,
    rejected,
    prefiltered,
    errors,
    external_fetch: false,
    results,
  }, errors > 0 && promoted === 0 ? 500 : 200);
});

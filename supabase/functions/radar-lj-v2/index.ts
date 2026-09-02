// ============================================================
// RADAR LJ V2 - MODULES 5/6 ORCHESTRATOR + ACTIONABLE LEADS
// Function: radar-lj-v2
// Version: 1.1.1
//
// Pipeline:
// coletor-lj-v2 -> enriquecedor-lj-v2 -> verificador-quinto-lj
// -> public.oportunidades_lj
//
// V1 IS NOT MODIFIED.
// ============================================================

declare const Deno: any;
declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void;
};

type TransactionType = "sale" | "rent";
type JsonRecord = Record<string, unknown>;

type RadarRequest = {
  action?: "health" | "run";
  wait?: boolean;
  state_code?: string;
  state?: string;
  uf?: string;
  city?: string;
  cidade?: string;
  transaction_type?: TransactionType;
  transaction?: TransactionType;
  property_type_code?: string | null;
  property_type?: string | null;
  type?: string | null;
  query_limit?: number;
  results_per_query?: number;
  max_discoveries?: number;
  max_verifications?: number;
  include_details?: boolean;
  refresh_opportunities?: boolean;
};

type RuntimeSecrets = {
  supabaseUrl: string;
  internalKey: string;
  serviceRoleKey: string;
};

type RunDiscovery = {
  id: string;
  original_url: string | null;
  discovery_status: string | null;
  metadata: JsonRecord | null;
  result_position: number;
  was_new: boolean;
};

type PromotedResult = {
  discovery_id?: string;
  listing_id?: string;
  property_id?: string;
  source?: string | null;
  title?: string | null;
  advertiser_classification?: string | null;
  phone_found?: boolean;
  phone_trusted?: boolean;
  whatsapp_status?: string | null;
  listing_status?: string | null;
  pipeline_outcome?: string | null;
  [key: string]: unknown;
};

type VerificationCandidate = {
  listing_id: string;
  property_id: string | null;
  title: string | null;
  description: string | null;
  city: string;
  neighborhood: string | null;
  address: string | null;
  postal_code: string | null;
  condominium_name: string | null;
  detected_type: string | null;
  transaction_type: TransactionType;
  price: number | null;
  area_m2: number | null;
  bedrooms: number | null;
  suites: number | null;
  bathrooms: number | null;
  parking_spaces: number | null;
  link: string;
  source: string;
  advertiser_name: string | null;
  advertiser_classification: string | null;
  contact_id: string | null;
  phone_raw: string | null;
  phone_normalized: string | null;
  contact_confidence: number | null;
  phone_found: boolean;
  phone_trusted: boolean;
  whatsapp_status: string | null;
  listing_status: string | null;
  published_at: string | null;
};

const FUNCTION_NAME = "radar-lj-v2";
const FUNCTION_VERSION = "1.1.1";
const COLLECTOR_FUNCTION = "coletor-lj-v2";
const ENRICHER_FUNCTION = "enriquecedor-lj-v2";
const VERIFIER_FUNCTION = "verificador-quinto-lj";
const OPPORTUNITIES_TABLE = "oportunidades_lj";
const NAMED_SECRET_KEY = "radar_lj_v2_collector";

const MINIMUM_RENT = 1_000;
const MINIMUM_SALE = 200_000;
const SALE_COMMISSION_RATE = 0.0125;
const ENRICHER_BATCH_SIZE = 20;
const VERIFIER_BATCH_SIZE = 3;
const INCONCLUSIVE_RECHECK_DAYS = 7;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function textOrNull(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function clampInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(parsed)));
}

function normalizeState(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function getRuntimeSecrets(): RuntimeSecrets {
  const supabaseUrl = String(Deno.env.get("SUPABASE_URL") ?? "")
    .trim()
    .replace(/\/+$/, "");
  const serviceRoleKey = String(
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  ).trim();

  let namedSecret = "";
  try {
    const parsed = JSON.parse(
      String(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"),
    ) as JsonRecord;
    namedSecret = textOrNull(parsed[NAMED_SECRET_KEY]) ?? "";
  } catch {
    namedSecret = "";
  }

  return {
    supabaseUrl,
    internalKey: namedSecret,
    serviceRoleKey: serviceRoleKey || namedSecret,
  };
}

function requestCredential(req: Request): string {
  const apiKey = String(req.headers.get("apikey") ?? "").trim();
  if (apiKey) return apiKey;

  const authorization = String(
    req.headers.get("authorization") ?? "",
  ).trim();
  if (authorization.toLowerCase().startsWith("bearer ")) {
    return authorization.slice(7).trim();
  }

  return "";
}

function isAuthorized(req: Request, secrets: RuntimeSecrets): boolean {
  const credential = requestCredential(req);
  if (!credential) return false;

  return Boolean(
    (secrets.internalKey && credential === secrets.internalKey) ||
      (secrets.serviceRoleKey && credential === secrets.serviceRoleKey),
  );
}

function requireRuntime(secrets: RuntimeSecrets): void {
  if (!secrets.supabaseUrl) {
    throw new Error("SUPABASE_URL not found");
  }
  if (!secrets.internalKey) {
    throw new Error(
      `Named secret ${NAMED_SECRET_KEY} is not available`,
    );
  }
  if (!secrets.serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY not found");
  }
}

function internalHeaders(
  key: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function callEdgeFunction(
  secrets: RuntimeSecrets,
  functionName: string,
  payload: unknown,
): Promise<JsonRecord> {
  const response = await fetch(
    `${secrets.supabaseUrl}/functions/v1/${functionName}`,
    {
      method: "POST",
      headers: internalHeaders(secrets.internalKey),
      body: JSON.stringify(payload),
    },
  );

  const data = await response.json().catch(() => ({})) as JsonRecord;
  if (!response.ok) {
    throw new Error(
      `${functionName} HTTP ${response.status}: ${
        textOrNull(data.error) ?? JSON.stringify(data)
      }`,
    );
  }

  return data;
}

async function restGet(
  secrets: RuntimeSecrets,
  table: string,
  parameters: URLSearchParams,
): Promise<JsonRecord[]> {
  const response = await fetch(
    `${secrets.supabaseUrl}/rest/v1/${table}?${parameters.toString()}`,
    {
      method: "GET",
      headers: internalHeaders(secrets.serviceRoleKey),
    },
  );

  const data = await response.json().catch(() => ([]));
  if (!response.ok) {
    throw new Error(
      `${table} read HTTP ${response.status}: ${JSON.stringify(data)}`,
    );
  }

  return Array.isArray(data) ? data as JsonRecord[] : [];
}

async function restUpsert(
  secrets: RuntimeSecrets,
  table: string,
  onConflict: string,
  row: JsonRecord,
): Promise<JsonRecord[]> {
  const parameters = new URLSearchParams({ on_conflict: onConflict });
  const response = await fetch(
    `${secrets.supabaseUrl}/rest/v1/${table}?${parameters.toString()}`,
    {
      method: "POST",
      headers: internalHeaders(secrets.serviceRoleKey, {
        Prefer: "resolution=merge-duplicates,return=representation",
      }),
      body: JSON.stringify([row]),
    },
  );

  const data = await response.json().catch(() => ([]));
  if (!response.ok) {
    throw new Error(
      `${table} upsert HTTP ${response.status}: ${JSON.stringify(data)}`,
    );
  }

  return Array.isArray(data) ? data as JsonRecord[] : [];
}

function chunk<T>(items: T[], size: number): T[][] {
  const output: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    output.push(items.slice(index, index + size));
  }
  return output;
}

function completedEnrichment(metadata: JsonRecord | null): JsonRecord | null {
  const enrichment = asRecord(metadata?.enrichment);
  if (!enrichment) return null;
  if (!textOrNull(enrichment.completed_at)) return null;
  if (enrichment.retryable === true) return null;
  return enrichment;
}

function promotedFromMetadata(
  discovery: RunDiscovery,
): PromotedResult | null {
  const enrichment = completedEnrichment(discovery.metadata);
  if (!enrichment) return null;
  if (enrichment.pipeline_outcome !== "promoted") return null;

  const listingId = textOrNull(enrichment.listing_id);
  if (!listingId) return null;

  return {
    discovery_id: discovery.id,
    listing_id: listingId,
    property_id: textOrNull(enrichment.property_id) ?? undefined,
    advertiser_classification:
      textOrNull(enrichment.advertiser_classification),
    phone_found: booleanValue(enrichment.phone_found),
    phone_trusted: booleanValue(enrichment.phone_trusted),
    whatsapp_status: textOrNull(
      enrichment.effective_whatsapp_status ?? enrichment.whatsapp_status,
    ),
    pipeline_outcome: "promoted",
  };
}

async function loadRunDiscoveries(
  secrets: RuntimeSecrets,
  runId: string,
  maximum: number,
): Promise<RunDiscovery[]> {
  const relationParams = new URLSearchParams({
    select: "discovery_id,result_position,was_new",
    run_id: `eq.${runId}`,
    order: "result_position.asc",
    limit: String(maximum),
  });
  const relations = await restGet(
    secrets,
    "lj_v2_collector_run_discoveries",
    relationParams,
  );

  const ids = Array.from(
    new Set(
      relations
        .map((row) => textOrNull(row.discovery_id))
        .filter((id): id is string => Boolean(id)),
    ),
  );
  if (ids.length === 0) return [];

  const discoveryParams = new URLSearchParams({
    select: "id,original_url,discovery_status,metadata",
    id: `in.(${ids.join(",")})`,
    limit: String(ids.length),
  });
  const rows = await restGet(
    secrets,
    "lj_v2_raw_discoveries",
    discoveryParams,
  );
  const byId = new Map<string, JsonRecord>();
  for (const row of rows) {
    const id = textOrNull(row.id);
    if (id) byId.set(id, row);
  }

  return relations.flatMap((relation, index) => {
    const id = textOrNull(relation.discovery_id);
    const row = id ? byId.get(id) : null;
    if (!id || !row) return [];

    return [{
      id,
      original_url: textOrNull(row.original_url),
      discovery_status: textOrNull(row.discovery_status),
      metadata: asRecord(row.metadata),
      result_position:
        numberOrNull(relation.result_position) ?? index + 1,
      was_new: relation.was_new === true,
    } satisfies RunDiscovery];
  });
}

async function enrichDiscoveries(
  secrets: RuntimeSecrets,
  discoveries: RunDiscovery[],
): Promise<{
  promoted: PromotedResult[];
  responses: JsonRecord[];
  errors: JsonRecord[];
}> {
  const promoted: PromotedResult[] = [];
  const responses: JsonRecord[] = [];
  const errors: JsonRecord[] = [];

  const pendingIds: string[] = [];
  for (const discovery of discoveries) {
    const existing = promotedFromMetadata(discovery);
    if (existing) {
      promoted.push(existing);
      continue;
    }

    if (!completedEnrichment(discovery.metadata)) {
      pendingIds.push(discovery.id);
    }
  }

  for (const batch of chunk(pendingIds, ENRICHER_BATCH_SIZE)) {
    try {
      const response = await callEdgeFunction(
        secrets,
        ENRICHER_FUNCTION,
        {
          action: "enrich",
          discovery_ids: batch,
          latest_run_only: false,
          limit: batch.length,
        },
      );
      responses.push(response);

      const results = Array.isArray(response.results)
        ? response.results as JsonRecord[]
        : [];
      for (const result of results) {
        if (
          result.pipeline_outcome === "promoted" &&
          textOrNull(result.listing_id)
        ) {
          promoted.push(result as PromotedResult);
        }
      }
    } catch (error) {
      errors.push({
        discovery_ids: batch,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const unique = new Map<string, PromotedResult>();
  for (const result of promoted) {
    const listingId = textOrNull(result.listing_id);
    if (listingId && !unique.has(listingId)) unique.set(listingId, result);
  }

  return {
    promoted: Array.from(unique.values()),
    responses,
    errors,
  };
}

function sourceFromLink(link: string): string {
  try {
    return new URL(link).hostname.replace(/^www\./, "");
  } catch {
    return "Unknown";
  }
}

async function loadVerificationCandidate(
  secrets: RuntimeSecrets,
  promoted: PromotedResult,
): Promise<VerificationCandidate> {
  const listingId = textOrNull(promoted.listing_id);
  if (!listingId) throw new Error("missing_listing_id");

  const listingParams = new URLSearchParams({
    select:
      "id,property_id,source_id,original_url,title,description,transaction_type,price,advertised_city,advertised_neighborhood,advertised_address,advertiser_name,listing_status,published_at",
    id: `eq.${listingId}`,
    limit: "1",
  });
  const listings = await restGet(
    secrets,
    "lj_v2_listings",
    listingParams,
  );
  const listing = listings[0];
  if (!listing) throw new Error(`listing_not_found:${listingId}`);

  const propertyId =
    textOrNull(promoted.property_id) ?? textOrNull(listing.property_id);
  let property: JsonRecord = {};
  if (propertyId) {
    const propertyParams = new URLSearchParams({
      select:
        "id,property_type,state_code,city,neighborhood,street,street_number,canonical_address,postal_code,condominium_name,area_m2,bedrooms,suites,bathrooms,parking_spaces,current_status",
      id: `eq.${propertyId}`,
      limit: "1",
    });
    property = (await restGet(
      secrets,
      "lj_v2_properties",
      propertyParams,
    ))[0] ?? {};
  }

  let source = textOrNull(promoted.source);
  const sourceId = textOrNull(listing.source_id);
  if (!source && sourceId) {
    const sourceParams = new URLSearchParams({
      select: "name,domain",
      id: `eq.${sourceId}`,
      limit: "1",
    });
    const sourceRow = (await restGet(
      secrets,
      "lj_v2_sources",
      sourceParams,
    ))[0] ?? {};
    source = textOrNull(sourceRow.name) ?? textOrNull(sourceRow.domain);
  }

  let relation: JsonRecord = {};
  const relationParams = new URLSearchParams({
    select: "contact_id,confidence_score,evidence,is_primary",
    listing_id: `eq.${listingId}`,
    relationship_type: "eq.advertiser",
    order: "is_primary.desc,confidence_score.desc",
    limit: "1",
  });
  relation = (await restGet(
    secrets,
    "lj_v2_listing_contacts",
    relationParams,
  ))[0] ?? {};

  const contactId = textOrNull(relation.contact_id);
  let contact: JsonRecord = {};
  if (contactId) {
    const contactParams = new URLSearchParams({
      select:
        "id,display_name,advertiser_classification,phone_raw,phone_normalized,whatsapp_status,last_seen_at",
      id: `eq.${contactId}`,
      limit: "1",
    });
    contact = (await restGet(
      secrets,
      "lj_v2_contacts",
      contactParams,
    ))[0] ?? {};
  }

  const link = textOrNull(listing.original_url);
  const city = textOrNull(property.city) ??
    textOrNull(listing.advertised_city);
  const transaction = textOrNull(listing.transaction_type);

  if (!link) throw new Error(`missing_listing_link:${listingId}`);
  if (!city) throw new Error(`missing_candidate_city:${listingId}`);
  if (transaction !== "sale" && transaction !== "rent") {
    throw new Error(`invalid_transaction_type:${listingId}`);
  }

  return {
    listing_id: listingId,
    property_id: propertyId,
    title: textOrNull(listing.title) ?? textOrNull(promoted.title),
    description: textOrNull(listing.description),
    city,
    neighborhood: textOrNull(property.neighborhood) ??
      textOrNull(listing.advertised_neighborhood),
    address: textOrNull(property.canonical_address) ??
      textOrNull(listing.advertised_address),
    postal_code: textOrNull(property.postal_code),
    condominium_name: textOrNull(property.condominium_name),
    detected_type: textOrNull(property.property_type),
    transaction_type: transaction,
    price: numberOrNull(listing.price),
    area_m2: numberOrNull(property.area_m2),
    bedrooms: numberOrNull(property.bedrooms),
    suites: numberOrNull(property.suites),
    bathrooms: numberOrNull(property.bathrooms),
    parking_spaces: numberOrNull(property.parking_spaces),
    link,
    source: source ?? sourceFromLink(link),
    advertiser_name: textOrNull(listing.advertiser_name) ??
      textOrNull(contact.display_name),
    advertiser_classification:
      textOrNull(promoted.advertiser_classification) ??
      textOrNull(contact.advertiser_classification),
    contact_id: contactId,
    phone_raw: textOrNull(contact.phone_raw),
    phone_normalized: textOrNull(contact.phone_normalized),
    contact_confidence: numberOrNull(relation.confidence_score),
    phone_found: Boolean(textOrNull(contact.phone_raw)) ||
      booleanValue(promoted.phone_found),
    // The enricher removes phone_normalized when advertiser identity conflicts.
    // A stored normalized phone is therefore the authoritative trust signal.
    phone_trusted: Boolean(textOrNull(contact.phone_normalized)),
    whatsapp_status: textOrNull(contact.whatsapp_status) ??
      textOrNull(promoted.whatsapp_status),
    listing_status: textOrNull(promoted.listing_status) ??
      textOrNull(listing.listing_status),
    published_at: textOrNull(listing.published_at),
  };
}

function ownerConfidence(candidate: VerificationCandidate): number {
  let score = candidate.advertiser_classification === "confirmed_owner"
    ? 90
    : candidate.advertiser_classification === "probable_owner"
    ? 80
    : 65;

  if (candidate.phone_trusted) score += 5;
  if (candidate.whatsapp_status === "confirmed") score += 5;
  return Math.min(100, score);
}

function opportunityScore(candidate: VerificationCandidate): number {
  let score = 45;
  if (candidate.advertiser_classification === "confirmed_owner") score += 15;
  else if (candidate.advertiser_classification === "probable_owner") score += 10;
  if (candidate.phone_trusted) score += 15;
  else if (candidate.phone_found) score += 5;
  if (candidate.whatsapp_status === "confirmed") score += 10;
  else if (candidate.whatsapp_status === "probable") score += 5;
  if (candidate.address) score += 5;
  if (candidate.listing_status === "active") score += 5;
  if (candidate.price !== null) score += 5;
  return Math.min(100, score);
}

function estimatedSaleCommission(candidate: VerificationCandidate): number | null {
  if (candidate.transaction_type !== "sale" || candidate.price === null) {
    return null;
  }
  return Math.round(candidate.price * SALE_COMMISSION_RATE * 100) / 100;
}

type LeadClassificationCode =
  | "fire_green"
  | "green"
  | "yellow"
  | "red";

function whatsappLink(candidate: VerificationCandidate): string | null {
  if (!candidate.phone_trusted || !candidate.phone_normalized) return null;

  let digits = candidate.phone_normalized.replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;

  // Brazilian mobile numbers have country code + DDD + nine-digit number.
  // A landline remains available as a phone but does not receive a wa.me link.
  if (digits.length !== 13 || !digits.startsWith("55") || digits[4] !== "9") {
    return null;
  }
  return `https://wa.me/${digits}`;
}

function leadClassification(
  candidate: VerificationCandidate,
  verification: JsonRecord,
  commercialScore: number,
): { code: LeadClassificationCode; label: string } {
  const qaConfidence = numberOrNull(verification.confidence) ?? 0;
  const confirmedOwner =
    candidate.advertiser_classification === "confirmed_owner";
  const ownerCandidate = confirmedOwner ||
    candidate.advertiser_classification === "probable_owner";
  const active = candidate.listing_status === "active";

  if (
    confirmedOwner && candidate.phone_trusted && active && qaConfidence >= 75
  ) {
    return { code: "fire_green", label: "🔥 VERDE" };
  }
  if (ownerCandidate && active && (candidate.phone_trusted || commercialScore >= 80)) {
    return { code: "green", label: "VERDE" };
  }
  if (commercialScore >= 55) {
    return { code: "yellow", label: "AMARELO" };
  }
  return { code: "red", label: "VERMELHO" };
}

function recommendedAction(
  classification: LeadClassificationCode,
  candidate: VerificationCandidate,
): string {
  if (classification === "fire_green") {
    return whatsappLink(candidate)
      ? "Abordar o proprietário agora pelo WhatsApp."
      : "Telefonar para o proprietário agora.";
  }
  if (classification === "green") {
    return candidate.phone_trusted
      ? "Contatar o proprietário ainda hoje."
      : "Confirmar o contato e abordar ainda hoje.";
  }
  if (classification === "yellow") {
    return "Confirmar proprietário e contato antes da abordagem.";
  }
  return "Fazer revisão manual antes de tentar contato.";
}

function opportunityDiagnostic(
  candidate: VerificationCandidate,
  verification: JsonRecord,
): string {
  const confirmed: string[] = [];
  const missing: string[] = [];

  if (candidate.advertiser_classification === "confirmed_owner") {
    confirmed.push("proprietário confirmado");
  } else if (candidate.advertiser_classification === "probable_owner") {
    confirmed.push("provável proprietário");
  } else {
    missing.push("confirmar proprietário");
  }
  if (candidate.phone_trusted) confirmed.push("telefone público confiável");
  else missing.push("confirmar telefone");
  if (candidate.listing_status === "active") confirmed.push("anúncio ativo");
  else missing.push("confirmar anúncio ativo");
  if (candidate.address) confirmed.push("endereço disponível");
  else missing.push("completar endereço");

  const qaConfidence = numberOrNull(verification.confidence);
  const qa = qaConfidence === null
    ? "sem correspondência pública suficiente no QuintoAndar"
    : `sem correspondência pública suficiente no QuintoAndar (${qaConfidence}% de confiança)`;
  const confirmedText = confirmed.length > 0
    ? `Confirmado: ${confirmed.join(", ")}.`
    : "Nenhum sinal comercial principal confirmado.";
  const missingText = missing.length > 0
    ? ` Falta: ${missing.join(", ")}.`
    : "";
  return `${confirmedText} QA: ${qa}.${missingText}`;
}

async function saveApprovedOpportunity(
  secrets: RuntimeSecrets,
  candidate: VerificationCandidate,
  verification: JsonRecord,
  refreshExisting = false,
): Promise<JsonRecord> {
  if (!candidate.title) {
    throw new Error(`missing_listing_title:${candidate.listing_id}`);
  }

  const confidenceScore = ownerConfidence(candidate);
  const commercialScore = opportunityScore(candidate);
  const classification = leadClassification(
    candidate,
    verification,
    commercialScore,
  );
  const action = recommendedAction(classification.code, candidate);
  const diagnostic = opportunityDiagnostic(candidate, verification);
  const whatsapp = whatsappLink(candidate);
  const alertLevel = classification.code === "fire_green"
    ? "hot"
    : classification.code === "green"
    ? "opportunity"
    : classification.code === "yellow"
    ? "watch"
    : "review";
  const commission = estimatedSaleCommission(candidate);

  const record: JsonRecord = {
    listing_id: candidate.listing_id,
    property_id: candidate.property_id,
    contact_id: candidate.contact_id,
    title: candidate.title,
    link: candidate.link,
    source: candidate.source,
    city: candidate.city,
    neighborhood: candidate.neighborhood,
    address: candidate.address,
    property_type: candidate.detected_type,
    transaction: candidate.transaction_type,
    price: candidate.price,
    area_m2: candidate.area_m2,
    bedrooms: candidate.bedrooms,
    parking_spaces: candidate.parking_spaces,
    direct_owner:
      candidate.advertiser_classification === "confirmed_owner" ||
      candidate.advertiser_classification === "probable_owner",
    advertiser_name: candidate.advertiser_name,
    advertiser_classification: candidate.advertiser_classification,
    phone: candidate.phone_trusted ? candidate.phone_raw : null,
    phone_normalized:
      candidate.phone_trusted ? candidate.phone_normalized : null,
    whatsapp_link: whatsapp,
    whatsapp_status: candidate.whatsapp_status,
    contact_confidence: candidate.contact_confidence,
    individual_listing: true,
    confidence_score: confidenceScore,
    opportunity_score: commercialScore,
    premium_score: 0,
    alert_level: alertLevel,
    priority:
      classification.code === "fire_green" || classification.code === "green",
    classification: classification.code,
    classification_label: classification.label,
    quinto_status: verification.status,
    quinto_confidence: numberOrNull(verification.confidence),
    approved_for_pipeline: true,
    recommended_action: action,
    diagnostic,
    estimated_sale_commission: commission,
    sale_commission_rate: candidate.transaction_type === "sale"
      ? SALE_COMMISSION_RATE
      : null,
    published_at: candidate.published_at,
    ...(refreshExisting ? {} : { captured_at: new Date().toISOString() }),
    updated_at: new Date().toISOString(),
    description: candidate.description,
    ...(refreshExisting ? {} : { status: "new" }),
  };

  const rows = await restUpsert(
    secrets,
    OPPORTUNITIES_TABLE,
    "link",
    record,
  );

  return {
    ...record,
    database_row: rows[0] ?? null,
  };
}

async function verifyAndPromote(
  secrets: RuntimeSecrets,
  promotedResults: PromotedResult[],
  maximum: number,
  refreshOpportunities = false,
): Promise<{
  results: JsonRecord[];
  saved: JsonRecord[];
  deferred: PromotedResult[];
  historySkipped: JsonRecord[];
  counters: JsonRecord;
}> {
  const listingIds = Array.from(
    new Set(
      promotedResults
        .map((item) => textOrNull(item.listing_id))
        .filter((id): id is string => Boolean(id)),
    ),
  );

  const historyByListing = new Map<string, JsonRecord>();
  if (listingIds.length > 0) {
    const historyParams = new URLSearchParams({
      select:
        "listing_id,status,approved_for_pipeline,confidence,checked_at",
      listing_id: `in.(${listingIds.join(",")})`,
      limit: String(listingIds.length),
    });
    const historyRows = await restGet(
      secrets,
      "lj_v2_quinto_checks",
      historyParams,
    );
    for (const row of historyRows) {
      const listingId = textOrNull(row.listing_id);
      if (listingId) historyByListing.set(listingId, row);
    }
  }

  const neverChecked: PromotedResult[] = [];
  const eligibleRechecks: PromotedResult[] = [];
  const approvedHistoryRefresh: Array<{
    promoted: PromotedResult;
    verification: JsonRecord;
  }> = [];
  const historySkipped: JsonRecord[] = [];
  const now = Date.now();
  const recheckAfterMs = INCONCLUSIVE_RECHECK_DAYS * 24 * 60 * 60 * 1000;

  for (const promoted of promotedResults) {
    const listingId = textOrNull(promoted.listing_id);
    const history = listingId ? historyByListing.get(listingId) : null;

    if (!listingId || !history) {
      neverChecked.push(promoted);
      continue;
    }

    const status = textOrNull(history.status);
    if (
      status === "found_on_quintoandar" ||
      status === "no_public_match_found"
    ) {
      if (
        refreshOpportunities &&
        status === "no_public_match_found" &&
        history.approved_for_pipeline === true
      ) {
        approvedHistoryRefresh.push({
          promoted,
          verification: history,
        });
      }
      historySkipped.push({
        listing_id: listingId,
        status,
        reason: "terminal_verification_already_recorded",
        checked_at: history.checked_at ?? null,
      });
      continue;
    }

    if (status === "inconclusive") {
      const checkedAt = Date.parse(String(history.checked_at ?? ""));
      const isRecent = Number.isFinite(checkedAt) &&
        now - checkedAt < recheckAfterMs;

      if (isRecent) {
        historySkipped.push({
          listing_id: listingId,
          status,
          reason: "inconclusive_recheck_cooldown",
          checked_at: history.checked_at ?? null,
          recheck_after_days: INCONCLUSIVE_RECHECK_DAYS,
        });
        continue;
      }
    }

    eligibleRechecks.push(promoted);
  }

  // New candidates always consume verifier capacity before old investigations.
  // This prevents the same checked listings from permanently starving the
  // candidates deferred by a previous run limit.
  const eligible = [...neverChecked, ...eligibleRechecks];
  const selected = eligible.slice(0, maximum);
  const deferred = eligible.slice(maximum);
  const results: JsonRecord[] = [];
  const saved: JsonRecord[] = [];
  let verified = 0;
  let foundOnQuinto = 0;
  let inconclusive = 0;
  let noPublicMatch = 0;
  let opportunitiesSaved = 0;
  let opportunitiesRefreshed = 0;
  let errors = 0;

  for (const batch of chunk(selected, VERIFIER_BATCH_SIZE)) {
    const settled = await Promise.allSettled(
      batch.map(async (promoted) => {
        const candidate = await loadVerificationCandidate(secrets, promoted);
        const verification = await callEdgeFunction(
          secrets,
          VERIFIER_FUNCTION,
          {
            action: "verify",
            candidate,
          },
        );

        let opportunity: JsonRecord | null = null;
        if (
          verification.status === "no_public_match_found" &&
          verification.approved_for_pipeline === true
        ) {
          opportunity = await saveApprovedOpportunity(
            secrets,
            candidate,
            verification,
          );
        }

        return { candidate, verification, opportunity };
      }),
    );

    for (const item of settled) {
      if (item.status === "rejected") {
        errors += 1;
        results.push({
          ok: false,
          stage: "verification_or_promotion",
          error: item.reason instanceof Error
            ? item.reason.message
            : String(item.reason),
        });
        continue;
      }

      verified += 1;
      const status = textOrNull(item.value.verification.status);
      if (status === "found_on_quintoandar") foundOnQuinto += 1;
      else if (status === "inconclusive") inconclusive += 1;
      else if (status === "no_public_match_found") noPublicMatch += 1;

      if (item.value.opportunity) {
        saved.push(item.value.opportunity);
        opportunitiesSaved += 1;
      }
      results.push({
        ok: true,
        listing_id: item.value.candidate.listing_id,
        property_id: item.value.candidate.property_id,
        title: item.value.candidate.title,
        source: item.value.candidate.source,
        status,
        approved_for_pipeline:
          item.value.verification.approved_for_pipeline === true,
        confidence: item.value.verification.confidence ?? null,
        estimated_sale_commission:
          estimatedSaleCommission(item.value.candidate),
        database_write: item.value.verification.database_write ?? null,
        opportunity_saved: Boolean(item.value.opportunity),
      });
    }
  }

  if (refreshOpportunities) {
    for (const batch of chunk(approvedHistoryRefresh, VERIFIER_BATCH_SIZE)) {
      const settled = await Promise.allSettled(
        batch.map(async ({ promoted, verification }) => {
          const candidate = await loadVerificationCandidate(secrets, promoted);
          const opportunity = await saveApprovedOpportunity(
            secrets,
            candidate,
            verification,
            true,
          );
          return { candidate, verification, opportunity };
        }),
      );

      for (const item of settled) {
        if (item.status === "rejected") {
          errors += 1;
          results.push({
            ok: false,
            stage: "opportunity_history_refresh",
            error: item.reason instanceof Error
              ? item.reason.message
              : String(item.reason),
          });
          continue;
        }

        opportunitiesRefreshed += 1;
        saved.push(item.value.opportunity);
        results.push({
          ok: true,
          stage: "opportunity_history_refresh",
          listing_id: item.value.candidate.listing_id,
          property_id: item.value.candidate.property_id,
          title: item.value.candidate.title,
          source: item.value.candidate.source,
          status: item.value.verification.status,
          approved_for_pipeline: true,
          confidence: item.value.verification.confidence ?? null,
          classification: item.value.opportunity.classification ?? null,
          opportunity_refreshed: true,
        });
      }
    }
  }

  return {
    results,
    saved,
    deferred,
    historySkipped,
    counters: {
      candidates_received: promotedResults.length,
      candidates_never_checked: neverChecked.length,
      candidates_eligible_rechecks: eligibleRechecks.length,
      candidates_approved_history_refresh: approvedHistoryRefresh.length,
      candidates_selected: selected.length,
      candidates_deferred: deferred.length,
      candidates_history_skipped: historySkipped.length,
      verified,
      found_on_quintoandar: foundOnQuinto,
      inconclusive,
      no_public_match_found: noPublicMatch,
      opportunities_saved: opportunitiesSaved,
      opportunities_refreshed: opportunitiesRefreshed,
      errors,
    },
  };
}

async function processRadar(
  body: RadarRequest,
  requestId: string,
): Promise<JsonRecord> {
  const secrets = getRuntimeSecrets();
  requireRuntime(secrets);

  const stateCode = normalizeState(body.state_code ?? body.state ?? body.uf);
  const city = textOrNull(body.city ?? body.cidade);
  const transaction = body.transaction_type ?? body.transaction;
  const propertyType = textOrNull(
    body.property_type_code ?? body.property_type ?? body.type,
  );

  if (stateCode.length !== 2 || !city) {
    throw new Error("state_code and city are required");
  }
  if (transaction !== "sale" && transaction !== "rent") {
    throw new Error("transaction_type must be sale or rent");
  }

  const queryLimit = clampInteger(body.query_limit, 5, 1, 20);
  const resultsPerQuery = clampInteger(body.results_per_query, 10, 1, 10);
  const maxDiscoveries = clampInteger(body.max_discoveries, 100, 1, 200);
  const maxVerifications = clampInteger(body.max_verifications, 10, 1, 30);

  console.log(`[${FUNCTION_NAME}] ${requestId} collector started`, {
    state_code: stateCode,
    city,
    transaction_type: transaction,
    property_type_code: propertyType,
  });

  const collector = await callEdgeFunction(
    secrets,
    COLLECTOR_FUNCTION,
    {
      action: "collect",
      state_code: stateCode,
      city,
      transaction_type: transaction,
      property_type_code: propertyType,
      query_limit: queryLimit,
      results_per_query: resultsPerQuery,
    },
  );

  const runId = textOrNull(collector.run_id);
  if (!runId) throw new Error("collector_run_id_missing");

  const discoveries = await loadRunDiscoveries(
    secrets,
    runId,
    maxDiscoveries,
  );
  const enrichment = await enrichDiscoveries(secrets, discoveries);
  const verification = await verifyAndPromote(
    secrets,
    enrichment.promoted,
    maxVerifications,
    body.refresh_opportunities === true,
  );

  const verificationCounters = verification.counters;
  const totalErrors =
    enrichment.errors.length +
    (numberOrNull(verificationCounters.errors) ?? 0);
  const status = totalErrors > 0
    ? (verification.results.length > 0 ? "partial" : "failed")
    : verification.deferred.length > 0
    ? "partial"
    : "completed";

  const response: JsonRecord = {
    ok: status !== "failed",
    function: FUNCTION_NAME,
    version: FUNCTION_VERSION,
    request_id: requestId,
    status,
    target: {
      state_code: stateCode,
      city,
      transaction_type: transaction,
      property_type_code: propertyType,
    },
    commercial_rules: {
      minimum_rent: MINIMUM_RENT,
      minimum_sale: MINIMUM_SALE,
      sale_commission_rate: SALE_COMMISSION_RATE,
      sale_commission_percent: 1.25,
    },
    pipeline: {
      collector: COLLECTOR_FUNCTION,
      enricher: ENRICHER_FUNCTION,
      verifier: VERIFIER_FUNCTION,
      destination_table: OPPORTUNITIES_TABLE,
    },
    module_6: {
      actionable_leads: true,
      refresh_opportunities: body.refresh_opportunities === true,
      classifications: ["fire_green", "green", "yellow", "red"],
    },
    collector: {
      ok: collector.ok,
      version: collector.version ?? null,
      run_id: runId,
      status: collector.status ?? null,
      counters: collector.counters ?? {},
    },
    enrichment: {
      discoveries_loaded: discoveries.length,
      promoted_candidates: enrichment.promoted.length,
      batches_run: enrichment.responses.length,
      errors: enrichment.errors.length,
    },
    verification: verification.counters,
  };

  if (body.include_details !== false) {
    response.details = {
      enrichment_errors: enrichment.errors,
      verification_results: verification.results,
      opportunities: verification.saved,
      deferred_listing_ids: verification.deferred
        .map((item) => textOrNull(item.listing_id))
        .filter(Boolean),
      verification_history_skipped: verification.historySkipped,
    };
  }

  console.log(`[${FUNCTION_NAME}] ${requestId} completed`, response);
  return response;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
  }

  try {
    const body = await req.json().catch(() => ({})) as RadarRequest;
    const action = body.action === "health" ? "health" : "run";
    const secrets = getRuntimeSecrets();

    if (action === "health") {
      return jsonResponse({
        ok: true,
        function: FUNCTION_NAME,
        version: FUNCTION_VERSION,
        v1_modified: false,
        supabase_url_available: Boolean(secrets.supabaseUrl),
        named_secret_available: Boolean(secrets.internalKey),
        service_role_key_available: Boolean(secrets.serviceRoleKey),
        commercial_rules: {
          minimum_rent: MINIMUM_RENT,
          minimum_sale: MINIMUM_SALE,
          sale_commission_percent: 1.25,
        },
        module_6: {
          actionable_leads: true,
          trusted_public_contacts_only: true,
          refresh_opportunities_supported: true,
          classifications: ["fire_green", "green", "yellow", "red"],
        },
        pipeline: [
          COLLECTOR_FUNCTION,
          ENRICHER_FUNCTION,
          VERIFIER_FUNCTION,
          OPPORTUNITIES_TABLE,
        ],
      });
    }

    if (!isAuthorized(req, secrets)) {
      return jsonResponse({
        ok: false,
        error: "orchestrator_authentication_failed",
      }, 401);
    }

    const requestId = crypto.randomUUID();
    if (body.wait === true) {
      const result = await processRadar(body, requestId);
      return jsonResponse(result, result.ok === false ? 500 : 200);
    }

    EdgeRuntime.waitUntil(
      processRadar(body, requestId).catch((error) => {
        console.error(`[${FUNCTION_NAME}] ${requestId} failed`, error);
      }),
    );

    return jsonResponse({
      ok: true,
      function: FUNCTION_NAME,
      version: FUNCTION_VERSION,
      mode: "background",
      status: "started",
      request_id: requestId,
    }, 202);
  } catch (error) {
    console.error(`[${FUNCTION_NAME}] error`, error);
    return jsonResponse({
      ok: false,
      function: FUNCTION_NAME,
      version: FUNCTION_VERSION,
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});

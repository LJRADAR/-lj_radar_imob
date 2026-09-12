// ============================================================
// RADAR LJ V2
// MODULE 4 - NATIONAL COLLECTOR
// STAGE 4.6 - REAL LISTING ENRICHMENT
// EDGE FUNCTION: enriquecedor-lj-v2
// VERSION 4.9.0
//
// Responsibilities:
// - receives already-filtered individual discoveries
// - fetches the original listing page
// - extracts structured and visible listing data conservatively
// - creates/updates listings, properties and contacts
// - never invents phone, WhatsApp, price or address data
// - does NOT call Serper
// - does NOT modify V1
// ============================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type Action = "health" | "enrich";
type TransactionType = "sale" | "rent";
type DiscoveryStatus =
  | "raw"
  | "prefiltered"
  | "accepted_for_enrichment"
  | "rejected"
  | "error";
type ListingStatus = "active" | "removed" | "expired" | "republished" | "unknown";
type PropertyStatus = "active" | "inactive" | "removed" | "unknown";
type AdvertiserClassification =
  | "confirmed_owner"
  | "probable_owner"
  | "individual_unconfirmed"
  | "broker"
  | "real_estate_agency"
  | "developer"
  | "not_identified";
type WhatsappStatus = "confirmed" | "probable" | "not_confirmed" | "not_found";

type EnricherRequest = {
  action?: Action;
  discovery_ids?: string[];
  latest_run_only?: boolean;
  limit?: number;
};

type DiscoveryRow = {
  id: string;
  source_id: string | null;
  original_url: string;
  normalized_url: string | null;
  title: string | null;
  snippet: string | null;
  advertised_price: number | null;
  detected_state_code: string | null;
  detected_city: string | null;
  detected_neighborhood: string | null;
  detected_transaction: TransactionType | null;
  detected_property_type: string | null;
  advertiser_hint: string | null;
  published_at: string | null;
  discovery_status: DiscoveryStatus;
  latest_run_id: string | null;
  raw_payload: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
};

type SourceRow = {
  id: string;
  name: string;
  domain: string | null;
};

type ExtractedListing = {
  title: string | null;
  description: string | null;
  transactionType: TransactionType;
  transactionMismatch: boolean;
  price: number | null;
  condominiumFee: number | null;
  propertyTax: number | null;
  city: string | null;
  neighborhood: string | null;
  address: string | null;
  street: string | null;
  streetNumber: string | null;
  addressComplement: string | null;
  condominiumName: string | null;
  postalCode: string | null;
  stateCode: string | null;
  areaM2: number | null;
  bedrooms: number | null;
  suites: number | null;
  bathrooms: number | null;
  parkingSpaces: number | null;
  mainImageUrl: string | null;
  externalListingId: string | null;
  advertiserName: string | null;
  phoneRaw: string | null;
  phoneNormalized: string | null;
  ddd: string | null;
  whatsappStatus: WhatsappStatus;
  whatsappEvidence: string | null;
  contactEvidence: string | null;
  advertiserClassification: AdvertiserClassification;
  entityType: "person" | "company" | "unknown";
  listingStatus: ListingStatus;
  propertyStatus: PropertyStatus;
  fetchStatus: string;
  httpStatus: number | null;
  sourceEvidence: string[];
  structuredDataFound: boolean;
  meetsValueThreshold: boolean | null;
  rawSummary: Record<string, unknown>;
};

const FUNCTION_NAME = "enriquecedor-lj-v2";
const VERSION = "4.9.0";
const NAMED_SECRET_KEY = "radar_lj_v2_collector";
const DEFAULT_LIMIT = 4;
const MAX_LIMIT = 20;
const PAGE_TIMEOUT_MS = 9000;

// ============================================================
// BASIC HELPERS
// ============================================================

function jsonResponse(payload: unknown, status = 200): Response {
  return Response.json(payload, { status });
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function textOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned.length > 0 ? cleaned : null;
}

function normalize(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 16))
    )
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function cleanText(value: string): string {
  return decodeHtmlEntities(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/\\u00a0/gi, " ")
    .replace(/\\n|\\r|\\t/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function transactionMismatchFromText(
  text: string,
  expected: TransactionType | null,
): boolean {
  if (!expected) return false;

  const value = normalize(cleanText(text));
  const hasRent = [
    /\bpara alugar\b/,
    /\baluguel\b/,
    /\balugar\b/,
    /\baluga-se\b/,
    /\blocacao\b/,
    /\bpara locacao\b/,
    /\bmensais\b/,
    /\bpor mes\b/,
    /\/mes\b/,
  ].some((pattern) => pattern.test(value));

  const hasSale = [
    /\ba venda\b/,
    /\bvenda\b/,
    /\bcomprar\b/,
    /\bvendo\b/,
    /\bvende-se\b/,
    /\bvalor de venda\b/,
  ].some((pattern) => pattern.test(value));

  if (expected === "sale") return hasRent && !hasSale;
  return hasSale && !hasRent;
}

function safeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;

  const raw = value.trim();
  if (!raw) return null;

  let normalized = raw.replace(/[^0-9.,-]/g, "");
  if (!normalized) return null;

  const lastComma = normalized.lastIndexOf(",");
  const lastDot = normalized.lastIndexOf(".");

  if (lastComma > lastDot) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > lastComma) {
    const decimals = normalized.length - lastDot - 1;
    if (decimals === 3 && !normalized.includes(",")) {
      normalized = normalized.replace(/\./g, "");
    } else {
      normalized = normalized.replace(/,/g, "");
    }
  } else {
    normalized = normalized.replace(/[.,]/g, "");
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstNonNull<T>(...values: Array<T | null | undefined>): T | null {
  for (const value of values) {
    if (value !== null && value !== undefined) return value;
  }
  return null;
}

function normalizeUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    for (const key of [...url.searchParams.keys()]) {
      const k = key.toLowerCase();
      if (
        k.startsWith("utm_") ||
        ["fbclid", "gclid", "gbraid", "wbraid", "mc_cid", "mc_eid", "ref", "referrer"].includes(k)
      ) {
        url.searchParams.delete(key);
      }
    }
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
    url.searchParams.sort();
    return url.toString();
  } catch {
    return null;
  }
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => textOrNull(value)).filter((value): value is string => Boolean(value)))];
}

// ============================================================
// AUTHENTICATION
// Same proven backend key pattern used by coletor-lj-v2.
// ============================================================

function getNamedSecret(): string {
  try {
    const raw = Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}";
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const candidate = parsed[NAMED_SECRET_KEY];
    return typeof candidate === "string" ? candidate.trim() : "";
  } catch {
    return "";
  }
}

function isAuthorizedBackendRequest(req: Request): boolean {
  const expected = getNamedSecret();
  const incomingApiKey = req.headers.get("apikey")?.trim() ?? "";
  const authorization = req.headers.get("authorization")?.trim() ?? "";
  const incomingBearer = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : "";

  return Boolean(
    expected &&
      (incomingApiKey === expected || incomingBearer === expected),
  );
}

function getAdminClient() {
  const url = Deno.env.get("SUPABASE_URL")?.trim() ?? "";
  const secret = getNamedSecret();
  if (!url || !secret) return null;

  return createClient(url, secret, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

// ============================================================
// HTML / STRUCTURED DATA EXTRACTION
// ============================================================

function extractMetaContent(html: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${escaped}["'][^>]*>`, "i"),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return cleanText(match[1]);
  }
  return null;
}

function extractTitleTag(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1] ? cleanText(match[1]) : null;
}

function extractVisibleText(html: string): string {
  return cleanText(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  ).slice(0, 60000);
}

function collectJsonLd(html: string): unknown[] {
  const values: unknown[] = [];
  const regex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(html)) !== null) {
    const raw = decodeHtmlEntities(match[1]).trim();
    if (!raw) continue;
    try {
      values.push(JSON.parse(raw));
    } catch {
      // Malformed JSON-LD is ignored. We never guess values from invalid JSON.
    }
  }

  return values;
}

function walkObjects(value: unknown, collector: Array<Record<string, unknown>>): void {
  if (Array.isArray(value)) {
    for (const item of value) walkObjects(item, collector);
    return;
  }
  if (!value || typeof value !== "object") return;

  const record = value as Record<string, unknown>;
  collector.push(record);

  for (const child of Object.values(record)) {
    if (child && typeof child === "object") walkObjects(child, collector);
  }
}

function jsonLdObjects(jsonLd: unknown[]): Array<Record<string, unknown>> {
  const objects: Array<Record<string, unknown>> = [];
  for (const item of jsonLd) walkObjects(item, objects);
  return objects;
}

function objectType(record: Record<string, unknown>): string {
  const raw = record["@type"];
  if (Array.isArray(raw)) return normalize(raw.join(" "));
  return normalize(raw);
}

function findListingObjects(objects: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return objects.filter((record) => {
    const type = objectType(record);
    return [
      "realestatelisting",
      "apartment",
      "house",
      "residence",
      "accommodation",
      "product",
      "offer",
      "singlefamilyresidence",
    ].some((candidate) => type.includes(candidate));
  });
}

function extractStringFromRecords(
  records: Array<Record<string, unknown>>,
  keys: string[],
): string | null {
  for (const record of records) {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "string") {
        const cleaned = textOrNull(value);
        if (cleaned) return cleaned;
      }
    }
  }
  return null;
}

function extractNumberFromRecords(
  records: Array<Record<string, unknown>>,
  keys: string[],
): number | null {
  for (const record of records) {
    for (const key of keys) {
      const value = record[key];
      const parsed = safeNumber(value);
      if (parsed !== null) return parsed;
    }
  }
  return null;
}

function extractOfferPrice(records: Array<Record<string, unknown>>): number | null {
  for (const record of records) {
    const type = objectType(record);
    const price = safeNumber(record.price);
    if (type.includes("offer") && price !== null && price > 0) return price;

    const offers = record.offers;
    if (offers && typeof offers === "object") {
      const offerRecords: Array<Record<string, unknown>> = [];
      walkObjects(offers, offerRecords);
      for (const offer of offerRecords) {
        const offerPrice = safeNumber(offer.price);
        if (offerPrice !== null && offerPrice > 0) return offerPrice;
      }
    }
  }
  return null;
}

function extractImageFromRecords(records: Array<Record<string, unknown>>): string | null {
  for (const record of records) {
    const image = record.image;
    if (typeof image === "string" && /^https?:\/\//i.test(image)) return image;
    if (Array.isArray(image)) {
      const first = image.find((item) => typeof item === "string" && /^https?:\/\//i.test(item));
      if (typeof first === "string") return first;
    }
    if (image && typeof image === "object") {
      const imageRecord = image as Record<string, unknown>;
      for (const key of ["url", "contentUrl"]) {
        const candidate = imageRecord[key];
        if (typeof candidate === "string" && /^https?:\/\//i.test(candidate)) return candidate;
      }
    }
  }
  return null;
}

function extractAddressFromRecords(records: Array<Record<string, unknown>>): {
  street: string | null;
  city: string | null;
  stateCode: string | null;
  postalCode: string | null;
} {
  for (const record of records) {
    const address = record.address;
    if (!address || typeof address !== "object") continue;
    const a = address as Record<string, unknown>;
    const street = textOrNull(a.streetAddress);
    const city = textOrNull(a.addressLocality);
    const stateCode = textOrNull(a.addressRegion)?.toUpperCase() ?? null;
    const postalCode = textOrNull(a.postalCode);
    if (street || city || stateCode || postalCode) {
      return { street, city, stateCode, postalCode };
    }
  }
  return { street: null, city: null, stateCode: null, postalCode: null };
}

// ============================================================
// CONSERVATIVE FIELD PARSERS
// ============================================================

function extractMoneyByLabels(text: string, labels: string[]): number | null {
  const escapedLabels = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(
    `(?:${escapedLabels.join("|")})\\s*(?:\\||:|-|por|de)?\\s*(?:R\\$|\\$)\\s*([\\d.]+(?:,\\d{2})?)`,
    "i",
  );
  const match = text.match(pattern);
  return match?.[1] ? safeNumber(match[1]) : null;
}

function extractTransactionPrice(text: string, transaction: TransactionType): number | null {
  const labels = transaction === "sale"
    ? ["valor de venda", "valor do imóvel", "valor do imovel", "à venda", "a venda", "venda", "vende-se", "vendo"]
    : ["valor do aluguel", "aluguel", "locação", "locacao", "para alugar", "aluga-se"];

  const labeled = extractMoneyByLabels(text, labels);
  if (labeled !== null) {
    if (transaction === "sale" && labeled >= 100000) return labeled;
    if (transaction === "rent" && labeled >= 300 && labeled <= 200000) return labeled;
  }

  // Social posts often publish "Valor 💰 880.000,00" without the R$ prefix.
  // Accept that compact format only when the generic value label is immediately
  // followed by punctuation/symbols and a plausible transaction amount.
  const compactValueMatch = text.match(
    /(?:valor|preço|preco)\s*(?:[:\-|–—]|💰|💵)?\s*(?:R\$|\$)?\s*([\d.]+(?:,\d{2})?)/i,
  );
  const compactValue = compactValueMatch?.[1]
    ? safeNumber(compactValueMatch[1])
    : null;

  if (compactValue !== null) {
    if (transaction === "sale" && compactValue >= 100000) return compactValue;
    // A generic "Valor" field is weaker evidence than an explicit
    // "aluguel/locacao" label. Keep this fallback inside the normal rental
    // range so a sale value embedded in a rental page is not promoted as rent.
    if (transaction === "rent" && compactValue >= 300 && compactValue <= 50000) {
      return compactValue;
    }
  }

  return null;
}

/**
 * JSON-LD, OpenGraph and collector prices frequently expose the sale price on
 * pages whose URL/title also mentions rent. These generic fields have no
 * transaction label, so they must be validated before they can drive the
 * commercial threshold.
 *
 * Explicit transaction-labelled values are handled separately by
 * extractTransactionPrice() and therefore may support higher luxury rents.
 */
function normalizeGenericPriceForTransaction(
  value: number | null,
  transaction: TransactionType,
): number | null {
  if (value === null || !Number.isFinite(value) || value <= 0) return null;

  if (transaction === "sale") {
    return value >= 100000 && value <= 5_000_000_000 ? value : null;
  }

  return value >= 300 && value <= 50000 ? value : null;
}

function extractCondominiumFee(text: string): number | null {
  const value = extractMoneyByLabels(text, ["condomínio", "condominio", "valor do condomínio", "valor do condominio"]);
  return value !== null && value >= 0 && value <= 100000 ? value : null;
}

function extractPropertyTax(text: string): number | null {
  const value = extractMoneyByLabels(text, ["iptu", "imposto predial"]);
  return value !== null && value >= 0 && value <= 1000000 ? value : null;
}

function extractArea(text: string): number | null {
  const patterns = [
    /\b(\d{2,5}(?:[.,]\d{1,2})?)\s*m(?:²|2)\b/i,
    /(?:área|area)\s*(?:útil|util|privativa|total)?\s*(?:de|:)?\s*(\d{2,5}(?:[.,]\d{1,2})?)\s*m/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const value = safeNumber(match[1]);
    if (value !== null && value >= 10 && value <= 100000) return value;
  }
  return null;
}

function extractIntegerFeature(text: string, labels: string[], max = 100): number | null {
  const value = normalize(text);
  const group = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const match = value.match(new RegExp(`\\b(\\d{1,2})\\s*(?:${group})\\b`, "i"));
  if (!match?.[1]) return null;
  const number = Number(match[1]);
  return Number.isFinite(number) && number >= 0 && number <= max ? number : null;
}

function extractBedrooms(text: string): number | null {
  return extractIntegerFeature(text, ["quarto", "quartos", "dormitorio", "dormitorios", "dorm", "dorms"], 30);
}

function extractSuites(text: string): number | null {
  return extractIntegerFeature(text, ["suite", "suites"], 30);
}

function extractBathrooms(text: string): number | null {
  return extractIntegerFeature(text, ["banheiro", "banheiros", "wc", "wcs"], 30);
}

function extractParkingEvidence(text: string): {
  value: number | null;
  source: string;
  observedValues: number[];
  conflict: boolean;
} {
  const normalizedText = normalize(text);
  const candidates: Array<{ value: number; source: string; priority: number; position: number }> = [];
  const patterns: Array<{ pattern: RegExp; source: string; priority: number }> = [
    {
      pattern: /\b(?:garagem|espaco|espaço)\s+(?:coberta\s+)?(?:com\s+)?(?:capacidade\s+)?para\s+(\d{1,2})\s+(?:carros?|veiculos?|veículos?|vagas?)\b/gi,
      source: "explicit_garage_capacity",
      priority: 100,
    },
    {
      pattern: /\bcabem\s+(\d{1,2})\s+(?:carros?|veiculos?|veículos?)\b/gi,
      source: "explicit_vehicle_capacity",
      priority: 95,
    },
    {
      pattern: /\b(\d{1,2})\s+(?:vagas?|garagens?)\b/gi,
      source: "visible_parking_count",
      priority: 80,
    },
  ];

  for (const { pattern, source, priority } of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(normalizedText)) !== null) {
      const value = Number(match[1]);
      if (Number.isFinite(value) && value >= 0 && value <= 50) {
        candidates.push({ value, source, priority, position: match.index });
      }
    }
  }

  candidates.sort((a, b) => b.priority - a.priority || a.position - b.position);
  const observedValues = [...new Set(candidates.map((candidate) => candidate.value))];
  return {
    value: candidates[0]?.value ?? null,
    source: candidates[0]?.source ?? "not_confirmed",
    observedValues,
    conflict: observedValues.length > 1,
  };
}

function extractNeighborhood(text: string, city: string | null): string | null {
  const source = String(text ?? "");
  const cityPart = city ? city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : null;
  const patterns: RegExp[] = [
    /(?:bairro|no bairro|na vila)\s+([A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-Za-zÀ-ÿ0-9'\- ]{2,40}?)(?=\s*(?:[-–,.;]|\bcom\b|\bpossui\b|\btem\b|$))/i,
  ];
  if (cityPart) {
    patterns.push(new RegExp(`([A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-Za-zÀ-ÿ0-9'\\- ]{2,40}?)\\s*[-–,]\\s*${cityPart}(?:\\s*[-–,/]|$)`, "i"));
  }

  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (!match?.[1]) continue;
    const cleaned = match[1].replace(/\s+/g, " ").trim();
    const n = normalize(cleaned);
    if (cleaned.length < 3 || cleaned.length > 45) continue;
    if (city && normalize(cleaned) === normalize(city)) continue;
    if (/\b(apartamento|aluguel|locacao|venda|imovel|quarto|dormitorio|garagem)\b/.test(n)) continue;
    return cleaned;
  }
  return null;
}

function sanitizeNeighborhood(value: string | null, city: string | null): string | null {
  let cleaned = textOrNull(value);
  if (!cleaned) return null;

  // Collector snippets occasionally append the beginning of an address to
  // the neighborhood (for example "Mauá Rua José Salustiano Santana"). A
  // street marker starts a different field, so retain only the part before it.
  cleaned = cleaned
    .replace(
      /\s+(?=(?:Rua|Avenida|Alameda|Travessa|Estrada|Rodovia|Praça|Praca|R\.|Av\.)\s+)/i,
      "\u0000",
    )
    .split("\u0000")[0]
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return null;

  if (city) {
    const escapedCity = city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    cleaned = cleaned
      .replace(
        new RegExp(`\\s+(?:em|[-–,])\\s*${escapedCity}\\s*(?:[-–,]?\\s*[A-Z]{2})?$`, "i"),
        "",
      )
      .trim();
  }

  if (!cleaned) return null;

  const normalized = normalize(cleaned);
  if (city && normalized === normalize(city)) return null;
  if (cleaned.length < 3 || cleaned.length > 45) return null;

  const invalidPatterns = [
    /^(e|é|eh|esta|está|fica|possui|tem|oferece)\b/,
    /^(excelente|otimo|ótimo|muito|bem)\b/,
    /\b(localizacao|localização|oportunidade|abaixo do preco|abaixo do preço)\b/,
    /\b(apartamento|imovel|imóvel|aluguel|locacao|locação|venda|mobiliado)\b/,
  ];

  if (invalidPatterns.some((pattern) => pattern.test(normalized))) return null;

  const genericAdjectives = new Set([
    "tranquilo",
    "tranquila",
    "seguro",
    "segura",
    "excelente",
    "otimo",
    "otima",
    "nobre",
    "central",
    "residencial",
    "arborizado",
    "arborizada",
    "privilegiado",
    "privilegiada",
    "completo",
    "completa",
    "ideal",
    "perfeito",
    "perfeita",
  ]);

  if (genericAdjectives.has(normalized)) return null;
  return cleaned;
}

function sanitizeStreetAddress(value: string | null, city: string | null): string | null {
  let cleaned = textOrNull(value);
  if (!cleaned) return null;

  // Source pages often expose "Rua X - Bairro, Cidade - UF, Brasil" as one
  // string. The street column must not absorb neighborhood/city fragments.
  cleaned = cleaned.replace(/\s+[-–]\s+.*$/, "").trim();
  if (city) {
    const escapedCity = city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    cleaned = cleaned.replace(new RegExp(`,\\s*${escapedCity}\\b.*$`, "i"), "").trim();
  }
  cleaned = cleaned.replace(/,\s*(?:[A-Z]{2}|Brasil)\b.*$/i, "").trim();
  return cleaned || null;
}

function extractStreetAddress(text: string, city: string | null = null): string | null {
  const match = text.match(
    /\b(?:Rua|Avenida|Alameda|Travessa|Estrada|Rodovia|Praça|Praca|R\.|Av\.)\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ0-9][A-Za-zÀ-ÿ0-9'\-. ]{2,70}(?:,\s*\d{1,6})?/i,
  );
  return match?.[0]
    ? sanitizeStreetAddress(match[0].replace(/\s+/g, " ").trim(), city)
    : null;
}

function splitStreetAndNumber(address: string | null): { street: string | null; number: string | null } {
  if (!address) return { street: null, number: null };
  const match = address.match(/^(.*?)(?:,\s*|\s+)(\d{1,6}[A-Za-z]?)\s*$/);
  if (!match) return { street: address, number: null };
  return {
    street: textOrNull(match[1]),
    number: textOrNull(match[2]),
  };
}

function extractCondominiumName(text: string): string | null {
  const match = text.match(/(?:condomínio|condominio|edifício|edificio)\s+([A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-Za-zÀ-ÿ0-9'\- ]{2,50})/i);
  if (!match?.[1]) return null;
  const cleaned = match[1].replace(/\s+/g, " ").trim();
  return cleaned.length <= 55 ? cleaned : null;
}

function extractExternalListingId(url: string, records: Array<Record<string, unknown>>): string | null {
  const structured = extractStringFromRecords(records, ["sku", "productID", "identifier"]);
  if (structured) return structured;

  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    for (let index = segments.length - 1; index >= 0; index--) {
      const candidate = segments[index];
      if (/^\d{6,}$/.test(candidate)) return candidate;
      const embedded = candidate.match(/(\d{8,})/);
      if (embedded?.[1]) return embedded[1];
    }
  } catch {
    // Invalid URL already handled upstream.
  }
  return null;
}

function extractBrazilianPhone(text: string): {
  raw: string | null;
  normalized: string | null;
  ddd: string | null;
} {
  const candidates: string[] = [];
  const regex = /(?<!\d)(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?(?:9\s*)?\d{4}[-\s]?\d{4}(?!\d)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const raw = match[0].trim();
    const digits = raw.replace(/\D/g, "");
    if (digits.length >= 10 && digits.length <= 13) candidates.push(raw);
  }

  for (const raw of candidates) {
    let digits = raw.replace(/\D/g, "");
    if (digits.startsWith("55") && digits.length >= 12) digits = digits.slice(2);
    if (digits.length !== 10 && digits.length !== 11) continue;

    const ddd = digits.slice(0, 2);
    if (!/^[1-9][0-9]$/.test(ddd)) continue;

    return {
      raw,
      normalized: `55${digits}`,
      ddd,
    };
  }

  return { raw: null, normalized: null, ddd: null };
}

function extractWhatsappEvidence(html: string, visibleText: string, phoneNormalized: string | null): {
  status: WhatsappStatus;
  evidence: string | null;
} {
  const htmlNorm = html.toLowerCase();
  const textNorm = normalize(visibleText);

  const hasWhatsappLink =
    htmlNorm.includes("wa.me/") ||
    htmlNorm.includes("api.whatsapp.com/") ||
    htmlNorm.includes("whatsapp://");

  if (hasWhatsappLink) {
    if (phoneNormalized) {
      const phoneDigits = phoneNormalized.replace(/\D/g, "");
      const compactHtml = html.replace(/\D/g, "");
      if (phoneDigits && compactHtml.includes(phoneDigits)) {
        return {
          status: "confirmed",
          evidence: "Public WhatsApp link contains the detected phone number.",
        };
      }
    }
    return {
      status: "probable",
      evidence: "Public WhatsApp link found on listing page, but number match was not confirmed.",
    };
  }

  if (textNorm.includes("whatsapp")) {
    return {
      status: phoneNormalized ? "probable" : "not_confirmed",
      evidence: "WhatsApp is mentioned publicly on the page, but direct number-link confirmation was not found.",
    };
  }

  return {
    status: phoneNormalized ? "not_confirmed" : "not_found",
    evidence: null,
  };
}

function extractAdvertiserName(text: string, records: Array<Record<string, unknown>>): string | null {
  for (const record of records) {
    for (const key of ["seller", "author", "provider"]) {
      const value = record[key];
      if (value && typeof value === "object") {
        const name = textOrNull((value as Record<string, unknown>).name);
        if (name && name.length <= 80) return name;
      }
    }
  }

  const patterns = [
    /(?:anunciante|proprietário|proprietario|fale com|contato)\s*[:\-]\s*([A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-Za-zÀ-ÿ'\-. ]{2,60})/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const cleaned = match[1].replace(/\s+/g, " ").trim();
    const norm = normalize(cleaned);
    if (/\b(imobiliaria|corretor|corretora|creci|apartamento|imovel)\b/.test(norm)) continue;
    if (cleaned.length >= 3 && cleaned.length <= 70) return cleaned;
  }

  return null;
}

function classifyAdvertiser(
  sourceName: string | null,
  pageText: string,
  advertiserName: string | null,
  phoneNormalized: string | null,
): { classification: AdvertiserClassification; entityType: "person" | "company" | "unknown"; evidence: string | null } {
  const sourceNorm = normalize(sourceName);
  const textNorm = normalize(pageText);

  if (sourceNorm.includes("proprietario direto")) {
    return {
      classification: "confirmed_owner",
      entityType: advertiserName ? "person" : "unknown",
      evidence: "Individual listing from Proprietário Direto.",
    };
  }

  // Professional advertiser evidence always overrides generic owner wording.
  // This prevents broker posts containing phrases such as "direct owner" from
  // being promoted as owner listings.
  if (
    textNorm.includes("creci") ||
    textNorm.includes("corretor") ||
    textNorm.includes("corretora")
  ) {
    return {
      classification: "broker",
      entityType: advertiserName ? "person" : "unknown",
      evidence: "Broker-related wording found on listing page.",
    };
  }

  if (textNorm.includes("imobiliaria")) {
    return {
      classification: "real_estate_agency",
      entityType: "company",
      evidence: "Real-estate agency wording found on listing page.",
    };
  }

  if (/\b(construtora|incorporadora|incorporador)\b/.test(textNorm)) {
    return {
      classification: "developer",
      entityType: "company",
      evidence: "Developer/incorporator wording found on listing page.",
    };
  }

  if (
    textNorm.includes("direto com proprietario") ||
    textNorm.includes("direto do proprietario") ||
    textNorm.includes("proprietario vende") ||
    textNorm.includes("sem corretor") ||
    textNorm.includes("sem imobiliaria")
  ) {
    return {
      classification: "probable_owner",
      entityType: advertiserName ? "person" : "unknown",
      evidence: "Explicit public owner-direct wording found on listing page.",
    };
  }

  if (advertiserName || phoneNormalized) {
    return {
      classification: "individual_unconfirmed",
      entityType: advertiserName ? "person" : "unknown",
      evidence: "Public individual contact signal found, but owner status was not confirmed.",
    };
  }

  return {
    classification: "not_identified",
    entityType: "unknown",
    evidence: null,
  };
}

function detectListingStatus(html: string, visibleText: string): ListingStatus {
  const statusText = normalize(`${extractMetaContent(html, "robots") ?? ""} ${visibleText.slice(0, 5000)}`);
  if (
    statusText.includes("anuncio removido") ||
    statusText.includes("anúncio removido") ||
    statusText.includes("imovel indisponivel") ||
    statusText.includes("imóvel indisponível") ||
    statusText.includes("nao esta mais disponivel") ||
    statusText.includes("não está mais disponível")
  ) {
    return "removed";
  }
  if (statusText.includes("anuncio expirado") || statusText.includes("anúncio expirado")) return "expired";
  return "active";
}

function mapPropertyStatus(listingStatus: ListingStatus): PropertyStatus {
  if (listingStatus === "removed" || listingStatus === "expired") return "inactive";
  if (listingStatus === "active" || listingStatus === "republished") return "active";
  return "unknown";
}

function minimumThreshold(transaction: TransactionType): number {
  return transaction === "sale" ? 200_000 : 1_000;
}

function meetsThreshold(transaction: TransactionType, price: number | null): boolean | null {
  if (price === null) return null;
  return price >= minimumThreshold(transaction);
}

function thresholdOutcome(meetsValueThreshold: boolean | null): "eligible" | "below_minimum" | "inconclusive" {
  if (meetsValueThreshold === true) return "eligible";
  if (meetsValueThreshold === false) return "below_minimum";
  return "inconclusive";
}

function hasCompletedEnrichment(metadata: Record<string, unknown> | null): boolean {
  if (!metadata || typeof metadata !== "object") return false;
  const enrichment = metadata.enrichment;
  if (!enrichment || typeof enrichment !== "object") return false;
  const enrichmentRecord = enrichment as Record<string, unknown>;
  if (enrichmentRecord.retryable === true) return false;
  const completedAt = enrichmentRecord.completed_at;
  return typeof completedAt === "string" && completedAt.length > 0;
}

type CandidatePrecheck = {
  eligible: boolean;
  priority: number;
  reason: string | null;
};

function discoveryUrlClassification(discovery: DiscoveryRow): string | null {
  const value = discovery.metadata?.url_classification;
  return typeof value === "string" ? normalize(value) : null;
}

function looksLikeIndividualCandidateUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const path = url.pathname.toLowerCase();

  if (host.includes("proprietariodireto.com.br")) {
    return path.startsWith("/comprar-") || path.startsWith("/alugar-");
  }

  if (host.endsWith("facebook.com")) {
    return (
      path.includes("/marketplace/item/") ||
      /\/groups\/[^/]+\/posts\//.test(path)
    );
  }

  if (host === "olx.com.br" || host.endsWith(".olx.com.br")) {
    return (
      path.includes("/d/anuncio/") ||
      /\/anuncio\//.test(path) ||
      /-\d{8,}(?:\.html)?$/.test(path)
    );
  }

  if (host.endsWith("instagram.com")) {
    return path.startsWith("/p/") || path.startsWith("/reel/");
  }

  if (/\/(?:imovel|imoveis|anuncio|listing|property)\//.test(path)) {
    return /\d{5,}/.test(path);
  }

  return /\d{8,}/.test(path);
}

function genericOrUnsupportedReason(discovery: DiscoveryRow): string | null {
  if (discoveryUrlClassification(discovery) === "listing_page") {
    return "generic_listing_page";
  }

  let parsed: URL;

  try {
    parsed = new URL(discovery.original_url);
  } catch {
    return "invalid_original_url";
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const path = parsed.pathname.toLowerCase().replace(/\/+$/, "") || "/";
  const title = normalize(cleanText(String(discovery.title ?? "")));

  // Removido por pedido explícito do usuário: não descartar mais por "tipo de transação
  // divergente" nem por palavras de corretor/imobiliária no título — isso agora só reduz
  // confiança, não bloqueia. Continua bloqueando páginas que não são anúncio individual
  // (página de grupo, busca, perfil) e URL inválida.

  if (path === "/") {
    return "root_page";
  }

  if (host.endsWith("facebook.com")) {
    if (/^\/groups\/[^/]+$/.test(path)) return "generic_group_page";
    if (/^\/(?:groups|marketplace)$/.test(path)) return "generic_social_page";
  }

  if (host.endsWith("instagram.com")) {
    if (!path.startsWith("/p/") && !path.startsWith("/reel/")) {
      return "generic_social_profile";
    }
  }

  if (host.includes("proprietariodireto.com.br")) {
    if (
      path.startsWith("/venda/") ||
      path.startsWith("/aluguel/") ||
      path.startsWith("/cidade/") ||
      path.startsWith("/preco-m2/") ||
      path.includes("/interessados-em-imoveis")
    ) {
      return "generic_listing_page";
    }
  }

  if (
    /\/(?:busca|search|anuncios)(?:\/|$)/.test(path) ||
    /\/(?:imoveis|casas|apartamentos)-(?:venda|aluguel)(?:[-/]|$)/.test(path) ||
    /\/(?:imoveis|casas|apartamentos)\/(?:venda|aluguel)(?:\/|$)/.test(path)
  ) {
    return "generic_listing_page";
  }

  if (
    /^grupo .*imoveis/.test(title) ||
    /^\d+\s+imoveis\s+para\b/.test(title) ||
    /^(?:apartamentos?|casas?|imoveis?)\s+para\s+(?:venda|aluguel|alugar)\b/.test(title) ||
    /\bfalta de contato formal\b/.test(title) ||
    /\beditado pelo reclame aqui\b/.test(title) ||
    /\b(?:leilao|leiloes|portal zuk)\b/.test(title)
  ) {
    return "generic_or_index_page";
  }

  return null;
}

function automaticCandidatePrecheck(discovery: DiscoveryRow): CandidatePrecheck {
  const reason = genericOrUnsupportedReason(discovery);
  if (reason) return { eligible: false, priority: 0, reason };

  let parsed: URL;
  try {
    parsed = new URL(discovery.original_url);
  } catch {
    return { eligible: false, priority: 0, reason: "invalid_original_url" };
  }

  const classification = discoveryUrlClassification(discovery);
  if (classification === "individual_candidate") {
    return { eligible: true, priority: 100, reason: null };
  }

  if (looksLikeIndividualCandidateUrl(parsed)) {
    return { eligible: true, priority: 80, reason: null };
  }

  return { eligible: true, priority: 20, reason: null };
}

type FetchFailurePolicy = {
  discoveryStatus: DiscoveryStatus;
  countAsError: boolean;
  retryable: boolean;
  reason: string;
};

function fetchFailurePolicy(status: string, httpStatus: number | null): FetchFailurePolicy {
  if (httpStatus === 401 || httpStatus === 403) {
    return {
      discoveryStatus: "prefiltered",
      countAsError: false,
      retryable: false,
      reason: "source_fetch_blocked",
    };
  }

  if (httpStatus === 404 || httpStatus === 410) {
    return {
      discoveryStatus: "rejected",
      countAsError: false,
      retryable: false,
      reason: "listing_not_available",
    };
  }

  if (status === "not_html" || status === "empty_html") {
    return {
      discoveryStatus: "prefiltered",
      countAsError: false,
      retryable: false,
      reason: status,
    };
  }

  return {
    discoveryStatus: "error",
    countAsError: true,
    retryable: true,
    reason: status,
  };
}

type PromotionDecision = {
  promote: boolean;
  discoveryStatus: DiscoveryStatus;
  reason: string;
  priceConfidence: "confirmed" | "unconfirmed";
};

// Por pedido explícito do usuário: traga TUDO que for público (venda ou aluguel, qualquer
// anunciante), sem descartar por ser corretor/imobiliária/incorporadora, por preço abaixo do
// mínimo ou por tipo de transação divergente. Só bloqueia: anúncio removido/expirado, a fonte
// nomeada "Proprietário Direto" (nunca produziu contato, já é tratada à parte) e sites/domínios
// que exigem pagamento pra ver o contato do anunciante.
const PAYWALL_OR_AGGREGATOR_DOMAINS = [
  "rentola.com.br",
  "waa2.com.br",
  "achoumudou.com.br",
  "mgfimoveis.com.br",
];
function requiresPaymentForContact(sourceName: string | null, url: string, pageText: string): boolean {
  const sourceNorm = normalize(sourceName);
  if (sourceNorm.includes("proprietario direto")) return true;
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    if (PAYWALL_OR_AGGREGATOR_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
      return true;
    }
  } catch {
    // Invalid URL is handled elsewhere; not a paywall signal by itself.
  }
  const text = normalize(pageText);
  return [
    "cadastre-se para ver o telefone",
    "assine para ver o contato",
    "assine para ver o telefone",
    "torne-se assinante para contato",
    "plano premium para contato",
    "somente assinantes podem ver o telefone",
    "pague para ver o telefone",
    "desbloqueie o contato",
  ].some((phrase) => text.includes(normalize(phrase)));
}

function promotionDecision(
  extracted: ExtractedListing,
  sourceName: string | null,
  originalUrl: string,
  pageText: string,
): PromotionDecision {
  if (extracted.listingStatus === "removed" || extracted.listingStatus === "expired") {
    return {
      promote: false,
      discoveryStatus: "rejected",
      reason: "listing_not_active",
      priceConfidence: extracted.price !== null ? "confirmed" : "unconfirmed",
    };
  }

  if (requiresPaymentForContact(sourceName, originalUrl, pageText)) {
    return {
      promote: false,
      discoveryStatus: "rejected",
      reason: "paywall_or_named_excluded_source",
      priceConfidence: extracted.price !== null ? "confirmed" : "unconfirmed",
    };
  }

  return {
    promote: true,
    discoveryStatus: "accepted_for_enrichment",
    reason: extracted.meetsValueThreshold === null
      ? "promoted_price_unconfirmed"
      : "commercially_eligible_listing",
    priceConfidence: extracted.meetsValueThreshold === null ? "unconfirmed" : "confirmed",
  };
}

// ============================================================
// PAGE FETCH
// ============================================================

async function decodeHtmlResponse(
  response: Response,
  contentType: string,
): Promise<string> {
  const bytes = await response.arrayBuffer();
  const charsetMatch = contentType.match(/charset\s*=\s*["']?([^;"'\s]+)/i);
  const declaredCharset = charsetMatch?.[1]?.toLowerCase() ?? null;

  const aliases: Record<string, string> = {
    "iso-8859-1": "windows-1252",
    latin1: "windows-1252",
    "latin-1": "windows-1252",
    cp1252: "windows-1252",
  };

  const encoding = declaredCharset
    ? aliases[declaredCharset] ?? declaredCharset
    : "utf-8";

  let decoded: string;
  try {
    decoded = new TextDecoder(encoding).decode(bytes);
  } catch {
    decoded = new TextDecoder("utf-8").decode(bytes);
  }

  // Some servers omit or misreport a legacy Brazilian charset. Retry only
  // when UTF-8 produced replacement characters, preserving valid UTF-8 pages.
  if (decoded.includes("\uFFFD") && encoding === "utf-8") {
    try {
      return new TextDecoder("windows-1252").decode(bytes);
    } catch {
      return decoded;
    }
  }

  return decoded;
}

async function fetchHtml(url: string): Promise<{
  ok: boolean;
  status: string;
  httpStatus: number | null;
  html: string;
  finalUrl: string | null;
}> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; LJ-Radar-V2/4.6; +https://supabase.com)",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.5",
        "Cache-Control": "no-cache",
      },
    });

    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok) {
      return {
        ok: false,
        status: `http_${response.status}`,
        httpStatus: response.status,
        html: "",
        finalUrl: response.url || null,
      };
    }

    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
      return {
        ok: false,
        status: "not_html",
        httpStatus: response.status,
        html: "",
        finalUrl: response.url || null,
      };
    }

    const html = await decodeHtmlResponse(response, contentType);
    return {
      ok: html.length > 100,
      status: html.length > 100 ? "html_ok" : "empty_html",
      httpStatus: response.status,
      html,
      finalUrl: response.url || null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const aborted = message.toLowerCase().includes("abort");
    return {
      ok: false,
      status: aborted ? "timeout" : "fetch_error",
      httpStatus: null,
      html: "",
      finalUrl: null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

// ============================================================
// MAIN PAGE PARSER
// ============================================================

function parseListingPage(
  discovery: DiscoveryRow,
  sourceName: string | null,
  html: string,
  fetchStatus: string,
  httpStatus: number | null,
): ExtractedListing {
  const jsonLd = collectJsonLd(html);
  const objects = jsonLdObjects(jsonLd);
  const listingObjects = findListingObjects(objects);
  const visibleText = extractVisibleText(html);

  const ogTitle = extractMetaContent(html, "og:title");
  const metaDescription = firstNonNull(
    extractMetaContent(html, "og:description"),
    extractMetaContent(html, "description"),
    extractMetaContent(html, "twitter:description"),
  );
  const titleTag = extractTitleTag(html);

  const structuredTitle = extractStringFromRecords(listingObjects, ["name", "headline"]);
  const structuredDescription = extractStringFromRecords(listingObjects, ["description"]);
  const structuredAddress = extractAddressFromRecords(listingObjects.length > 0 ? listingObjects : objects);

  const rawTitle = firstNonNull(structuredTitle, ogTitle, discovery.title, titleTag);
  const rawDescription = firstNonNull(structuredDescription, metaDescription, discovery.snippet);
  const title = rawTitle ? textOrNull(cleanText(rawTitle)) : null;
  const description = rawDescription ? textOrNull(cleanText(rawDescription)) : null;
  const joinedPrimaryText = uniqueStrings([title, description, discovery.snippet, visibleText.slice(0, 30000)]).join(" ");

  const transactionType: TransactionType = discovery.detected_transaction === "rent" ? "rent" : "sale";
  const transactionMismatch =
    transactionMismatchFromText(
      `${discovery.title ?? ""} ${discovery.snippet ?? ""} ${discovery.original_url}`,
      transactionType,
    ) ||
    transactionMismatchFromText(
      `${title ?? ""} ${description ?? ""}`,
      transactionType,
    );

  const structuredPrice = extractOfferPrice(listingObjects.length > 0 ? listingObjects : objects);
  const metaPrice = firstNonNull(
    safeNumber(extractMetaContent(html, "product:price:amount")),
    safeNumber(extractMetaContent(html, "og:price:amount")),
  );

  // Transaction-labelled visible text is the strongest price evidence. A
  // generic structured/meta/collector value is accepted only when it is
  // plausible for the requested transaction. This prevents values such as
  // R$ 289.000 (sale) from being treated as monthly rent.
  const labeledTransactionPrice = extractTransactionPrice(joinedPrimaryText, transactionType);
  const structuredTransactionPrice = normalizeGenericPriceForTransaction(
    structuredPrice,
    transactionType,
  );
  const metaTransactionPrice = normalizeGenericPriceForTransaction(metaPrice, transactionType);
  const collectorTransactionPrice = normalizeGenericPriceForTransaction(
    discovery.advertised_price,
    transactionType,
  );
  const price = firstNonNull(
    labeledTransactionPrice,
    structuredTransactionPrice,
    metaTransactionPrice,
    collectorTransactionPrice,
  );
  const priceSource = labeledTransactionPrice !== null
    ? "visible_transaction_label"
    : structuredTransactionPrice !== null
    ? "jsonld_offer"
    : metaTransactionPrice !== null
    ? "meta"
    : collectorTransactionPrice !== null
    ? "collector"
    : "not_confirmed";

  const condominiumFee = extractCondominiumFee(joinedPrimaryText);
  const propertyTax = extractPropertyTax(joinedPrimaryText);

  const city = firstNonNull(structuredAddress.city, discovery.detected_city);
  const neighborhood = firstNonNull(
    sanitizeNeighborhood(discovery.detected_neighborhood, city),
    sanitizeNeighborhood(
      extractNeighborhood(`${title ?? ""} ${description ?? ""} ${visibleText.slice(0, 12000)}`, city),
      city,
    ),
  );

  const structuredStreet = sanitizeStreetAddress(structuredAddress.street, city);
  const extractedAddress = extractStreetAddress(
    `${description ?? ""} ${visibleText.slice(0, 16000)}`,
    city,
  );
  const structuredStreetParts = splitStreetAndNumber(structuredStreet);
  const visibleStreetParts = splitStreetAndNumber(extractedAddress);
  const street = firstNonNull(structuredStreetParts.street, visibleStreetParts.street);
  const streetNumber = firstNonNull(structuredStreetParts.number, visibleStreetParts.number);

  const address = firstNonNull(
    structuredStreet,
    extractedAddress,
  );

  const areaFromStructured = firstNonNull(
    extractNumberFromRecords(listingObjects, ["floorSize", "size", "area"]),
    (() => {
      for (const record of listingObjects) {
        const floorSize = record.floorSize;
        if (floorSize && typeof floorSize === "object") {
          const value = safeNumber((floorSize as Record<string, unknown>).value);
          if (value !== null) return value;
        }
      }
      return null;
    })(),
  );

  const areaM2 = firstNonNull(areaFromStructured, extractArea(joinedPrimaryText));
  const bedrooms = firstNonNull(
    extractNumberFromRecords(listingObjects, ["numberOfBedrooms", "numberOfRooms"]),
    extractBedrooms(joinedPrimaryText),
  );
  const bathrooms = firstNonNull(
    extractNumberFromRecords(listingObjects, ["numberOfBathroomsTotal", "numberOfBathrooms"]),
    extractBathrooms(joinedPrimaryText),
  );
  const suites = extractSuites(joinedPrimaryText);
  const parkingEvidence = extractParkingEvidence(joinedPrimaryText);
  const parkingSpaces = parkingEvidence.value;

  const image = firstNonNull(
    extractImageFromRecords(listingObjects.length > 0 ? listingObjects : objects),
    extractMetaContent(html, "og:image"),
    extractMetaContent(html, "twitter:image"),
  );

  const advertiserName = extractAdvertiserName(joinedPrimaryText, listingObjects.length > 0 ? listingObjects : objects);
  const phone = extractBrazilianPhone(`${visibleText} ${html.slice(0, 80000)}`);
  const whatsapp = extractWhatsappEvidence(html, visibleText, phone.normalized);
  const advertiser = classifyAdvertiser(sourceName, joinedPrimaryText, advertiserName, phone.normalized);
  const listingStatus = detectListingStatus(html, visibleText);
  const propertyStatus = mapPropertyStatus(listingStatus);

  const sourceEvidence = uniqueStrings([
    structuredTitle ? "jsonld_title" : null,
    structuredDescription ? "jsonld_description" : null,
    structuredPrice !== null ? "jsonld_price" : null,
    structuredPrice !== null && structuredTransactionPrice === null
      ? "jsonld_price_rejected_for_transaction"
      : null,
    metaPrice !== null ? "meta_price" : null,
    metaPrice !== null && metaTransactionPrice === null
      ? "meta_price_rejected_for_transaction"
      : null,
    discovery.advertised_price !== null && collectorTransactionPrice === null
      ? "collector_price_rejected_for_transaction"
      : null,
    structuredAddress.street || structuredAddress.city ? "jsonld_address" : null,
    image ? "image_found" : null,
    phone.normalized ? "public_phone_found" : null,
    whatsapp.evidence ? "whatsapp_signal_found" : null,
    advertiser.evidence ? "advertiser_signal_found" : null,
  ]);

  return {
    title,
    description,
    transactionType,
    transactionMismatch,
    price,
    condominiumFee,
    propertyTax,
    city,
    neighborhood,
    address,
    street,
    streetNumber,
    addressComplement: null,
    condominiumName: extractCondominiumName(joinedPrimaryText),
    postalCode: structuredAddress.postalCode,
    stateCode: firstNonNull(structuredAddress.stateCode, discovery.detected_state_code)?.toUpperCase() ?? null,
    areaM2,
    bedrooms: bedrooms !== null ? Math.trunc(bedrooms) : null,
    suites: suites !== null ? Math.trunc(suites) : null,
    bathrooms: bathrooms !== null ? Math.trunc(bathrooms) : null,
    parkingSpaces: parkingSpaces !== null ? Math.trunc(parkingSpaces) : null,
    mainImageUrl: image,
    externalListingId: extractExternalListingId(discovery.original_url, listingObjects.length > 0 ? listingObjects : objects),
    advertiserName,
    phoneRaw: phone.raw,
    phoneNormalized: phone.normalized,
    ddd: phone.ddd,
    whatsappStatus: whatsapp.status,
    whatsappEvidence: whatsapp.evidence,
    contactEvidence: advertiser.evidence,
    advertiserClassification: advertiser.classification,
    entityType: advertiser.entityType,
    listingStatus,
    propertyStatus,
    fetchStatus,
    httpStatus,
    sourceEvidence,
    structuredDataFound: jsonLd.length > 0,
    meetsValueThreshold: meetsThreshold(transactionType, price),
    rawSummary: {
      json_ld_blocks: jsonLd.length,
      listing_objects: listingObjects.length,
      title_source: structuredTitle ? "jsonld" : ogTitle ? "og" : discovery.title ? "collector" : titleTag ? "title" : "none",
      price_source: priceSource,
      structured_price_raw: structuredPrice,
      meta_price_raw: metaPrice,
      collector_price_raw: discovery.advertised_price,
      phone_found: Boolean(phone.normalized),
      whatsapp_status: whatsapp.status,
      transaction_mismatch: transactionMismatch,
      parking_source: parkingEvidence.source,
      parking_values_observed: parkingEvidence.observedValues,
      parking_conflict: parkingEvidence.conflict,
    },
  };
}

// ============================================================
// DATABASE UPSERT HELPERS
// ============================================================

function nonNullPatch(values: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value !== null && value !== undefined) output[key] = value;
  }
  return output;
}

async function createPropertyFingerprint(discovery: DiscoveryRow, extracted: ExtractedListing): Promise<string | null> {
  const parts = [
    extracted.stateCode,
    extracted.city,
    extracted.neighborhood,
    extracted.street,
    extracted.streetNumber,
    extracted.condominiumName,
    extracted.areaM2 !== null ? String(Math.round(extracted.areaM2 * 10) / 10) : null,
    extracted.bedrooms !== null ? String(extracted.bedrooms) : null,
  ];

  const meaningful = parts.filter((item) => textOrNull(item)).length;
  if (meaningful < 4) return null;

  return sha256(
    parts
      .map((item) => normalize(item))
      .join("|"),
  );
}

async function upsertProperty(
  db: ReturnType<typeof createClient>,
  discovery: DiscoveryRow,
  extracted: ExtractedListing,
  existingPropertyId: string | null,
): Promise<{ id: string | null; error: string | null; fingerprint: string | null }> {
  const fingerprint = await createPropertyFingerprint(discovery, extracted);
  let propertyId = existingPropertyId;

  if (!propertyId && fingerprint) {
    const { data } = await db
      .from("lj_v2_properties")
      .select("id")
      .eq("fingerprint", fingerprint)
      .limit(1);
    propertyId = data?.[0]?.id ?? null;
  }

  const canonicalAddress = uniqueStrings([
    extracted.street,
    extracted.streetNumber,
    extracted.neighborhood,
    extracted.city,
    extracted.stateCode,
  ]).join(", ") || null;

  const payload = nonNullPatch({
    fingerprint,
    property_type: discovery.detected_property_type,
    country_code: "BR",
    state_code: extracted.stateCode,
    city: extracted.city,
    neighborhood: extracted.neighborhood,
    street: extracted.street,
    street_number: extracted.streetNumber,
    address_complement: extracted.addressComplement,
    condominium_name: extracted.condominiumName,
    postal_code: extracted.postalCode,
    canonical_address: canonicalAddress,
    area_m2: extracted.areaM2,
    bedrooms: extracted.bedrooms,
    suites: extracted.suites,
    bathrooms: extracted.bathrooms,
    parking_spaces: extracted.parkingSpaces,
    main_image_url: extracted.mainImageUrl,
    current_status: extracted.propertyStatus,
    last_seen_at: new Date().toISOString(),
    metadata: {
      last_enrichment: {
        function: FUNCTION_NAME,
        version: VERSION,
        discovery_id: discovery.id,
        source_evidence: extracted.sourceEvidence,
      },
    },
  });

  if (propertyId) {
    const { error } = await db
      .from("lj_v2_properties")
      .update(payload)
      .eq("id", propertyId);
    return { id: propertyId, error: error?.message ?? null, fingerprint };
  }

  const { data, error } = await db
    .from("lj_v2_properties")
    .insert(payload)
    .select("id")
    .single();

  return {
    id: data?.id ?? null,
    error: error?.message ?? null,
    fingerprint,
  };
}

async function upsertListing(
  db: ReturnType<typeof createClient>,
  discovery: DiscoveryRow,
  extracted: ExtractedListing,
  propertyId: string | null,
  priceConfidence: "confirmed" | "unconfirmed",
): Promise<{ id: string | null; error: string | null; existed: boolean }> {
  const { data: existingRows, error: lookupError } = await db
    .from("lj_v2_listings")
    .select("id,property_id")
    .eq("original_url", discovery.original_url)
    .limit(1);

  if (lookupError) return { id: null, error: lookupError.message, existed: false };

  const existing = existingRows?.[0] as { id: string; property_id: string | null } | undefined;
  const payload = nonNullPatch({
    property_id: propertyId ?? existing?.property_id ?? null,
    source_id: discovery.source_id,
    external_listing_id: extracted.externalListingId,
    original_url: discovery.original_url,
    title: extracted.title,
    description: extracted.description,
    transaction_type: extracted.transactionType,
    price: extracted.price,
    condominium_fee: extracted.condominiumFee,
    property_tax: extracted.propertyTax,
    advertised_city: extracted.city,
    advertised_neighborhood: extracted.neighborhood,
    advertised_address: extracted.address,
    advertiser_name: extracted.advertiserName,
    published_at: discovery.published_at,
    last_seen_at: new Date().toISOString(),
    listing_status: extracted.listingStatus,
    raw_data: {
      enrichment: {
        function: FUNCTION_NAME,
        version: VERSION,
        discovery_id: discovery.id,
        fetch_status: extracted.fetchStatus,
        http_status: extracted.httpStatus,
        structured_data_found: extracted.structuredDataFound,
        source_evidence: extracted.sourceEvidence,
        meets_value_threshold: extracted.meetsValueThreshold,
        price_confidence: priceConfidence,
        summary: extracted.rawSummary,
      },
      collector: {
        title: discovery.title,
        snippet: discovery.snippet,
        metadata: discovery.metadata ?? {},
      },
    },
  });

  if (existing) {
    const { error } = await db
      .from("lj_v2_listings")
      .update(payload)
      .eq("id", existing.id);
    return { id: existing.id, error: error?.message ?? null, existed: true };
  }

  const { data, error } = await db
    .from("lj_v2_listings")
    .insert(payload)
    .select("id")
    .single();

  return { id: data?.id ?? null, error: error?.message ?? null, existed: false };
}

async function upsertContact(
  db: ReturnType<typeof createClient>,
  discovery: DiscoveryRow,
  extracted: ExtractedListing,
  listingId: string,
): Promise<{
  contactId: string | null;
  error: string | null;
  phoneIdentityConflict: boolean;
  phoneTrusted: boolean;
  effectiveWhatsappStatus: WhatsappStatus;
}> {
  if (!extracted.phoneNormalized && !extracted.advertiserName) {
    return {
      contactId: null,
      error: null,
      phoneIdentityConflict: false,
      phoneTrusted: false,
      effectiveWhatsappStatus: "not_found",
    };
  }

  const now = new Date().toISOString();
  const currentNameNormalized = extracted.advertiserName
    ? normalize(extracted.advertiserName).trim()
    : "";

  let contactId: string | null = null;
  let phoneIdentityConflict = false;
  let phoneTrusted = Boolean(extracted.phoneNormalized);
  let effectiveWhatsappStatus: WhatsappStatus = extracted.whatsappStatus;

  // Reuse the listing's current primary advertiser only when its identity
  // still agrees with the advertiser name extracted from this listing.
  let existingPrimaryContact:
    | { id: string; display_name: string | null; metadata: Record<string, unknown> | null }
    | null = null;

  const { data: primaryRelations } = await db
    .from("lj_v2_listing_contacts")
    .select("contact_id")
    .eq("listing_id", listingId)
    .eq("relationship_type", "advertiser")
    .eq("is_primary", true)
    .limit(1);

  const existingPrimaryContactId = primaryRelations?.[0]?.contact_id as string | undefined;
  if (existingPrimaryContactId) {
    const { data: existingPrimaryRows } = await db
      .from("lj_v2_contacts")
      .select("id,display_name,metadata")
      .eq("id", existingPrimaryContactId)
      .limit(1);

    const row = existingPrimaryRows?.[0] as
      | { id: string; display_name: string | null; metadata: Record<string, unknown> | null }
      | undefined;

    if (row) existingPrimaryContact = row;
  }

  const primaryNameNormalized = existingPrimaryContact?.display_name
    ? normalize(existingPrimaryContact.display_name).trim()
    : "";

  const primaryIdentityMatches = Boolean(
    existingPrimaryContact &&
      (!currentNameNormalized || !primaryNameNormalized || primaryNameNormalized === currentNameNormalized),
  );

  if (primaryIdentityMatches && existingPrimaryContact) {
    contactId = existingPrimaryContact.id;
  }

  type SamePhoneContact = {
    id: string;
    display_name: string | null;
    metadata: Record<string, unknown> | null;
  };

  let samePhoneContacts: SamePhoneContact[] = [];

  if (extracted.phoneNormalized) {
    const { data } = await db
      .from("lj_v2_contacts")
      .select("id,display_name,metadata")
      .eq("phone_normalized", extracted.phoneNormalized);

    samePhoneContacts = (data ?? []) as SamePhoneContact[];

    const matchingNameContact = currentNameNormalized
      ? samePhoneContacts.find((row) => {
          const existingName = row.display_name ? normalize(row.display_name).trim() : "";
          return Boolean(existingName && existingName === currentNameNormalized);
        })
      : null;

    const conflictingNamedContacts = currentNameNormalized
      ? samePhoneContacts.filter((row) => {
          const existingName = row.display_name ? normalize(row.display_name).trim() : "";
          return Boolean(existingName && existingName !== currentNameNormalized);
        })
      : [];

    if (conflictingNamedContacts.length > 0) {
      phoneIdentityConflict = true;
      phoneTrusted = false;
      effectiveWhatsappStatus = "not_confirmed";

      // The same number appearing under different advertiser names is not
      // safe enough to attribute to either owner. Remove that attribution
      // from every contact currently carrying the number, but preserve the
      // observed number and conflict evidence in metadata for audit.
      for (const row of samePhoneContacts) {
        const priorMetadata =
          row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
            ? row.metadata
            : {};

        const { error: conflictUpdateError } = await db
          .from("lj_v2_contacts")
          .update({
            phone_raw: null,
            phone_normalized: null,
            ddd: null,
            whatsapp_status: "not_confirmed",
            whatsapp_evidence:
              "Phone appeared on listings with different advertiser names; owner-number association was invalidated.",
            last_seen_at: now,
            metadata: {
              ...priorMetadata,
              phone_identity_conflict: {
                observed_phone_normalized: extracted.phoneNormalized,
                detected_by: FUNCTION_NAME,
                version: VERSION,
                discovery_id: discovery.id,
                incoming_advertiser_name: extracted.advertiserName,
                existing_advertiser_name: row.display_name,
                detected_at: now,
              },
            },
          })
          .eq("id", row.id);

        if (conflictUpdateError) {
          return {
            contactId,
            error: conflictUpdateError.message,
            phoneIdentityConflict,
            phoneTrusted,
            effectiveWhatsappStatus,
          };
        }
      }

      if (!contactId && matchingNameContact) {
        contactId = matchingNameContact.id;
      }
    } else if (!contactId) {
      if (matchingNameContact) {
        contactId = matchingNameContact.id;
      } else if (samePhoneContacts.length === 1) {
        const only = samePhoneContacts[0];
        const onlyNameNormalized = only.display_name ? normalize(only.display_name).trim() : "";
        if (!currentNameNormalized || !onlyNameNormalized) contactId = only.id;
      }
    }
  }

  const conflictEvidence = phoneIdentityConflict
    ? "Phone appeared under different advertiser names and was not trusted as an owner-specific contact."
    : null;

  const contactPayload = nonNullPatch({
    display_name: extracted.advertiserName,
    entity_type: extracted.entityType,
    advertiser_classification: extracted.advertiserClassification,
    phone_raw: phoneTrusted ? extracted.phoneRaw : null,
    phone_normalized: phoneTrusted ? extracted.phoneNormalized : null,
    ddd: phoneTrusted ? extracted.ddd : null,
    whatsapp_status: effectiveWhatsappStatus,
    whatsapp_evidence: conflictEvidence ?? extracted.whatsappEvidence,
    contact_evidence: extracted.contactEvidence,
    public_profile_url: discovery.original_url,
    discovered_source_id: discovery.source_id,
    last_seen_at: now,
    metadata: {
      last_enrichment: {
        function: FUNCTION_NAME,
        version: VERSION,
        discovery_id: discovery.id,
      },
      ...(phoneIdentityConflict
        ? {
            phone_identity_conflict: {
              observed_phone_normalized: extracted.phoneNormalized,
              detected_at: now,
              action: "phone_not_attributed_to_owner",
            },
          }
        : {}),
    },
  });

  if (contactId) {
    const { error } = await db
      .from("lj_v2_contacts")
      .update(contactPayload)
      .eq("id", contactId);
    if (error) {
      return {
        contactId,
        error: error.message,
        phoneIdentityConflict,
        phoneTrusted,
        effectiveWhatsappStatus,
      };
    }
  } else {
    const { data, error } = await db
      .from("lj_v2_contacts")
      .insert(contactPayload)
      .select("id")
      .single();
    if (error || !data?.id) {
      return {
        contactId: null,
        error: error?.message ?? "contact_insert_failed",
        phoneIdentityConflict,
        phoneTrusted,
        effectiveWhatsappStatus,
      };
    }
    contactId = data.id;
  }

  const confidence =
    extracted.advertiserClassification === "confirmed_owner"
      ? 95
      : extracted.advertiserClassification === "probable_owner"
        ? 80
        : phoneTrusted
          ? 65
          : 50;

  // A listing must have only one primary advertiser. Remove an older primary
  // relationship when re-enrichment proves it points to a different contact.
  const { error: staleRelationError } = await db
    .from("lj_v2_listing_contacts")
    .delete()
    .eq("listing_id", listingId)
    .eq("relationship_type", "advertiser")
    .eq("is_primary", true)
    .neq("contact_id", contactId);

  if (staleRelationError) {
    return {
      contactId,
      error: staleRelationError.message,
      phoneIdentityConflict,
      phoneTrusted,
      effectiveWhatsappStatus,
    };
  }

  const { error: relationError } = await db
    .from("lj_v2_listing_contacts")
    .upsert(
      {
        listing_id: listingId,
        contact_id: contactId,
        relationship_type: "advertiser",
        is_primary: true,
        confidence_score: confidence,
        evidence: conflictEvidence ?? extracted.contactEvidence ?? extracted.whatsappEvidence,
      },
      {
        onConflict: "listing_id,contact_id",
      },
    );

  return {
    contactId,
    error: relationError?.message ?? null,
    phoneIdentityConflict,
    phoneTrusted,
    effectiveWhatsappStatus,
  };
}

async function updateDiscoveryAfterEnrichment(
  db: ReturnType<typeof createClient>,
  discovery: DiscoveryRow,
  extracted: ExtractedListing | null,
  status: DiscoveryStatus,
  extra: Record<string, unknown> = {},
): Promise<string | null> {
  const metadata = {
    ...(discovery.metadata ?? {}),
    enrichment: {
      function: FUNCTION_NAME,
      version: VERSION,
      completed_at: new Date().toISOString(),
      ...(extracted
        ? {
            fetch_status: extracted.fetchStatus,
            http_status: extracted.httpStatus,
            structured_data_found: extracted.structuredDataFound,
            source_evidence: extracted.sourceEvidence,
            meets_value_threshold: extracted.meetsValueThreshold,
            price: extracted.price,
            area_m2: extracted.areaM2,
            bedrooms: extracted.bedrooms,
            parking_spaces: extracted.parkingSpaces,
            phone_found: Boolean(extracted.phoneNormalized),
            whatsapp_status: extracted.whatsappStatus,
            advertiser_classification: extracted.advertiserClassification,
          }
        : {}),
      ...extra,
    },
  };

  const payload = {
    ...nonNullPatch({
    discovery_status: status,
    advertiser_hint: extracted?.advertiserName ?? discovery.advertiser_hint,
    last_seen_at: new Date().toISOString(),
    metadata,
    }),
    // A successful reparse is authoritative for price validation. Writing
    // null here removes a stale generic value that was previously mistaken
    // for the requested transaction (for example, sale price as rent).
    ...(extracted ? { advertised_price: extracted.price } : {}),
    // When a new parse rejects a previously stored false neighborhood, write
    // null explicitly instead of preserving the stale value.
    ...(extracted ? { detected_neighborhood: extracted.neighborhood } : {}),
  };

  const { error } = await db
    .from("lj_v2_raw_discoveries")
    .update(payload)
    .eq("id", discovery.id);

  return error?.message ?? null;
}

// ============================================================
// DISCOVERY SELECTION
// ============================================================

async function loadDiscoveries(
  db: ReturnType<typeof createClient>,
  body: EnricherRequest,
): Promise<{ discoveries: DiscoveryRow[]; selection: Record<string, unknown>; error: string | null }> {
  const limit = clampInt(body.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const explicitIds = Array.isArray(body.discovery_ids)
    ? body.discovery_ids.filter((id) => typeof id === "string" && id.length >= 20).slice(0, MAX_LIMIT)
    : [];

  if (explicitIds.length > 0) {
    const { data, error } = await db
      .from("lj_v2_raw_discoveries")
      .select("*")
      .in("id", explicitIds)
      .limit(limit);

    return {
      discoveries: (data ?? []) as DiscoveryRow[],
      selection: { mode: "explicit_ids", requested: explicitIds.length, limit },
      error: error?.message ?? null,
    };
  }

  const latestRunOnly = body.latest_run_only !== false;

  if (latestRunOnly) {
    const { data: runs, error: runError } = await db
      .from("lj_v2_collector_runs")
      .select("id,created_at,status")
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(1);

    if (runError) return { discoveries: [], selection: {}, error: runError.message };
    const runId = runs?.[0]?.id as string | undefined;
    if (!runId) return { discoveries: [], selection: { mode: "latest_run" }, error: null };

    // Read a wider pool because the first search positions can contain
    // generic pages or sources that cannot be fetched server-side. The
    // requested limit is applied only after the automatic precheck.
    const relationPoolLimit = Math.min(200, Math.max(limit * 20, 40));

    const { data: relations, error: relationError } = await db
      .from("lj_v2_collector_run_discoveries")
      .select("discovery_id,result_position")
      .eq("run_id", runId)
      .order("result_position", { ascending: true })
      .limit(relationPoolLimit);

    if (relationError) return { discoveries: [], selection: { mode: "latest_run", run_id: runId }, error: relationError.message };

    const ids = (relations ?? [])
      .map((row) => row.discovery_id as string)
      .filter(Boolean);

    if (ids.length === 0) {
      return { discoveries: [], selection: { mode: "latest_run", run_id: runId, limit }, error: null };
    }

    const { data, error } = await db
      .from("lj_v2_raw_discoveries")
      .select("*")
      .in("id", ids);

    const byId = new Map<string, DiscoveryRow>();
    for (const row of (data ?? []) as DiscoveryRow[]) byId.set(row.id, row);

    // Automatic latest-run processing must not enrich the same discovery again
    // after a completed enrichment. Explicit discovery_ids remain the manual
    // override path when a reprocess is intentionally required.
    const pending = ids
      .map((id) => byId.get(id))
      .filter((row): row is DiscoveryRow => Boolean(row))
      .filter((row) => !hasCompletedEnrichment(row.metadata));

    const prechecked = pending.map((row, originalIndex) => ({
      row,
      originalIndex,
      check: automaticCandidatePrecheck(row),
    }));

    const eligible = prechecked
      .filter((item) => item.check.eligible)
      .sort((a, b) => {
        if (b.check.priority !== a.check.priority) {
          return b.check.priority - a.check.priority;
        }
        return a.originalIndex - b.originalIndex;
      });

    const ordered = eligible
      .slice(0, limit)
      .map((item) => item.row);

    const skippedCompleted = ids.length - pending.length;
    const skippedPrefilter = prechecked.length - eligible.length;
    const individualPriorityCandidates = eligible.filter(
      (item) => item.check.priority >= 80,
    ).length;

    return {
      discoveries: ordered,
      selection: {
        mode: "latest_run",
        run_id: runId,
        limit,
        pool_examined: ids.length,
        skipped_completed: skippedCompleted,
        skipped_prefilter: skippedPrefilter,
        individual_priority_candidates: individualPriorityCandidates,
      },
      error: error?.message ?? null,
    };
  }

  const { data, error } = await db
    .from("lj_v2_raw_discoveries")
    .select("*")
    .in("discovery_status", ["raw", "prefiltered", "accepted_for_enrichment"])
    .order("created_at", { ascending: true })
    .limit(limit);

  return {
    discoveries: (data ?? []) as DiscoveryRow[],
    selection: { mode: "oldest_pending", limit },
    error: error?.message ?? null,
  };
}

// ============================================================
// MAIN FUNCTION
// ============================================================

export default {
  fetch: async (req: Request) => {
    let body: EnricherRequest = {};
    try {
      if ((req.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
        const parsed = await req.json();
        if (parsed && typeof parsed === "object") body = parsed as EnricherRequest;
      }
    } catch {
      body = {};
    }

    const action: Action = body.action === "enrich" ? "enrich" : "health";

    // Public health check. No DB writes and no external listing fetches.
    if (action === "health") {
      return jsonResponse({
        ok: true,
        function: FUNCTION_NAME,
        version: VERSION,
        named_secret_available: Boolean(getNamedSecret()),
        supabase_url_available: Boolean(Deno.env.get("SUPABASE_URL")),
        does_not_use_serper: true,
      });
    }

    if (!isAuthorizedBackendRequest(req)) {
      return jsonResponse(
        {
          ok: false,
          error: "enrichment_authentication_failed",
        },
        401,
      );
    }

    const db = getAdminClient();
    if (!db) {
      return jsonResponse(
        {
          ok: false,
          error: "supabase_admin_client_unavailable",
        },
        500,
      );
    }

    const { discoveries, selection, error: selectionError } = await loadDiscoveries(db, body);
    if (selectionError) {
      return jsonResponse(
        {
          ok: false,
          error: "discovery_selection_failed",
          details: selectionError,
          selection,
        },
        500,
      );
    }

    if (discoveries.length === 0) {
      return jsonResponse({
        ok: true,
        function: FUNCTION_NAME,
        version: VERSION,
        status: "nothing_to_enrich",
        selection,
        counters: {
          selected: 0,
          fetched: 0,
          enriched: 0,
          listings_created: 0,
          listings_updated: 0,
          properties_written: 0,
          contacts_linked: 0,
          skipped_before_fetch: 0,
          fetch_skipped: 0,
          database_write_skipped: 0,
          errors: 0,
        },
        results: [],
      });
    }

    const sourceIds = uniqueStrings(discoveries.map((item) => item.source_id));
    const sourceMap = new Map<string, SourceRow>();
    if (sourceIds.length > 0) {
      const { data: sources } = await db
        .from("lj_v2_sources")
        .select("id,name,domain")
        .in("id", sourceIds);
      for (const source of (sources ?? []) as SourceRow[]) sourceMap.set(source.id, source);
    }

    let fetched = 0;
    let enriched = 0;
    let listingsCreated = 0;
    let listingsUpdated = 0;
    let propertiesWritten = 0;
    let contactsLinked = 0;
    let skippedBeforeFetch = 0;
    let fetchSkipped = 0;
    let databaseWriteSkipped = 0;
    let errors = 0;

    const results: Array<Record<string, unknown>> = [];

    for (const discovery of discoveries) {
      const sourceName = discovery.source_id ? sourceMap.get(discovery.source_id)?.name ?? null : null;

      if (!discovery.original_url || !normalizeUrl(discovery.original_url)) {
        skippedBeforeFetch += 1;
        const discoveryUpdateError = await updateDiscoveryAfterEnrichment(db, discovery, null, "rejected", {
          prefilter_reason: "invalid_original_url",
          database_write_skipped: true,
        });

        if (discoveryUpdateError) errors += 1;

        results.push({
          discovery_id: discovery.id,
          ok: !discoveryUpdateError,
          error: discoveryUpdateError ?? undefined,
          prefilter_reason: "invalid_original_url",
          discovery_status: "rejected",
          database_write_skipped: true,
        });
        continue;
      }

      await db
        .from("lj_v2_raw_discoveries")
        .update({ discovery_status: "accepted_for_enrichment" })
        .eq("id", discovery.id);

      const fetchedPage = await fetchHtml(discovery.original_url);
      if (!fetchedPage.ok) {
        const policy = fetchFailurePolicy(
          fetchedPage.status,
          fetchedPage.httpStatus,
        );

        if (policy.countAsError) errors += 1;
        else fetchSkipped += 1;

        const discoveryUpdateError = await updateDiscoveryAfterEnrichment(
          db,
          discovery,
          null,
          policy.discoveryStatus,
          {
            fetch_status: fetchedPage.status,
            http_status: fetchedPage.httpStatus,
            fetch_outcome: policy.reason,
            retryable: policy.retryable,
            database_write_skipped: true,
          },
        );

        if (discoveryUpdateError) errors += 1;

        results.push({
          discovery_id: discovery.id,
          title: discovery.title,
          source: sourceName,
          ok: !policy.countAsError && !discoveryUpdateError,
          error: discoveryUpdateError ?? undefined,
          fetch_status: fetchedPage.status,
          http_status: fetchedPage.httpStatus,
          fetch_outcome: policy.reason,
          retryable: policy.retryable,
          discovery_status: policy.discoveryStatus,
          database_write_skipped: true,
        });
        continue;
      }

      fetched += 1;
      const extracted = parseListingPage(
        discovery,
        sourceName,
        fetchedPage.html,
        fetchedPage.status,
        fetchedPage.httpStatus,
      );

      const decision = promotionDecision(extracted, sourceName, discovery.original_url, `${extracted.title ?? ""} ${extracted.description ?? ""}`);
      const finalStatus = decision.discoveryStatus;
      const thresholdState = thresholdOutcome(extracted.meetsValueThreshold);
      const thresholdMinimum = minimumThreshold(extracted.transactionType);

      // Raw discoveries remain the audit trail. Only commercially eligible
      // owner listings are promoted into normalized properties, listings and
      // contacts. Price alone is never sufficient anymore for rejection —
      // an unconfirmed price is promoted with price_confidence:"unconfirmed"
      // instead of being discarded (explicit product decision).
      if (!decision.promote) {
        databaseWriteSkipped += 1;

        const discoveryUpdateError = await updateDiscoveryAfterEnrichment(
          db,
          discovery,
          extracted,
          finalStatus,
          {
            final_url: fetchedPage.finalUrl,
            threshold_outcome: thresholdState,
            minimum_value_threshold: thresholdMinimum,
            pipeline_outcome: "not_promoted",
            rejection_reason: decision.reason,
            price_confidence: decision.priceConfidence,
            database_write_skipped: true,
          },
        );

        if (discoveryUpdateError) errors += 1;
        enriched += 1;

        results.push({
          discovery_id: discovery.id,
          source: sourceName,
          ok: !discoveryUpdateError,
          error: discoveryUpdateError ?? undefined,
          title: extracted.title,
          transaction_type: extracted.transactionType,
          transaction_mismatch: extracted.transactionMismatch,
          price: extracted.price,
          minimum_value_threshold: thresholdMinimum,
          meets_value_threshold: extracted.meetsValueThreshold,
          threshold_outcome: thresholdState,
          pipeline_outcome: "not_promoted",
          rejection_reason: decision.reason,
          price_confidence: decision.priceConfidence,
          discovery_status: finalStatus,
          database_write_skipped: true,
          city: extracted.city,
          neighborhood: extracted.neighborhood,
          area_m2: extracted.areaM2,
          bedrooms: extracted.bedrooms,
          suites: extracted.suites,
          bathrooms: extracted.bathrooms,
          parking_spaces: extracted.parkingSpaces,
          advertiser_name: extracted.advertiserName,
          advertiser_classification: extracted.advertiserClassification,
          phone_found: Boolean(extracted.phoneNormalized),
          phone_trusted: false,
          phone_identity_conflict: false,
          whatsapp_status: "not_confirmed",
          listing_status: extracted.listingStatus,
          structured_data_found: extracted.structuredDataFound,
          source_evidence: extracted.sourceEvidence,
          contact_error: null,
        });
        continue;
      }

      const { data: existingListingRows } = await db
        .from("lj_v2_listings")
        .select("id,property_id")
        .eq("original_url", discovery.original_url)
        .limit(1);

      const existingListing = existingListingRows?.[0] as
        | { id: string; property_id: string | null }
        | undefined;

      const propertyWrite = await upsertProperty(
        db,
        discovery,
        extracted,
        existingListing?.property_id ?? null,
      );

      if (propertyWrite.error || !propertyWrite.id) {
        errors += 1;
        await updateDiscoveryAfterEnrichment(db, discovery, extracted, "error", {
          error: "property_write_failed",
          details: propertyWrite.error,
          retryable: true,
          database_write_skipped: true,
        });
        results.push({
          discovery_id: discovery.id,
          title: extracted.title,
          source: sourceName,
          ok: false,
          error: "property_write_failed",
          details: propertyWrite.error,
        });
        continue;
      }

      propertiesWritten += 1;

      const listingWrite = await upsertListing(db, discovery, extracted, propertyWrite.id, decision.priceConfidence);
      if (listingWrite.error || !listingWrite.id) {
        errors += 1;
        await updateDiscoveryAfterEnrichment(db, discovery, extracted, "error", {
          error: "listing_write_failed",
          details: listingWrite.error,
          retryable: true,
          database_write_skipped: true,
        });
        results.push({
          discovery_id: discovery.id,
          title: extracted.title,
          source: sourceName,
          ok: false,
          error: "listing_write_failed",
          details: listingWrite.error,
        });
        continue;
      }

      if (listingWrite.existed) listingsUpdated += 1;
      else listingsCreated += 1;

      const contactWrite = await upsertContact(db, discovery, extracted, listingWrite.id);
      if (contactWrite.error) {
        errors += 1;
      } else if (contactWrite.contactId) {
        contactsLinked += 1;
      }

      const discoveryUpdateError = await updateDiscoveryAfterEnrichment(
        db,
        discovery,
        extracted,
        finalStatus,
        {
          listing_id: listingWrite.id,
          property_id: propertyWrite.id,
          contact_id: contactWrite.contactId,
          contact_error: contactWrite.error,
          phone_identity_conflict: contactWrite.phoneIdentityConflict,
          phone_trusted: contactWrite.phoneTrusted,
          effective_whatsapp_status: contactWrite.effectiveWhatsappStatus,
          final_url: fetchedPage.finalUrl,
          threshold_outcome: thresholdState,
          minimum_value_threshold: thresholdMinimum,
          pipeline_outcome: "promoted",
          promotion_reason: decision.reason,
          price_confidence: decision.priceConfidence,
          retryable: Boolean(contactWrite.error),
        },
      );

      if (discoveryUpdateError) errors += 1;
      enriched += 1;

      results.push({
        discovery_id: discovery.id,
        listing_id: listingWrite.id,
        property_id: propertyWrite.id,
        contact_id: contactWrite.contactId,
        source: sourceName,
        ok: true,
        title: extracted.title,
        transaction_type: extracted.transactionType,
        transaction_mismatch: extracted.transactionMismatch,
        price: extracted.price,
        minimum_value_threshold: thresholdMinimum,
        meets_value_threshold: extracted.meetsValueThreshold,
        threshold_outcome: thresholdState,
        pipeline_outcome: "promoted",
        promotion_reason: decision.reason,
        price_confidence: decision.priceConfidence,
        discovery_status: finalStatus,
        city: extracted.city,
        neighborhood: extracted.neighborhood,
        area_m2: extracted.areaM2,
        bedrooms: extracted.bedrooms,
        suites: extracted.suites,
        bathrooms: extracted.bathrooms,
        parking_spaces: extracted.parkingSpaces,
        advertiser_name: extracted.advertiserName,
        advertiser_classification: extracted.advertiserClassification,
        phone_found: Boolean(extracted.phoneNormalized),
        phone_trusted: contactWrite.phoneTrusted,
        phone_identity_conflict: contactWrite.phoneIdentityConflict,
        whatsapp_status: contactWrite.effectiveWhatsappStatus,
        listing_status: extracted.listingStatus,
        structured_data_found: extracted.structuredDataFound,
        source_evidence: extracted.sourceEvidence,
        contact_error: contactWrite.error,
      });
    }

    return jsonResponse({
      ok: errors === 0,
      function: FUNCTION_NAME,
      version: VERSION,
      status: errors === 0 ? "completed" : enriched > 0 ? "partial" : "failed",
      selection,
      counters: {
        selected: discoveries.length,
        fetched,
        enriched,
        listings_created: listingsCreated,
        listings_updated: listingsUpdated,
        properties_written: propertiesWritten,
        contacts_linked: contactsLinked,
        skipped_before_fetch: skippedBeforeFetch,
        fetch_skipped: fetchSkipped,
        database_write_skipped: databaseWriteSkipped,
        errors,
      },
      results,
    });
  },
};



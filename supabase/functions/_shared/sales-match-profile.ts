/**
 * Lógica compartilhada de extração de critérios de busca (Match Comercial).
 *
 * Usada por:
 *  - lji-sales-match-profile-v1  (disparo manual, botão "Extrair busca + Match")
 *  - lji-whatsapp-webhook-v1     (disparo automático ao receber mensagem)
 *
 * Existe como módulo único justamente para que os dois caminhos apliquem as
 * MESMAS regras de heurística, o MESMO prompt e a MESMA sanitização de saída.
 * Antes da v22.48 essa lógica estava duplicada nos dois arquivos e havia
 * divergido (o webhook não sanitizava a resposta da IA nem validava o erro
 * do update em lji_buyers).
 */

export type Profile = {
  intent_role: "buyer" | "seller" | "unknown";
  transaction_type: "sale" | "rent" | "both" | null;
  city: string | null;
  neighborhood: string | null;
  property_type: string | null;
  budget_max: number | null;
  bedrooms_min: number | null;
  parking_min: number | null;
  area_min: number | null;
  urgency: number | null;
  timeline_days: number | null;
  must_haves: string[];
  avoid: string[];
  explicit_fields: string[];
  source_evidence: Record<string, string>;
  summary: string;
  confidence: "strong" | "partial" | "limited";
};

export type ConversationRow = { event_type: string; details?: any; created_at?: string };

const PROFILE_FIELDS = [
  "transaction_type",
  "city",
  "neighborhood",
  "property_type",
  "budget_max",
  "bedrooms_min",
  "parking_min",
  "area_min",
  "urgency",
  "timeline_days",
] as const;

/** Trim + cap length; returns null for empty/non-string input. */
export function clean(v: unknown, max = 120): string | null {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, max) : null;
}

/** Coerce to a finite, positive number, or null. */
export function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function parseMoney(raw: string): number | null {
  const t = raw.toLowerCase().replace(/r\$/g, "").replace(/\s+/g, " ");
  const pats = [
    /(?:at[eé]|m[aá]ximo|max|or[cç]amento|valor)?\s*(\d{1,3}(?:[.,]\d{1,3})?)\s*(milh(?:a|ã)o|milh[oõ]es|mi|mil)\b/,
    /(?:at[eé]|m[aá]ximo|max|or[cç]amento|valor)\D{0,12}(\d{3,}(?:[.,]\d{2})?)/,
  ];
  for (const p of pats) {
    const m = t.match(p);
    if (!m) continue;
    let n = Number(m[1].replace(/\./g, "").replace(",", "."));
    const u = m[2] || "";
    if (/milh|\bmi\b/.test(u)) n *= 1_000_000;
    else if (u === "mil") n *= 1_000;
    if (Number.isFinite(n) && n >= 10000) return Math.round(n);
  }
  return null;
}

/** Regex-only fallback used when there's no API key or the model call fails. */
export function heuristicProfile(transcript: string, lead: any): Profile {
  const t = transcript.toLowerCase();
  const explicit: string[] = [];
  const evidence: Record<string, string> = {};

  let role: "buyer" | "seller" | "unknown" =
    /\b(procuro|procurando|quero comprar|quero alugar|busco|tenho interesse em comprar|tenho interesse em alugar)\b/.test(t)
      ? "buyer"
      : /\b(quero vender|estou vendendo|meu im[oó]vel|sou propriet[aá]rio)\b/.test(t)
        ? "seller"
        : String(lead?.entity_type || "") === "buyer" || String(lead?.entity_type || "") === "buyer_intent"
          ? "buyer"
          : String(lead?.entity_type || "") === "opportunity"
            ? "seller"
            : "unknown";

  let tx: "sale" | "rent" | "both" | null = null;
  if (/\b(alugar|aluguel|loca[cç][aã]o|locar)\b/.test(t)) {
    tx = "rent";
    explicit.push("transaction_type");
  }
  if (/\b(comprar|compra|aquisi[cç][aã]o)\b/.test(t)) {
    tx = tx === "rent" ? "both" : "sale";
    if (!explicit.includes("transaction_type")) explicit.push("transaction_type");
  }

  let type: string | null = null;
  for (const [re, v] of [
    [/\bapartamento|apto\b/, "Apartamento"],
    [/\bcasa|sobrado\b/, "Casa"],
    [/\bstudio\b/, "Studio"],
    [/\bkitnet|flat\b/, "Kitnet"],
    [/\bcobertura\b/, "Cobertura"],
  ] as [RegExp, string][]) {
    if (re.test(t)) {
      type = v;
      explicit.push("property_type");
      break;
    }
  }

  let city: string | null = null;
  for (const [re, v] of [
    [/s[aã]o caetano(?: do sul)?/, "São Caetano do Sul"],
    [/s[aã]o bernardo(?: do campo)?/, "São Bernardo do Campo"],
    [/santo andr[eé]/, "Santo André"],
    [/diadema/, "Diadema"],
  ] as [RegExp, string][]) {
    if (re.test(t)) {
      city = v;
      explicit.push("city");
      break;
    }
  }

  const budget = parseMoney(t);
  if (budget) explicit.push("budget_max");

  const bed = t.match(/(\d+)\s*(?:dormit[oó]rios?|dorms?|quartos?)/);
  const park = t.match(/(\d+)\s*vagas?/);
  const area = t.match(/(\d{2,4})\s*m(?:²|2)\b/);
  const beds = bed ? Number(bed[1]) : null;
  const parking = park ? Number(park[1]) : null;
  const areaMin = area ? Number(area[1]) : null;
  if (beds) explicit.push("bedrooms_min");
  if (parking) explicit.push("parking_min");
  if (areaMin) explicit.push("area_min");

  let urgency: number | null = null;
  let timeline: number | null = null;
  if (/\b(urgente|essa semana|o quanto antes|imediat)\b/.test(t)) {
    urgency = 3;
    timeline = 7;
    explicit.push("urgency", "timeline_days");
  } else if (/\b(este m[eê]s|30 dias|um m[eê]s)\b/.test(t)) {
    urgency = 3;
    timeline = 30;
    explicit.push("urgency", "timeline_days");
  } else if (/\b(60 dias|dois meses|2 meses)\b/.test(t)) {
    urgency = 2;
    timeline = 60;
    explicit.push("urgency", "timeline_days");
  }

  return {
    intent_role: role,
    transaction_type: tx,
    city,
    neighborhood: null,
    property_type: type,
    budget_max: budget,
    bedrooms_min: beds,
    parking_min: parking,
    area_min: areaMin,
    urgency,
    timeline_days: timeline,
    must_haves: [],
    avoid: [],
    explicit_fields: [...new Set(explicit)],
    source_evidence: evidence,
    summary: explicit.length
      ? "Critérios objetivos extraídos da conversa real; campos ausentes permanecem não informados."
      : "A conversa ainda não contém critérios objetivos suficientes para enriquecer a busca.",
    confidence: explicit.length >= 4 ? "strong" : explicit.length >= 1 ? "partial" : "limited",
  };
}

/**
 * Sanitizes/validates a raw (untrusted) object — typically parsed straight
 * from the model's JSON response — into a well-typed Profile. This is the
 * single place that enforces types, ranges and string lengths before a
 * profile is stored or used to update lji_buyers, regardless of which
 * caller (manual or automatic) produced it.
 */
export function normalizeProfile(p: any): Profile {
  const allowedTx = ["sale", "rent", "both"];
  const allowedRole = ["buyer", "seller", "unknown"];
  const allowedConf = ["strong", "partial", "limited"];

  const explicit = Array.isArray(p?.explicit_fields)
    ? p.explicit_fields.filter((x: any) => (PROFILE_FIELDS as readonly string[]).includes(String(x)))
    : [];

  const evidence: Record<string, string> = {};
  if (p?.source_evidence && typeof p.source_evidence === "object") {
    for (const k of explicit) {
      const v = clean(p.source_evidence[k], 90);
      if (v) evidence[k] = v;
    }
  }

  return {
    intent_role: allowedRole.includes(p?.intent_role) ? p.intent_role : "unknown",
    transaction_type: allowedTx.includes(p?.transaction_type) ? p.transaction_type : null,
    city: clean(p?.city),
    neighborhood: clean(p?.neighborhood),
    property_type: clean(p?.property_type),
    budget_max: num(p?.budget_max),
    bedrooms_min: num(p?.bedrooms_min),
    parking_min: num(p?.parking_min),
    area_min: num(p?.area_min),
    urgency: num(p?.urgency) ? Math.max(1, Math.min(3, Math.round(Number(p.urgency)))) : null,
    timeline_days: num(p?.timeline_days) ? Math.min(3650, Math.round(Number(p.timeline_days))) : null,
    must_haves: Array.isArray(p?.must_haves)
      ? (p.must_haves.map((x: any) => clean(x, 80)).filter(Boolean) as string[]).slice(0, 8)
      : [],
    avoid: Array.isArray(p?.avoid)
      ? (p.avoid.map((x: any) => clean(x, 80)).filter(Boolean) as string[]).slice(0, 8)
      : [],
    explicit_fields: explicit,
    source_evidence: evidence,
    summary: clean(p?.summary, 240) || "Critérios extraídos da conversa real.",
    confidence: allowedConf.includes(p?.confidence) ? p.confidence : "partial",
  };
}

function conversationTranscript(rows: ConversationRow[], limit = 14000): string {
  return rows
    .map((e) => `${e.event_type === "whatsapp_message_received" ? "CLIENTE" : "EQUIPE"}: ${String(e.details?.text || "")}`)
    .join("\n")
    .slice(-limit);
}

/**
 * Runs the extraction: tries Claude first (if ANTHROPIC_API_KEY is set),
 * always falls back to the regex heuristic on any failure — missing key,
 * HTTP error, or malformed JSON. The returned profile is ALWAYS the output
 * of `normalizeProfile`, so callers never need to sanitize it themselves.
 */
export async function extractProfileWithClaude(
  rows: ConversationRow[],
  lead: any
): Promise<{ profile: Profile; engine: string }> {
  const clientText = rows
    .filter((e) => e.event_type === "whatsapp_message_received")
    .map((e) => String(e.details?.text || ""))
    .join("\n");
  const fallback = heuristicProfile(clientText, lead);

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key || !rows.length) return { profile: fallback, engine: "heuristic_fallback" };

  const model = Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-4-5";
  const system = `Você extrai requisitos imobiliários de conversas reais para o LJ Sales. REGRA ABSOLUTA: nunca invente, complete ou deduza um critério que o CLIENTE não declarou. Mensagens da EQUIPE podem dar contexto, mas um campo só entra em explicit_fields se o CLIENTE confirmou ou informou aquele valor. Use null quando ausente. intent_role: buyer, seller ou unknown. transaction_type: sale, rent, both ou null. property_type em português. urgency 1..3 somente se houver prazo/timing explícito. source_evidence deve conter trechos curtos do CLIENTE (máx 90 caracteres por campo). Retorne SOMENTE JSON válido com: intent_role, transaction_type, city, neighborhood, property_type, budget_max, bedrooms_min, parking_min, area_min, urgency, timeline_days, must_haves[], avoid[], explicit_fields[], source_evidence{}, summary, confidence (strong|partial|limited).`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: 900,
        temperature: 0,
        system,
        messages: [{ role: "user", content: `LEAD VINCULADO: ${JSON.stringify(lead)}\nCONVERSA CRONOLÓGICA:\n${conversationTranscript(rows)}` }],
      }),
    });
    if (!r.ok) return { profile: fallback, engine: "heuristic_fallback" };
    const out = await r.json();
    const raw = String(out?.content?.find((x: any) => x.type === "text")?.text || "").trim();
    const parsed = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, ""));
    return { profile: normalizeProfile(parsed), engine: `anthropic:${model}` };
  } catch (e) {
    console.error("extractProfileWithClaude failed, using heuristic fallback", e);
    return { profile: fallback, engine: "heuristic_fallback" };
  }
}

/**
 * Applies the explicit fields of a Profile onto lji_buyers. Only writes
 * fields the client actually stated (per `profile.explicit_fields`), and
 * throws on a Supabase error instead of silently ignoring it — the caller
 * decides how to handle/report the failure.
 */
export async function updateBuyerFromExplicit(
  admin: any,
  workspace: string,
  entityId: string,
  p: Profile
): Promise<{ updated: boolean; fields: string[] }> {
  const update: any = {};
  const has = (k: string) => p.explicit_fields.includes(k);
  if (has("city") && p.city) update.city = p.city;
  if (has("neighborhood") && p.neighborhood) update.neighborhood = p.neighborhood;
  if (has("property_type") && p.property_type) update.property_type = p.property_type;
  if (has("transaction_type") && p.transaction_type) update.transaction_type = p.transaction_type;
  if (has("budget_max") && p.budget_max) update.budget_max = p.budget_max;
  if (has("bedrooms_min") && p.bedrooms_min !== null) update.bedrooms_min = p.bedrooms_min;
  if (has("parking_min") && p.parking_min !== null) update.parking_min = p.parking_min;
  if (has("area_min") && p.area_min !== null) update.area_min = p.area_min;
  if (has("urgency") && p.urgency) update.urgency = p.urgency;

  if (!Object.keys(update).length) return { updated: false, fields: [] };

  const { error } = await admin
    .from("lji_buyers")
    .update(update)
    .eq("workspace_id", workspace)
    .eq("id", entityId)
    .eq("status", "active");
  if (error) throw error;
  return { updated: true, fields: Object.keys(update) };
}

/**
 * Fetches the existing cadastral profile for a lead (buyer or buyer_intent)
 * so it can be handed to the model as context — mirrors what the frontend's
 * `ljiMatchProfileBase` sends on the manual path, so the automatic path gets
 * the same context instead of extracting "in the dark".
 * Returns null for any other entity type (e.g. opportunity/seller).
 */
export async function fetchExistingProfile(admin: any, workspace: string, lead: { entity_type: string; entity_id: string }) {
  if (lead.entity_type === "buyer") {
    const { data: b } = await admin
      .from("lji_buyers")
      .select("name,city,neighborhood,type,transaction_type,budget,beds,parking,area_min,urgency,contact,source")
      .eq("workspace_id", workspace)
      .eq("id", lead.entity_id)
      .maybeSingle();
    if (!b) return null;
    return {
      name: b.name || "",
      city: b.city || "",
      neighborhood: b.neighborhood || "",
      type: b.type || "",
      transaction_type: b.transaction_type || "",
      budget: Number(b.budget || 0),
      beds: Number(b.beds || 0),
      parking: Number(b.parking || 0),
      area_min: Number(b.area_min || 0),
      urgency: Number(b.urgency || 2),
      contact: b.contact || "",
      source: b.source || "Cadastro interno",
    };
  }
  if (lead.entity_type === "buyer_intent") {
    const { data: i } = await admin
      .from("lji_buyer_intents")
      .select("person_name,title,city,region,neighborhood,property_type,transaction_type,budget_max,bedrooms_min,parking_min,area_min,urgency,contact,source_name")
      .eq("workspace_id", workspace)
      .eq("id", lead.entity_id)
      .maybeSingle();
    if (!i) return null;
    return {
      name: i.person_name || i.title || "",
      city: i.city || i.region || "",
      neighborhood: i.neighborhood || "",
      type: i.property_type || "",
      transaction_type: i.transaction_type || "",
      budget: Number(i.budget_max || 0),
      beds: Number(i.bedrooms_min || 0),
      parking: Number(i.parking_min || 0),
      area_min: Number(i.area_min || 0),
      urgency: Number(i.urgency || 2),
      contact: i.contact || "",
      source: i.source_name || "Radar de Intenção",
    };
  }
  return null;
}

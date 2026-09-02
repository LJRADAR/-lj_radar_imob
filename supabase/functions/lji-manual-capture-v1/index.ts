// ============================================================
// LJ RADAR - CAPTURA MANUAL DE LINK
// Function: lji-manual-capture-v1
// Version: 1.0.0
//
// Recebe um link colado pelo usuário (Facebook, Instagram, OLX,
// Threads, X, Telegram, TikTok, YouTube ou web aberta) e o faz
// percorrer EXATAMENTE o mesmo pipeline das capturas automáticas:
//
//   lj_v2_raw_discoveries -> enriquecedor-lj-v2
//     -> verificador-quinto-lj -> oportunidades_lj
//
// Nada é inventado: todo dado (preço, telefone, WhatsApp, endereço)
// vem da extração da própria página, feita pelo enriquecedor.
// Se o post for de alguém PROCURANDO imóvel, vira intenção de compra
// em lji_buyer_intents em vez de oportunidade.
// ============================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const FUNCTION_NAME = "lji-manual-capture-v1";
const VERSION = "1.0.0";
const NAMED_SECRET_KEY = "radar_lj_v2_collector";
const WORKSPACE_ID = "85720ad0-428b-4e08-b562-e9a4d00fcc30";
const SALE_COMMISSION_RATE = 0.0125;
const PAGE_TIMEOUT_MS = 12000;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")?.trim() ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY")?.trim() ?? "";

type Tx = "sale" | "rent";
type Json = Record<string, unknown>;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reply(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

const norm = (v: unknown) =>
  String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const txt = (v: unknown) => {
  const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  return s || null;
};
const num = (v: unknown) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function namedSecret(): string {
  try {
    const parsed = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}") as Json;
    const v = parsed[NAMED_SECRET_KEY];
    return typeof v === "string" ? v.trim() : "";
  } catch {
    return "";
  }
}

function adminClient() {
  const key = namedSecret();
  if (!SUPABASE_URL || !key) return null;
  return createClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function normalizeUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    for (const k of [...u.searchParams.keys()]) {
      const lk = k.toLowerCase();
      if (lk.startsWith("utm_") || ["fbclid", "gclid", "mc_cid", "mc_eid", "ref", "referrer", "igshid", "si"].includes(lk)) {
        u.searchParams.delete(k);
      }
    }
    if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, "");
    u.searchParams.sort();
    return u.toString();
  } catch {
    return null;
  }
}

async function sha256(v: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// Mesma nomenclatura de fonte usada pelo coletor automático, para que o link
// manual apareça no sistema com a mesma origem dos capturados pelo robô.
function sourceNameFor(url: string): string {
  try {
    const u = new URL(url);
    const h = u.hostname.replace(/^www\./, "").toLowerCase();
    const p = u.pathname.toLowerCase();
    if (h.endsWith("olx.com.br")) return "OLX Imóveis";
    if (h.endsWith("facebook.com") && p.includes("/marketplace/item/")) return "Facebook Marketplace";
    if (h.endsWith("facebook.com")) return "Facebook Grupos Públicos";
    if (h.endsWith("instagram.com")) return "Instagram público";
    if (h.endsWith("threads.net") || h.endsWith("threads.com")) return "Threads público";
    if (h === "t.me" || h.endsWith("telegram.me")) return "Telegram público";
    return "Web aberta com contato";
  } catch {
    return "Web aberta com contato";
  }
}

function platformLabel(url: string): string {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    if (h.endsWith("olx.com.br")) return "OLX";
    if (h.endsWith("facebook.com")) return "Facebook";
    if (h.endsWith("instagram.com")) return "Instagram";
    if (h.endsWith("threads.net") || h.endsWith("threads.com")) return "Threads";
    if (h === "x.com" || h.endsWith("twitter.com")) return "X";
    if (h === "t.me" || h.endsWith("telegram.me")) return "Telegram";
    if (h.endsWith("tiktok.com")) return "TikTok";
    if (h.endsWith("youtube.com") || h === "youtu.be") return "YouTube";
    if (h.endsWith("linkedin.com")) return "LinkedIn";
    return h;
  } catch {
    return "link";
  }
}

// Domínios que cobram para exibir o contato do anunciante: capturar de lá não
// gera lead acionável. Mesma lista aplicada pelo coletor e pelo enriquecedor.
const BLOCKED = [
  "proprietariodireto.com.br", "rentola.com.br", "waa2.com.br", "achoumudou.com.br",
  "mgfimoveis.com.br", "quintoandar.com.br", "zapimoveis.com.br", "vivareal.com.br",
  "imovelweb.com.br", "chavesnamao.com.br", "wimoveis.com.br", "loft.com.br",
];
function blockedDomain(url: string) {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return BLOCKED.some((d) => h === d || h.endsWith("." + d));
  } catch {
    return true;
  }
}

async function fetchPageText(url: string): Promise<{ ok: boolean; text: string; status: number | null }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PAGE_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; LJ-Radar-Manual/1.0)",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "pt-BR,pt;q=0.9",
      },
    });
    if (!r.ok) return { ok: false, text: "", status: r.status };
    const html = await r.text();
    const clean = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    // og:title/description costumam ser a única parte legível em redes sociais.
    const metas = [...html.matchAll(/<meta[^>]+(?:property|name)=["'](?:og:title|og:description|description)["'][^>]+content=["']([^"']+)["']/gi)]
      .map((m) => m[1]).join(" ");
    return { ok: true, text: `${metas} ${clean}`.slice(0, 40000), status: r.status };
  } catch {
    return { ok: false, text: "", status: null };
  } finally {
    clearTimeout(t);
  }
}

function detectTransaction(text: string, url: string): Tx {
  const n = norm(`${url} ${text}`);
  const rent = (n.match(/\b(aluguel|alugar|aluga-se|alugo|locacao|para locacao|por mes|mensais)\b/g) || []).length;
  const sale = (n.match(/\b(venda|vendo|vende-se|a venda|comprar|compra)\b/g) || []).length;
  return rent > sale ? "rent" : "sale";
}

const CITIES = [
  "São Caetano do Sul", "São Bernardo do Campo", "Santo André", "Diadema",
  "Mauá", "Ribeirão Pires", "Rio Grande da Serra", "São Paulo",
];
function detectCity(text: string, url: string): string | null {
  const n = norm(`${text} ${url}`);
  // Ordem importa: "São Caetano" antes de "São Paulo" evita casar a capital
  // num texto que menciona apenas o estado.
  for (const c of CITIES) if (n.includes(norm(c))) return c;
  if (/\bsao caetano\b/.test(n)) return "São Caetano do Sul";
  if (/\bsao bernardo\b/.test(n)) return "São Bernardo do Campo";
  if (/\bsbc\b/.test(n)) return "São Bernardo do Campo";
  return null;
}

function detectPropertyType(text: string): string | null {
  const n = norm(text);
  if (/\b(apartamento|apto)\b/.test(n)) return "Apartamento";
  if (/\b(casa|sobrado)\b/.test(n)) return "Casa";
  if (/\bcobertura\b/.test(n)) return "Cobertura";
  if (/\b(studio|kitnet|kitchenette)\b/.test(n)) return "Studio";
  if (/\b(terreno|lote)\b/.test(n)) return "Terreno";
  if (/\b(sala comercial|loja|galpao|ponto comercial)\b/.test(n)) return "Comercial";
  return null;
}

// Post de quem PROCURA imóvel (não anuncia) vira intenção de compra.
function isBuyerIntent(text: string): boolean {
  return /\b(procuro|busco|estou procurando|quero comprar|quero alugar|preciso de (?:casa|apartamento|imovel)|alguem tem (?:casa|apartamento|imovel)|alguem indica)\b/.test(norm(text));
}

function extractPhone(text: string): string | null {
  for (const re of [
    /(?:whats(?:app)?|telefone|celular|contato|zap|fone)\D{0,28}(\(?\d{2}\)?\D*)?(9?\d{4}\D?\d{4})/i,
    /\b(\d{2}\s*9\d{4}[-\s]?\d{4})\b/,
  ]) {
    const m = text.match(re);
    if (!m) continue;
    const d = (m.length > 2 ? `${m[1] || ""}${m[2] || ""}` : m[1]).replace(/\D/g, "");
    if (d.length === 10 || d.length === 11) return d;
  }
  return null;
}

function whatsappLink(phoneNormalized: string | null): string | null {
  if (!phoneNormalized) return null;
  let d = phoneNormalized.replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (d.length !== 13 || !d.startsWith("55") || d[4] !== "9") return null;
  return `https://wa.me/${d}`;
}

async function callFn(fn: string, payload: unknown): Promise<Json> {
  const key = namedSecret();
  const r = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await r.json().catch(() => ({}))) as Json;
  if (!r.ok) throw new Error(`${fn} HTTP ${r.status}: ${txt(data.error) ?? JSON.stringify(data).slice(0, 200)}`);
  return data;
}

function opportunityScore(c: Json): number {
  let s = 45;
  if (c.advertiser_classification === "confirmed_owner") s += 15;
  else if (c.advertiser_classification === "probable_owner") s += 10;
  if (c.phone_trusted) s += 15;
  else if (c.phone_found) s += 5;
  if (c.whatsapp_status === "confirmed") s += 10;
  else if (c.whatsapp_status === "probable") s += 5;
  if (c.address) s += 5;
  if (c.listing_status === "active") s += 5;
  if (c.price !== null && c.price !== undefined) s += 5;
  return Math.min(100, s);
}

function classify(c: Json, verification: Json, score: number) {
  const qa = num(verification.confidence) ?? 0;
  const confirmed = c.advertiser_classification === "confirmed_owner";
  const ownerish = confirmed || c.advertiser_classification === "probable_owner";
  const active = c.listing_status === "active";
  if (confirmed && c.phone_trusted && active && qa >= 75) return { code: "fire_green", label: "🔥 VERDE" };
  if (ownerish && active && (c.phone_trusted || score >= 80)) return { code: "green", label: "VERDE" };
  if (score >= 55) return { code: "yellow", label: "AMARELO" };
  return { code: "red", label: "VERMELHO" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const body = (await req.json().catch(() => ({}))) as Json;

  if (body.action === "health") {
    return reply({
      ok: true, function: FUNCTION_NAME, version: VERSION,
      pipeline: ["lj_v2_raw_discoveries", "enriquecedor-lj-v2", "verificador-quinto-lj", "oportunidades_lj"],
      platforms: ["Facebook", "Instagram", "OLX", "Threads", "X", "Telegram", "TikTok", "YouTube", "web aberta"],
      named_secret_available: Boolean(namedSecret()),
    });
  }

  const admin = adminClient();
  if (!admin) return reply({ ok: false, error: "supabase_admin_unavailable" }, 500);

  // Autenticação pela sessão do usuário no app, com a mesma permissão exigida
  // para disparar o coletor manualmente.
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth || !ANON) return reply({ ok: false, error: "auth_required" }, 401);
  const uc = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: auth } } });
  const { data: { user } } = await uc.auth.getUser();
  if (!user) return reply({ ok: false, error: "auth_required" }, 401);
  const { data: perm } = await uc.rpc("lj_v2_has_permission", { p_permission_key: "run_manual_collector" });
  if (perm !== true) return reply({ ok: false, error: "sem_permissao" }, 403);

  const url = normalizeUrl(String(body.url ?? ""));
  if (!url) return reply({ ok: false, error: "link_invalido", message: "Cole um link completo, começando com https://" }, 400);
  if (blockedDomain(url)) {
    return reply({
      ok: false, error: "dominio_bloqueado",
      message: `${platformLabel(url)} cobra para exibir o contato do anunciante ou já é um portal concorrente — não gera lead acionável.`,
    }, 400);
  }

  // Link já capturado antes (pelo robô ou manualmente): não duplica.
  const { data: dup } = await admin.from("lj_v2_raw_discoveries").select("id,metadata").eq("normalized_url", url).limit(1);
  const existingId = dup?.[0]?.id as string | undefined;

  const page = await fetchPageText(url);
  if (!page.ok && !existingId) {
    return reply({
      ok: false, error: "pagina_inacessivel", http_status: page.status,
      message: page.status === 404
        ? "A página não existe mais (o anúncio pode ter sido removido)."
        : `Não consegui abrir essa página${page.status ? ` (erro ${page.status})` : ""}. Posts de grupo fechado do Facebook e perfis privados não são acessíveis de fora.`,
    }, 422);
  }

  const pageText = page.text;
  const tx: Tx = (body.transaction_type === "rent" || body.transaction_type === "sale")
    ? body.transaction_type as Tx
    : detectTransaction(pageText, url);
  const city = txt(body.city) ?? detectCity(pageText, url);
  const propertyType = detectPropertyType(pageText);
  const sourceName = sourceNameFor(url);

  if (!city) {
    return reply({
      ok: false, error: "cidade_nao_detectada",
      message: "Não consegui identificar a cidade nesse link. Escolha a cidade e envie de novo.",
      detected: { transaction_type: tx, property_type: propertyType, platform: platformLabel(url) },
    }, 422);
  }

  // Post de quem PROCURA imóvel entra como intenção de compra, não como oportunidade.
  if (isBuyerIntent(pageText)) {
    const contact = extractPhone(pageText);
    const fingerprint = await sha256([url, city, tx, "buyer"].map(norm).join("|"));
    const { error } = await admin.from("lji_buyer_intents").upsert({
      workspace_id: WORKSPACE_ID,
      title: txt(pageText.slice(0, 140)),
      intent_text: pageText.slice(0, 1200),
      region: city, city, property_type: propertyType,
      transaction_type: tx, intent_role: "buyer",
      bedrooms_min: 0, parking_min: 0,
      source_name: sourceName, source_url: url, contact,
      captured_at: new Date().toISOString(),
      intent_score: contact ? 92 : 80, status: "active", fingerprint,
      raw_snapshot: { source: "manual_paste", captured_by: user.id, platform: platformLabel(url) },
    }, { onConflict: "workspace_id,fingerprint" });

    return reply({
      ok: !error, outcome: "buyer_intent",
      message: error ? "Falha ao salvar a intenção de compra." : "Esse post é de alguém PROCURANDO imóvel. Salvei em Radar de Intenção / Demandas de compradores.",
      detected: { platform: platformLabel(url), city, transaction_type: tx, property_type: propertyType, contact_found: Boolean(contact) },
      error: error?.message,
    }, error ? 500 : 200);
  }

  // ---- Entra no pipeline padrão -------------------------------------------
  let sourceId: string | null = null;
  {
    const { data } = await admin.from("lj_v2_sources").select("id").eq("name", sourceName).eq("is_active", true).limit(1).maybeSingle();
    sourceId = data?.id ?? null;
    if (!sourceId) {
      const { data: web } = await admin.from("lj_v2_sources").select("id").eq("name", "Web aberta com contato").eq("is_active", true).limit(1).maybeSingle();
      sourceId = web?.id ?? null;
    }
  }

  let discoveryId = existingId ?? null;
  const meta = {
    search_context: { city, transaction_type: tx, property_type_code: propertyType, manual: true },
    provider: "manual_paste",
    captured_by: user.id,
    platform: platformLabel(url),
    url_classification: "individual_candidate",
    source_name: sourceName,
  };

  if (discoveryId) {
    // Recaptura força novo enriquecimento: limpa a marca de "já enriquecido".
    await admin.from("lj_v2_raw_discoveries").update({
      detected_city: city, detected_transaction: tx, detected_property_type: propertyType,
      last_seen_at: new Date().toISOString(), discovery_status: "raw", metadata: meta,
    }).eq("id", discoveryId);
  } else {
    const ins = await admin.from("lj_v2_raw_discoveries").insert({
      source_id: sourceId, original_url: url, normalized_url: url, url_hash: await sha256(url),
      title: txt(pageText.slice(0, 160)), snippet: txt(pageText.slice(0, 600)),
      detected_state_code: "SP", detected_city: city, detected_transaction: tx,
      detected_property_type: propertyType, discovery_status: "raw", metadata: meta,
      raw_payload: { source: "manual_paste", url },
    }).select("id").single();
    if (ins.error || !ins.data?.id) {
      return reply({ ok: false, error: "falha_ao_registrar", details: ins.error?.message }, 500);
    }
    discoveryId = ins.data.id;
  }

  // 1) Enriquecimento: busca a página, extrai preço/endereço/telefone/WhatsApp
  //    e classifica proprietário x corretor.
  let enrich: Json;
  try {
    enrich = await callFn("enriquecedor-lj-v2", { action: "enrich", discovery_ids: [discoveryId], latest_run_only: false, limit: 1 });
  } catch (e) {
    return reply({ ok: false, error: "falha_enriquecimento", details: String((e as Error)?.message || e) }, 502);
  }

  const result = (Array.isArray(enrich.results) ? (enrich.results as Json[])[0] : null) ?? {};
  const detected = {
    platform: platformLabel(url), city, transaction_type: tx,
    property_type: propertyType ?? txt(result.property_type),
    title: txt(result.title), price: num(result.price),
    neighborhood: txt(result.neighborhood),
    bedrooms: num(result.bedrooms), parking_spaces: num(result.parking_spaces), area_m2: num(result.area_m2),
    advertiser: txt(result.advertiser_name),
    advertiser_classification: txt(result.advertiser_classification),
    phone_found: result.phone_found === true,
    phone_trusted: result.phone_trusted === true,
    whatsapp_status: txt(result.whatsapp_status),
    listing_status: txt(result.listing_status),
  };

  if (result.pipeline_outcome !== "promoted" || !txt(result.listing_id)) {
    const reason = txt(result.rejection_reason) ?? txt(result.fetch_outcome) ?? txt(result.prefilter_reason) ?? "nao_promovido";
    const human: Record<string, string> = {
      listing_not_active: "O anúncio consta como removido ou expirado.",
      paywall_or_named_excluded_source: "Essa fonte cobra para mostrar o contato do anunciante.",
      generic_group_page: "Esse link é da página inicial do grupo, não de um post específico. Abra o post e copie o link dele.",
      generic_social_page: "Esse link é de uma página geral da rede social, não de um post.",
      generic_social_profile: "Esse link é de um perfil, não de uma publicação. Abra a publicação e copie o link dela.",
      generic_listing_page: "Esse link é de uma página de busca/categoria, não de um anúncio individual.",
      root_page: "Esse link é da home do site, não de um anúncio.",
      source_fetch_blocked: "O site bloqueou a leitura automática dessa página.",
      listing_not_available: "A página não existe mais.",
    };
    return reply({
      ok: false, outcome: "nao_promovido", reason,
      message: human[reason] ?? "Não consegui extrair um anúncio individual desse link.",
      detected, discovery_id: discoveryId,
    }, 422);
  }

  // 2) Verificação no QuintoAndar + gravação da oportunidade, exatamente como
  //    no fluxo automático.
  const listingId = String(result.listing_id);
  const { data: listing } = await admin.from("lj_v2_listings")
    .select("id,property_id,original_url,title,description,transaction_type,price,advertised_city,advertised_neighborhood,advertised_address,advertiser_name,listing_status,published_at")
    .eq("id", listingId).limit(1).maybeSingle();
  const { data: property } = listing?.property_id
    ? await admin.from("lj_v2_properties")
        .select("property_type,city,neighborhood,canonical_address,postal_code,condominium_name,area_m2,bedrooms,suites,bathrooms,parking_spaces")
        .eq("id", listing.property_id).limit(1).maybeSingle()
    : { data: null };
  const { data: rel } = await admin.from("lj_v2_listing_contacts")
    .select("contact_id,confidence_score").eq("listing_id", listingId).eq("relationship_type", "advertiser")
    .order("is_primary", { ascending: false }).limit(1).maybeSingle();
  const { data: contact } = rel?.contact_id
    ? await admin.from("lj_v2_contacts").select("display_name,advertiser_classification,phone_raw,phone_normalized,whatsapp_status").eq("id", rel.contact_id).limit(1).maybeSingle()
    : { data: null };

  const candidate: Json = {
    listing_id: listingId,
    property_id: listing?.property_id ?? null,
    title: txt(listing?.title) ?? detected.title,
    description: txt(listing?.description),
    city: txt(property?.city) ?? txt(listing?.advertised_city) ?? city,
    neighborhood: txt(property?.neighborhood) ?? txt(listing?.advertised_neighborhood),
    address: txt(property?.canonical_address) ?? txt(listing?.advertised_address),
    postal_code: txt(property?.postal_code),
    condominium_name: txt(property?.condominium_name),
    detected_type: txt(property?.property_type),
    transaction_type: tx,
    price: num(listing?.price),
    area_m2: num(property?.area_m2), bedrooms: num(property?.bedrooms), suites: num(property?.suites),
    bathrooms: num(property?.bathrooms), parking_spaces: num(property?.parking_spaces),
    link: txt(listing?.original_url) ?? url,
    source: sourceName,
    advertiser_name: txt(listing?.advertiser_name) ?? txt(contact?.display_name),
    advertiser_classification: txt(contact?.advertiser_classification) ?? detected.advertiser_classification,
    contact_id: rel?.contact_id ?? null,
    phone_raw: txt(contact?.phone_raw),
    phone_normalized: txt(contact?.phone_normalized),
    contact_confidence: num(rel?.confidence_score),
    phone_found: Boolean(txt(contact?.phone_raw)) || detected.phone_found,
    // Telefone só é confiável quando o enriquecedor manteve o número normalizado
    // (ele o remove quando o mesmo número aparece sob anunciantes diferentes).
    phone_trusted: Boolean(txt(contact?.phone_normalized)),
    whatsapp_status: txt(contact?.whatsapp_status) ?? detected.whatsapp_status,
    listing_status: txt(listing?.listing_status),
    published_at: txt(listing?.published_at),
  };

  let verification: Json;
  try {
    verification = await callFn("verificador-quinto-lj", { action: "verify", candidate });
  } catch (e) {
    return reply({
      ok: true, outcome: "capturado_sem_verificacao",
      message: "Lead capturado, mas a verificação no QuintoAndar falhou. Ele aparece em Proprietários; a verificação roda de novo no próximo ciclo.",
      detected, listing_id: listingId, discovery_id: discoveryId,
      details: String((e as Error)?.message || e),
    });
  }

  const quintoStatus = txt(verification.status);
  if (quintoStatus !== "no_public_match_found" || verification.approved_for_pipeline !== true) {
    return reply({
      ok: true, outcome: quintoStatus === "found_on_quintoandar" ? "ja_no_quintoandar" : "verificacao_inconclusiva",
      message: quintoStatus === "found_on_quintoandar"
        ? "Esse imóvel JÁ está anunciado no QuintoAndar. Registrei o lead, mas ele não entra na lista de captação para o QuintoAndar."
        : "Não deu para confirmar se o imóvel está no QuintoAndar. O lead ficou registrado e será reavaliado.",
      detected, quinto_status: quintoStatus, quinto_confidence: num(verification.confidence),
      listing_id: listingId, discovery_id: discoveryId,
    });
  }

  const score = opportunityScore(candidate);
  const cls = classify(candidate, verification, score);
  const wa = candidate.phone_trusted ? whatsappLink(candidate.phone_normalized as string | null) : null;
  const commission = tx === "sale" && num(candidate.price) !== null
    ? Math.round((num(candidate.price) as number) * SALE_COMMISSION_RATE * 100) / 100
    : null;

  const { error: oppError } = await admin.from("oportunidades_lj").upsert({
    listing_id: listingId, property_id: candidate.property_id, contact_id: candidate.contact_id,
    title: candidate.title, link: candidate.link, source: sourceName,
    city: candidate.city, neighborhood: candidate.neighborhood, address: candidate.address,
    property_type: candidate.detected_type, transaction: tx, price: candidate.price,
    area_m2: candidate.area_m2, bedrooms: candidate.bedrooms, parking_spaces: candidate.parking_spaces,
    direct_owner: candidate.advertiser_classification === "confirmed_owner" || candidate.advertiser_classification === "probable_owner",
    advertiser_name: candidate.advertiser_name, advertiser_classification: candidate.advertiser_classification,
    phone: candidate.phone_trusted ? candidate.phone_raw : null,
    phone_normalized: candidate.phone_trusted ? candidate.phone_normalized : null,
    whatsapp_link: wa, whatsapp_status: candidate.whatsapp_status,
    contact_confidence: candidate.contact_confidence, individual_listing: true,
    confidence_score: Math.min(100, (candidate.advertiser_classification === "confirmed_owner" ? 90 : candidate.advertiser_classification === "probable_owner" ? 80 : 65) + (candidate.phone_trusted ? 5 : 0) + (candidate.whatsapp_status === "confirmed" ? 5 : 0)),
    opportunity_score: score, premium_score: 0,
    alert_level: cls.code === "fire_green" ? "hot" : cls.code === "green" ? "opportunity" : cls.code === "yellow" ? "watch" : "review",
    priority: cls.code === "fire_green" || cls.code === "green",
    classification: cls.code, classification_label: cls.label,
    quinto_status: quintoStatus, quinto_confidence: num(verification.confidence),
    approved_for_pipeline: true,
    recommended_action: cls.code === "fire_green"
      ? (wa ? "Abordar o proprietário agora pelo WhatsApp." : "Telefonar para o proprietário agora.")
      : cls.code === "green" ? "Contatar o proprietário ainda hoje."
      : cls.code === "yellow" ? "Confirmar proprietário e contato antes da abordagem."
      : "Fazer revisão manual antes de tentar contato.",
    diagnostic: `Capturado manualmente de ${platformLabel(url)} por link colado.`,
    estimated_sale_commission: commission,
    sale_commission_rate: tx === "sale" ? SALE_COMMISSION_RATE : null,
    published_at: candidate.published_at,
    captured_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    description: candidate.description, status: "new",
  }, { onConflict: "link" });

  if (oppError) {
    return reply({ ok: false, error: "falha_ao_salvar_oportunidade", details: oppError.message, detected }, 500);
  }

  return reply({
    ok: true, outcome: "oportunidade_criada",
    message: `Lead criado a partir do ${platformLabel(url)}. Classificação ${cls.label}.`,
    detected: { ...detected, whatsapp_link: wa, classification: cls.code, classification_label: cls.label, opportunity_score: score, estimated_sale_commission: commission },
    quinto_status: quintoStatus, quinto_confidence: num(verification.confidence),
    listing_id: listingId, discovery_id: discoveryId,
  });
});

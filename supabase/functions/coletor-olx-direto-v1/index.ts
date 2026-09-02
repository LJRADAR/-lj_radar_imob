// ============================================================
// LJ RADAR - COLETOR OLX DIRETO (sem busca externa)
// Function: coletor-olx-direto-v1
// Version: 1.0.0
//
// TECNICA: em vez de perguntar a um buscador externo (Tavily) "ache
// anuncio de imovel em X" -- o que devolve a PAGINA DE CATEGORIA da
// OLX como resultado, sem os links individuais -- esta funcao vai
// direto na propria pagina de categoria da OLX (que e renderizada
// no servidor, sem precisar de navegador) e le os ~50 cards de
// anuncio que ja vem prontos nela: link individual, titulo, preco,
// condominio, IPTU, m2, quartos e data de publicacao.
//
// STATUS: em teste real (02/09/2026), a OLX bloqueou a requisicao
// vinda do servidor do Supabase com HTTP 403 (Cloudflare bot
// protection por reputacao de IP, nao por cabecalho). O parser abaixo
// esta correto e testado contra o HTML real da OLX, mas o fetch()
// direto precisa passar por um proxy/residential IP para nao ser
// bloqueado -- ainda nao implementado. Ver conversa de 02/09/2026
// para o diagnostico completo.
//
// Mesmo contrato de saida do coletor-lj-v2: cria uma linha em
// lj_v2_collector_runs e devolve run_id, para poder ser chamado no
// lugar dele.
// ============================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const VERSION = "1.0.0";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")?.trim() ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY")?.trim() ?? "";
const NAMED_SECRET_KEY = "radar_lj_v2_collector";
const WORKSPACE_ID = "85720ad0-428b-4e08-b562-e9a4d00fcc30";
const PAGE_TIMEOUT_MS = 15000;

type Tx = "sale" | "rent";
type Json = Record<string, unknown>;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function reply(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload, null, 2), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
const txt = (v: unknown) => { const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : ""; return s || null; };
const num = (v: unknown) => { if (v === null || v === undefined || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

function namedSecret(): string {
  try { const p = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}") as Json; return typeof p[NAMED_SECRET_KEY] === "string" ? (p[NAMED_SECRET_KEY] as string).trim() : ""; } catch { return ""; }
}
function adminClient() {
  const key = namedSecret();
  if (!SUPABASE_URL || !key) return null;
  return createClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
async function allowed(req: Request) {
  const apikey = txt(req.headers.get("apikey"));
  const named = namedSecret();
  if (named && apikey === named) return { ok: true, mode: "secret", user: null as string | null };
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth || !ANON) return { ok: false, mode: "none", user: null };
  const uc = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: auth } } });
  const { data: { user } } = await uc.auth.getUser();
  if (!user) return { ok: false, mode: "user", user: null };
  const { data: perm } = await uc.rpc("lj_v2_has_permission", { p_permission_key: "run_manual_collector" });
  return { ok: perm === true, mode: "user", user: user.id };
}
function slug(s: string) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
// Mapa das cidades que operamos hoje. "Sao Paulo Zona X" ainda nao tem um
// caminho unico na OLX (ela organiza por bairro, nao por zona) -- por isso
// cai no fallback so-cidade (sao-paulo-e-regiao/sao-paulo), cobrindo a
// capital inteira em vez da zona especifica. Ajuste fino fica para quando
// tivermos uma lista de bairros por zona.
const CITY_PATH: Record<string, string> = {
  "santo andre": "santo-andre",
  "sao bernardo do campo": "sao-bernardo-do-campo",
  "sao caetano do sul": "sao-caetano-do-sul",
  "diadema": "diadema",
  "maua": "maua",
  "ribeirao pires": "ribeirao-pires",
  "rio grande da serra": "rio-grande-da-serra",
  "sao paulo": "sao-paulo",
};
function cityPath(city: string): string | null {
  const n = city.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  if (CITY_PATH[n]) return CITY_PATH[n];
  if (n.startsWith("sao paulo")) return CITY_PATH["sao paulo"]; // cobre "Sao Paulo Zona X"/"Centro Expandido"
  return null;
}
function propertyPath(code: string | null): string {
  const c = (code ?? "").toLowerCase();
  if (c.includes("casa") || c.includes("sobrado")) return "casas";
  return "apartamentos"; // padrao: cobre apartamento/studio/kitnet/cobertura, que a OLX agrupa junto
}
function buildUrl(state: string, city: string, tx: Tx, ptype: string | null, page: number): string | null {
  const cp = cityPath(city);
  if (!cp || state !== "SP") return null; // por ora, so cobrimos SP -- onde opera o negocio
  const txPath = tx === "rent" ? "aluguel" : "venda";
  const base = `https://www.olx.com.br/imoveis/${txPath}/${propertyPath(ptype)}/estado-sp/sao-paulo-e-regiao/${cp}`;
  return page > 1 ? `${base}?o=${page}` : base;
}

type Card = {
  url: string; adId: string; title: string | null;
  price: number | null; condo: number | null; iptu: number | null;
  areaM2: number | null; bedrooms: number | null; parking: number | null;
  neighborhood: string | null; publishedAt: string | null;
};

// Converte "Hoje, 05:12" / "Ontem, 21:16" / "26 de ago, 18:47" para ISO,
// usando o fuso de Sao Paulo como referencia do "hoje".
function parseRelativeDate(raw: string): string | null {
  const now = new Date();
  const hojeSp = new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const m = raw.match(/(Hoje|Ontem),\s*(\d{1,2}):(\d{2})/i);
  if (m) {
    const base = new Date(hojeSp);
    if (/ontem/i.test(m[1])) base.setDate(base.getDate() - 1);
    base.setHours(Number(m[2]), Number(m[3]), 0, 0);
    return base.toISOString();
  }
  const meses: Record<string, number> = { jan: 0, fev: 1, mar: 2, abr: 3, mai: 4, jun: 5, jul: 6, ago: 7, set: 8, out: 9, nov: 10, dez: 11 };
  const m2 = raw.match(/(\d{1,2})\s+de\s+([a-z]{3})[a-z]*,\s*(\d{1,2}):(\d{2})/i);
  if (m2) {
    const mes = meses[m2[2].toLowerCase().slice(0, 3)];
    if (mes !== undefined) {
      const d = new Date(hojeSp.getFullYear(), mes, Number(m2[1]), Number(m2[3]), Number(m2[4]));
      if (d.getTime() > hojeSp.getTime()) d.setFullYear(d.getFullYear() - 1); // "31 de dez" apos virada de ano
      return d.toISOString();
    }
  }
  return null;
}

// Estrategia de leitura: a OLX nao expoe API, entao lemos o proprio HTML.
// Em vez de depender de nomes de classe CSS (que mudam sem aviso a cada
// atualizacao de layout), ancoramos pelo padrao mais estavel que existe: o
// link do anuncio individual sempre termina em "-<numero grande>" (o ID do
// anuncio). A partir de cada link encontrado, olhamos so o trecho de HTML
// seguinte (onde ficam preco/specs/data) para extrair o resto.
function parseListingCards(html: string): Card[] {
  const linkRe = /href="(https:\/\/[a-z0-9-]+\.olx\.com\.br\/[^"?#]*?-(\d{7,12}))"[^>]*(?:title="([^"]+)")?/gi;
  const matches: { index: number; url: string; adId: string; title: string | null }[] = [];
  let m: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((m = linkRe.exec(html))) {
    if (seen.has(m[2])) continue;
    seen.add(m[2]);
    matches.push({ index: m.index, url: m[1], adId: m[2], title: m[3] ? m[3].replace(/&amp;/g, "&").replace(/&quot;/g, '"') : null });
  }

  const cards: Card[] = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : Math.min(html.length, start + 4000);
    const chunk = html.slice(start, Math.max(end, start + 200));

    const price = chunk.match(/R\$\s*([\d.]+)(?:,\d{2})?(?!.*IPTU)/);
    const priceAll = [...chunk.matchAll(/R\$\s*([\d.]+)/g)];
    const iptu = chunk.match(/IPTU[^R]*R\$\s*([\d.]+)/i);
    const condo = chunk.match(/Condom[ií]nio[^R]*R\$\s*([\d.]+)/i);
    const area = chunk.match(/(\d+)\s*m²/);
    const dateMatch = chunk.match(/(Hoje|Ontem),\s*\d{1,2}:\d{2}|\d{1,2}\s+de\s+[a-zç]{3,}[a-z]*,\s*\d{1,2}:\d{2}/i);
    const local = chunk.match(/>([A-ZÀ-Ú][a-zà-ú]+(?:\s[A-ZÀ-Ú][a-zà-ú]+)*),\s*([A-ZÀ-Ú][a-zà-ú].{2,40}?)</);

    // O primeiro valor "R$" do trecho costuma ser o preco de destaque do card;
    // quando IPTU/Condominio aparecem antes dele no HTML, pulamos para o
    // proximo valor "R$" que nao seja um desses dois.
    let priceValue: number | null = null;
    for (const p of priceAll) {
      const val = Number(p[1].replace(/\./g, ""));
      if (iptu && p[1] === iptu[1]) continue;
      if (condo && p[1] === condo[1]) continue;
      priceValue = val; break;
    }
    if (priceValue === null && price) priceValue = Number(price[1].replace(/\./g, ""));

    cards.push({
      url: matches[i].url,
      adId: matches[i].adId,
      title: matches[i].title,
      price: priceValue,
      condo: condo ? Number(condo[1].replace(/\./g, "")) : null,
      iptu: iptu ? Number(iptu[1].replace(/\./g, "")) : null,
      areaM2: area ? Number(area[1]) : null,
      bedrooms: null, parking: null,
      neighborhood: local ? txt(local[2]) : null,
      publishedAt: dateMatch ? parseRelativeDate(dateMatch[0]) : null,
    });
  }
  return cards.filter(c => c.title || c.price !== null); // descarta ruido sem nenhum dado util
}

async function fetchOlxPage(url: string): Promise<{ ok: boolean; html: string; status: number | null }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PAGE_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "pt-BR,pt;q=0.9",
      },
    });
    const html = await r.text();
    return { ok: r.ok, html, status: r.status };
  } catch (e) {
    return { ok: false, html: "", status: null };
  } finally { clearTimeout(t); }
}

async function sha256(v: string) { const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)); return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, "0")).join(""); }

async function sourceIdFor(admin: any): Promise<string | null> {
  const { data } = await admin.from("lj_v2_sources").select("id").eq("name", "OLX Imóveis").eq("is_active", true).limit(1).maybeSingle();
  return data?.id ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const body = (await req.json().catch(() => ({}))) as Json;

  if (body.action !== "collect") {
    return reply({
      ok: true, function: "coletor-olx-direto-v1", version: VERSION,
      strategy: "olx_direct_html_no_search_engine",
      description: "Lê a própria página de categoria da OLX (SSR, sem JS) em vez de perguntar a um buscador externo. Entrega URL individual real de cada anúncio.",
      coverage: { state: "SP apenas por enquanto", cities: Object.keys(CITY_PATH) },
      known_issue: "Bloqueado por 403 (Cloudflare) quando chamado direto do IP do Supabase. Precisa de proxy residencial na frente do fetch() para funcionar em producao.",
    });
  }

  const admin = adminClient();
  if (!admin) return reply({ ok: false, error: "supabase_admin_unavailable" }, 500);
  const auth = await allowed(req);
  if (!auth.ok) return reply({ ok: false, error: "collect_authentication_failed" }, 401);

  const state = String(body.state_code ?? "").toUpperCase();
  const city = String(body.city ?? "");
  const tx: Tx | null = body.transaction_type === "rent" ? "rent" : body.transaction_type === "sale" ? "sale" : null;
  const ptype = txt(body.property_type_code);
  const maxPages = Math.max(1, Math.min(5, Number(body.max_pages ?? 2)));
  if (state.length !== 2 || !city || !tx) return reply({ ok: false, error: "invalid_request" }, 400);

  const { data: can } = await admin.rpc("lj_v2_collector_can_run");
  if (can !== true) return reply({ ok: false, error: "collector_disabled_by_master_control" }, 423);
  const { data: elig } = await admin.rpc("lj_v2_check_quinto_eligibility", { p_state_code: state, p_city: city, p_transaction_type: tx, p_property_type_code: ptype, p_region_name: null });
  if (elig?.eligible !== true) return reply({ ok: false, error: "target_not_eligible", eligibility: elig }, 400);

  const { data: run, error: runErr } = await admin.from("lj_v2_collector_runs").insert({
    workspace_id: WORKSPACE_ID, run_mode: auth.mode === "user" ? "manual" : "scheduled", status: "running",
    requested_by: auth.user, state_code: state, city, transaction_type: tx, property_type_code: ptype,
    started_at: new Date().toISOString(),
    system_snapshot: { version: VERSION, provider: "olx_direct", strategy: "olx_direct_html_no_search_engine" },
    metadata: { max_pages: maxPages },
  }).select("id").single();
  if (runErr || !run?.id) return reply({ ok: false, error: "collector_run_create_failed", details: runErr?.message }, 500);
  const runId = run.id;

  const sourceId = await sourceIdFor(admin);
  let pagesFetched = 0, pagesFailed = 0, cardsFound = 0, newCount = 0, existingCount = 0;
  const perPage: Json[] = [];
  const sampleCards: Json[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const url = buildUrl(state, city, tx, ptype, page);
    if (!url) { perPage.push({ page, error: "cidade_sem_mapeamento_olx" }); break; }
    const fetched = await fetchOlxPage(url);
    if (!fetched.ok) { pagesFailed++; perPage.push({ page, url, error: `http_${fetched.status ?? "erro"}` }); continue; }
    pagesFetched++;
    const cards = parseListingCards(fetched.html);
    perPage.push({ page, url, cards_found: cards.length });
    cardsFound += cards.length;

    for (const c of cards) {
      const normUrl = c.url.split("?")[0];
      const { data: old } = await admin.from("lj_v2_raw_discoveries").select("id,occurrence_count").eq("normalized_url", normUrl).limit(1);
      const meta = {
        search_context: { state_code: state, city, transaction_type: tx, property_type_code: ptype, not_yet_verified: true },
        provider: "olx_direct", source_name: "OLX Imóveis",
        olx_card: { ad_id: c.adId, price: c.price, condo: c.condo, iptu: c.iptu, area_m2: c.areaM2, neighborhood: c.neighborhood },
      };
      if (old?.[0]?.id) {
        existingCount++;
        await admin.from("lj_v2_raw_discoveries").update({
          source_id: sourceId, title: c.title, last_seen_at: new Date().toISOString(), latest_run_id: runId,
          occurrence_count: Number(old[0].occurrence_count || 1) + 1, metadata: meta,
        }).eq("id", old[0].id);
        await admin.from("lj_v2_collector_run_discoveries").upsert({ run_id: runId, discovery_id: old[0].id, query_text: url, result_position: cardsFound, was_new: false }, { onConflict: "run_id,discovery_id", ignoreDuplicates: true });
      } else {
        const ins = await admin.from("lj_v2_raw_discoveries").insert({
          source_id: sourceId, original_url: c.url, normalized_url: normUrl, url_hash: await sha256(normUrl),
          title: c.title, snippet: [c.price ? `R$ ${c.price}` : null, c.areaM2 ? `${c.areaM2} m²` : null, c.neighborhood].filter(Boolean).join(" · "),
          detected_state_code: state, detected_city: city, detected_transaction: tx, detected_property_type: ptype,
          published_at: c.publishedAt, discovery_status: "raw", latest_run_id: runId, raw_payload: c, metadata: meta,
        }).select("id").single();
        if (!ins.error && ins.data?.id) {
          newCount++;
          await admin.from("lj_v2_collector_run_discoveries").upsert({ run_id: runId, discovery_id: ins.data.id, query_text: url, result_position: cardsFound, was_new: true }, { onConflict: "run_id,discovery_id", ignoreDuplicates: true });
          if (sampleCards.length < 5) sampleCards.push({ url: c.url, title: c.title, price: c.price });
        }
      }
    }
  }

  const status = pagesFetched === 0 ? "failed" : pagesFailed > 0 ? "partial" : "completed";
  await admin.from("lj_v2_collector_runs").update({
    status, finished_at: new Date().toISOString(), total_queries: pagesFetched + pagesFailed,
    total_raw_results: cardsFound, total_unique_results: newCount + existingCount, total_new_results: newCount,
    total_existing_results: existingCount, total_errors: pagesFailed,
    counters: { pages_fetched: pagesFetched, pages_failed: pagesFailed, cards_found: cardsFound, new_results: newCount, existing_results: existingCount, per_page: perPage, provider: "olx_direct" },
    error_message: status === "failed" ? "nenhuma página da OLX pôde ser lida" : null,
  }).eq("id", runId);

  return reply({
    ok: status !== "failed", function: "coletor-olx-direto-v1", version: VERSION, status, run_id: runId,
    target: { state_code: state, city, transaction_type: tx, property_type_code: ptype },
    counters: { pages_fetched: pagesFetched, pages_failed: pagesFailed, cards_found: cardsFound, new_results: newCount, existing_results: existingCount },
    sample: sampleCards, per_page: perPage,
  });
});

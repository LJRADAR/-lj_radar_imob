import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { extractProfileWithClaude, updateBuyerFromExplicit, fetchExistingProfile } from "../_shared/sales-match-profile.ts";

const VERSION = "2.2.0";
const WORKSPACE_RESOLUTION = "phone_number_id_with_legacy_empty_registry_fallback";
const digits = (v: unknown) => String(v || "").replace(/\D/g, "");
const samePhone = (a: unknown, b: unknown) => {
  const canonical = (value: unknown) => {
    let d = digits(value);
    if (d.startsWith("55") && (d.length === 12 || d.length === 13)) d = d.slice(2);
    return /^(?:[1-9]{2})(?:9\d{8}|[2-5]\d{7})$/.test(d) ? d : null;
  };
  const x = canonical(a), y = canonical(b);
  return Boolean(x && y && (x === y || x.slice(-10) === y.slice(-10)));
};
const enc = new TextEncoder();

async function fetchWithTimeout(input: string, init: RequestInit, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(input, { ...init, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

async function validSignature(raw: string, signature: string, secret: string) {
  if (!signature.startsWith("sha256=")) return false;
  const expected = signature.slice(7).toLowerCase();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(raw));
  const actual = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function textFromMessage(m: any) {
  return String(m?.text?.body || m?.button?.text || m?.interactive?.button_reply?.title || m?.interactive?.list_reply?.title || "").trim();
}

function phonesFrom(v: unknown) {
  const s = String(v || "");
  const out = new Set<string>();
  for (const m of s.matchAll(/(?:\+?55\s*)?(?:\(?\d{2}\)?[\s.-]*)?9?\d{4}[\s.-]?\d{4}/g)) {
    const d = digits(m[0]);
    if (d.length >= 10) out.add(d);
  }
  return [...out];
}

function leadTitle(type: string, row: any) {
  if (type === "buyer") return row.name || "Comprador";
  if (type === "buyer_intent") return row.person_name || row.title || "Intenção";
  return row.contact_name || row.title || "Oportunidade";
}

function throwIfError(error: any, label: string) {
  if (error) throw new Error(`${label}: ${error.message || String(error)}`);
}

function namedWorkerSecret() {
  try {
    const parsed = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
    return String(parsed.radar_lj_v2_collector || "").trim();
  } catch { return ""; }
}

function workerAuthorized(req: Request) {
  const token = String(req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const named = namedWorkerSecret();
  const service = String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
  return Boolean(token && ((named && token === named) || (service && token === service)));
}

async function enqueueMessage(admin: any, workspace: string, change: any, m: any, phoneNumberId: string | null) {
  const messageId = String(m?.id || "").trim();
  if (!messageId) return null;
  const { data, error } = await admin.from("lji_whatsapp_webhook_queue").insert({
    workspace_id: workspace,
    phone_number_id: phoneNumberId,
    message_id: messageId,
    from_phone: digits(m?.from),
    payload: { change, message: m },
  }).select("id").maybeSingle();
  if (!error) return data?.id || null;
  if (String(error.code || "") === "23505") {
    const existing = await admin.from("lji_whatsapp_webhook_queue").select("id").eq("workspace_id", workspace).eq("message_id", messageId).maybeSingle();
    throwIfError(existing.error, "enqueueMessage duplicate lookup");
    return existing.data?.id || null;
  }
  throw error;
}

async function processQueue(admin: any) {
  const claimed = await admin.rpc("lji_claim_whatsapp_webhook_queue", { p_limit: 5 });
  throwIfError(claimed.error, "claim webhook queue");
  let processed = 0, failed = 0;
  for (const row of claimed.data || []) {
    try {
      const payload = row.payload || {};
      const result = await processMessage(admin, String(row.workspace_id), payload.change, payload.message, row.phone_number_id || null, "durable_queue");
      await admin.rpc("lji_finish_whatsapp_webhook_queue", { p_id: row.id, p_ok: true });
      processed += result?.skipped ? 0 : 1;
    } catch (e) {
      failed++;
      await admin.rpc("lji_finish_whatsapp_webhook_queue", { p_id: row.id, p_ok: false, p_error: String((e as Error)?.message || e) });
      console.error("durable webhook queue item failed", row.message_id, e);
    }
  }
  return { claimed: (claimed.data || []).length, processed, failed };
}

async function eventExists(admin: any, workspace: string, eventType: string, messageId: string) {
  const { data, error } = await admin
    .from("lji_activity_log")
    .select("id")
    .eq("workspace_id", workspace)
    .eq("event_type", eventType)
    .contains("details", { message_id: messageId })
    .limit(1);
  throwIfError(error, `eventExists(${eventType})`);
  return Boolean(data?.length);
}

async function insertEventOnce(admin: any, row: any) {
  const { error } = await admin.from("lji_activity_log").insert(row);
  if (!error) return true;
  if (String(error.code || "") === "23505") return false;
  throw error;
}

async function resolveWorkspaceForChange(admin: any, change: any, legacyWorkspace: string) {
  const phoneNumberId = String(change?.value?.metadata?.phone_number_id || "").trim();

  if (phoneNumberId) {
    const exact = await admin
      .from("lji_whatsapp_accounts")
      .select("workspace_id,phone_number_id")
      .eq("phone_number_id", phoneNumberId)
      .eq("is_active", true)
      .maybeSingle();
    throwIfError(exact.error, "resolveWorkspace exact account");
    if (exact.data?.workspace_id) {
      return {
        workspace: String(exact.data.workspace_id),
        phone_number_id: phoneNumberId,
        method: "phone_number_id_registry",
      };
    }
  }

  const registry = await admin
    .from("lji_whatsapp_accounts")
    .select("id", { count: "exact", head: true })
    .eq("is_active", true);
  throwIfError(registry.error, "resolveWorkspace registry count");
  const activeAccounts = Number(registry.count || 0);

  if (activeAccounts === 0 && legacyWorkspace) {
    return {
      workspace: legacyWorkspace,
      phone_number_id: phoneNumberId || null,
      method: "legacy_env_empty_registry",
    };
  }

  if (!phoneNumberId) throw new Error("whatsapp_phone_number_id_missing");
  if (activeAccounts > 0) throw new Error(`whatsapp_account_mapping_missing:${phoneNumberId}`);
  throw new Error("whatsapp_account_registry_empty_and_legacy_workspace_missing");
}

async function resolveLead(admin: any, workspace: string, phone: string) {
  const linksRes = await admin
    .from("lji_activity_log")
    .select("entity_type,entity_id,details,created_at")
    .eq("workspace_id", workspace)
    .eq("event_type", "whatsapp_lead_linked")
    .order("created_at", { ascending: false })
    .limit(500);
  throwIfError(linksRes.error, "resolveLead persisted links");

  const persisted = (linksRes.data || []).find((e: any) => samePhone(e.details?.phone, phone));
  if (persisted) {
    return {
      entity_type: persisted.entity_type,
      entity_id: String(persisted.entity_id),
      title: persisted.details?.title || "Lead",
      lead_type: persisted.details?.lead_type || "Lead",
      method: "persisted",
    };
  }

  const [buyersRes, intentsRes, historyRes] = await Promise.all([
    admin.from("lji_buyers").select("id,name,contact,status").eq("workspace_id", workspace).eq("status", "active"),
    admin.from("lji_buyer_intents").select("id,person_name,title,contact,intent_text,status").eq("workspace_id", workspace).eq("status", "active"),
    admin.rpc("lji_get_opportunity_history", { p_workspace: workspace }),
  ]);
  throwIfError(buyersRes.error, "resolveLead buyers");
  throwIfError(intentsRes.error, "resolveLead intents");
  throwIfError(historyRes.error, "resolveLead opportunity history");

  const candidates: any[] = [];
  for (const row of buyersRes.data || []) {
    if (phonesFrom(row.contact).some((p) => samePhone(p, phone))) {
      candidates.push({ entity_type: "buyer", entity_id: String(row.id), title: leadTitle("buyer", row), lead_type: "Comprador cadastrado" });
    }
  }
  for (const row of intentsRes.data || []) {
    if (phonesFrom(`${row.contact || ""} ${row.intent_text || ""}`).some((p) => samePhone(p, phone))) {
      candidates.push({ entity_type: "buyer_intent", entity_id: String(row.id), title: leadTitle("buyer_intent", row), lead_type: "Comprador captado" });
    }
  }
  const seenOpp = new Set<string>();
  for (const row of historyRes.data || []) {
    const id = String(row.opportunity_id || "");
    if (!id || seenOpp.has(id) || row.is_current !== true) continue;
    seenOpp.add(id);
    const hay = [row.contact_verified_phone, row.contact_phone, row.whatsapp_url].filter(Boolean).join(" ");
    if (phonesFrom(hay).some((p) => samePhone(p, phone))) {
      candidates.push({ entity_type: "opportunity", entity_id: id, title: leadTitle("opportunity", row), lead_type: "Proprietário" });
    }
  }
  const unique = [...new Map(candidates.map((x) => [`${x.entity_type}:${x.entity_id}`, x])).values()];
  return unique.length === 1 ? { ...unique[0], method: "phone_unique" } : null;
}

function heuristic(text: string) {
  const t = text.toLowerCase();
  let score = 0, intent = "medium", objection: string | null = null;
  let action = "Responder e confirmar o próximo passo comercial.";
  if (/quero|tenho interesse|gostei|visita|visitar|proposta|fechar|comprar|alugar|hor[aá]rio/.test(t)) {
    score += 12;
    intent = "high";
    action = /visita|visitar|hor[aá]rio/.test(t) ? "Propor duas opções reais de horário para visita." : "Avançar com uma pergunta objetiva para a próxima etapa.";
  }
  if (/pre[cç]o|caro|valor|desconto|condi[cç][aã]o/.test(t)) {
    objection = "preço/condição"; score -= 2; action = "Tratar valor e condição sem inventar desconto; confirmar o ponto que impede o avanço.";
  } else if (/financi|cr[eé]dito|entrada|parcela/.test(t)) {
    objection = "financiamento"; score += 2; action = "Confirmar estrutura de pagamento e quais informações faltam para avançar.";
  } else if (/bairro|regi[aã]o|longe|localiza[cç][aã]o/.test(t)) {
    objection = "localização"; score -= 1; action = "Confirmar a região prioritária e restringir as opções ao que atende a rotina do cliente.";
  } else if (/depois|agora n[aã]o|pensar|sem pressa|mais pra frente/.test(t)) {
    objection = "timing"; score -= 10; intent = "low"; action = "Respeitar o timing e combinar uma retomada sem pressão.";
  }
  if (/n[aã]o tenho interesse|desisti|n[aã]o quero|pare de/.test(t)) {
    score = -20; intent = "low"; action = "Interromper a pressão comercial e registrar o motivo antes de encerrar.";
  }
  return {
    intent_level: intent,
    objection,
    score_delta: Math.max(-20, Math.min(20, score)),
    analysis_summary: "Classificação local baseada somente no conteúdo real da conversa.",
    recommended_action: action,
    confidence: "partial",
    stage_suggestion: intent === "high" ? "replied" : null,
    engine: "heuristic_fallback",
  };
}

async function analyze(admin: any, workspace: string, phone: string, lead: any) {
  const eventsRes = await admin
    .from("lji_activity_log")
    .select("event_type,details,created_at")
    .eq("workspace_id", workspace)
    .eq("entity_type", "whatsapp")
    .eq("entity_id", phone)
    .in("event_type", ["whatsapp_message_received", "whatsapp_message_sent"])
    .order("created_at", { ascending: true })
    .limit(30);
  throwIfError(eventsRes.error, "analyze conversation");
  const conv = eventsRes.data || [];
  const fallback = heuristic(conv.map((x: any) => x.details?.text || "").join("\n"));
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return fallback;

  try {
    const model = Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-4-5";
    const transcript = conv.map((e: any) => `${e.event_type === "whatsapp_message_received" ? "CLIENTE" : "EQUIPE"}: ${String(e.details?.text || "")}`).join("\n").slice(-12000);
    const system = `Você analisa conversas comerciais imobiliárias reais no LJ Sales. Não invente fatos. Responda SOMENTE JSON válido com intent_level (high|medium|low), objection (string ou null), score_delta (-20..20), analysis_summary (máx 220 caracteres), recommended_action (máx 220 caracteres), confidence (strong|partial|limited), stage_suggestion (replied|qualified|visit_scheduled|proposal|negotiation|null).`;
    const r = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: 500, temperature: 0.2, system, messages: [{ role: "user", content: `LEAD: ${JSON.stringify(lead)}\nCONVERSA:\n${transcript}` }] }),
    });
    if (!r.ok) return fallback;
    const out = await r.json();
    const raw = String(out?.content?.find((x: any) => x.type === "text")?.text || "").trim();
    const p = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, ""));
    return {
      intent_level: ["high", "medium", "low"].includes(p.intent_level) ? p.intent_level : "medium",
      objection: p.objection ? String(p.objection).slice(0, 120) : null,
      score_delta: Math.max(-20, Math.min(20, Math.round(Number(p.score_delta || 0)))),
      analysis_summary: String(p.analysis_summary || "").slice(0, 220),
      recommended_action: String(p.recommended_action || "").slice(0, 220),
      confidence: ["strong", "partial", "limited"].includes(p.confidence) ? p.confidence : "partial",
      stage_suggestion: p.stage_suggestion ? String(p.stage_suggestion) : null,
      engine: `anthropic:${model}`,
    };
  } catch (e) {
    console.error("analysis fallback", e);
    return fallback;
  }
}

async function extractMatchProfile(admin: any, workspace: string, phone: string, lead: any) {
  const eventsRes = await admin
    .from("lji_activity_log")
    .select("event_type,details,created_at")
    .eq("workspace_id", workspace)
    .eq("entity_type", "whatsapp")
    .eq("entity_id", phone)
    .in("event_type", ["whatsapp_message_received", "whatsapp_message_sent"])
    .order("created_at", { ascending: true })
    .limit(60);
  throwIfError(eventsRes.error, "extractMatchProfile conversation");
  const rows = eventsRes.data || [];
  if (!rows.length) return { profile: null, engine: "no_conversation", updated_fields: [] as string[] };

  const existingProfile = await fetchExistingProfile(admin, workspace, { entity_type: lead.entity_type, entity_id: String(lead.entity_id) });
  const { profile, engine } = await extractProfileWithClaude(rows, { ...lead, existing_profile: existingProfile });
  let updatedFields: string[] = [];
  if (lead?.entity_type === "buyer" && profile.intent_role !== "seller") {
    const result = await updateBuyerFromExplicit(admin, workspace, String(lead.entity_id), profile);
    updatedFields = result.fields;
  }
  return { profile, engine, updated_fields: updatedFields };
}

async function processMessage(admin: any, workspace: string, change: any, m: any, phoneNumberId: string | null, workspaceResolution: string) {
  const messageId = String(m?.id || "").trim();
  const from = digits(m?.from);
  if (!messageId || !from) return { skipped: true, reason: "missing_message_identity" };

  if (await eventExists(admin, workspace, "whatsapp_processing_completed", messageId)) {
    return { skipped: true, reason: "already_completed" };
  }

  const text = textFromMessage(m);
  const name = change?.value?.contacts?.find((c: any) => String(c.wa_id) === String(m.from))?.profile?.name || "";
  const lead = await resolveLead(admin, workspace, from);

  await insertEventOnce(admin, {
    workspace_id: workspace,
    user_id: null,
    event_type: "whatsapp_message_received",
    entity_type: "whatsapp",
    entity_id: from,
    details: {
      phone: from, from, text, contact_name: name, message_id: messageId, type: m.type, timestamp: m.timestamp,
      phone_number_id: phoneNumberId,
      workspace_resolution: workspaceResolution,
      linked_entity_type: lead?.entity_type || null, linked_entity_id: lead?.entity_id || null,
    },
  });

  if (!lead) {
    await insertEventOnce(admin, {
      workspace_id: workspace, user_id: null, event_type: "whatsapp_processing_completed",
      entity_type: "whatsapp", entity_id: from,
      details: { phone: from, message_id: messageId, phone_number_id: phoneNumberId, workspace_resolution: workspaceResolution, linked: false, version: VERSION },
    });
    return { ok: true, linked: false };
  }

  await insertEventOnce(admin, {
    workspace_id: workspace, user_id: null, event_type: "whatsapp_lead_linked",
    entity_type: lead.entity_type, entity_id: lead.entity_id,
    details: { phone: from, lead_type: lead.lead_type, title: lead.title, link_method: lead.method, message_id: messageId },
  });
  await insertEventOnce(admin, {
    workspace_id: workspace, user_id: null, event_type: "sales_contact_logged",
    entity_type: lead.entity_type, entity_id: lead.entity_id,
    details: { phone: from, channel: "WhatsApp", direction: "inbound", note: text || `Mensagem ${m.type || "recebida"}`, message_id: messageId, source: "official_whatsapp", author_name: name || "Contato" },
  });

  if (!(await eventExists(admin, workspace, "pipeline_stage_changed", messageId))) {
    const stageRes = await admin
      .from("lji_activity_log")
      .select("details,created_at")
      .eq("workspace_id", workspace)
      .eq("event_type", "pipeline_stage_changed")
      .eq("entity_type", lead.entity_type)
      .eq("entity_id", lead.entity_id)
      .order("created_at", { ascending: false })
      .limit(1);
    throwIfError(stageRes.error, "latest pipeline stage");
    const oldStage = stageRes.data?.[0]?.details?.new_stage || "new";
    if (["new", "validated", "contacted"].includes(oldStage)) {
      await insertEventOnce(admin, {
        workspace_id: workspace, user_id: null, event_type: "pipeline_stage_changed",
        entity_type: lead.entity_type, entity_id: lead.entity_id,
        details: { old_stage: oldStage, new_stage: "replied", lead_type: lead.lead_type, title: lead.title, changed_by_name: "WhatsApp oficial", automation: "whatsapp_inbound", message_id: messageId },
      });
    }
  }

  if (!(await eventExists(admin, workspace, "sales_inbox_analysis", messageId))) {
    const a = await analyze(admin, workspace, from, lead);
    await insertEventOnce(admin, {
      workspace_id: workspace, user_id: null, event_type: "sales_inbox_analysis",
      entity_type: lead.entity_type, entity_id: lead.entity_id,
      details: { phone: from, message_id: messageId, ...a },
    });
  }

  if (!(await eventExists(admin, workspace, "sales_match_profile", messageId))) {
    const mp = await extractMatchProfile(admin, workspace, from, lead);
    if (mp.engine !== "no_conversation") {
      await insertEventOnce(admin, {
        workspace_id: workspace, user_id: null, event_type: "sales_match_profile",
        entity_type: lead.entity_type, entity_id: lead.entity_id,
        details: { phone: from, message_id: messageId, profile: mp.profile, engine: mp.engine, updated_buyer: mp.updated_fields.length > 0, updated_fields: mp.updated_fields, automation: "whatsapp_inbound" },
      });
    }
  }

  await insertEventOnce(admin, {
    workspace_id: workspace, user_id: null, event_type: "whatsapp_processing_completed",
    entity_type: "whatsapp", entity_id: from,
    details: {
      phone: from, message_id: messageId, phone_number_id: phoneNumberId, workspace_resolution: workspaceResolution,
      linked: true, linked_entity_type: lead.entity_type, linked_entity_id: lead.entity_id, version: VERSION,
    },
  });
  return { ok: true, linked: true };
}

Deno.serve(async (req) => {
  const verify = Deno.env.get("META_WEBHOOK_VERIFY_TOKEN") || "";

  if (req.method === "GET") {
    const u = new URL(req.url);
    if (u.searchParams.get("action") === "health") {
      return new Response(JSON.stringify({
        ok: true,
        function: "lji-whatsapp-webhook-v1",
        version: VERSION,
        retry_safe: true,
        idempotent: true,
        workspace_resolution: WORKSPACE_RESOLUTION,
        workspace_registry: "lji_whatsapp_accounts",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (u.searchParams.get("hub.mode") === "subscribe" && u.searchParams.get("hub.verify_token") === verify) {
      return new Response(u.searchParams.get("hub.challenge") || "", { status: 200 });
    }
    return new Response("forbidden", { status: 403 });
  }

  if (req.method !== "POST") return new Response("method", { status: 405 });

  try {
    const raw = await req.text();
    const requestBody = (() => { try { return JSON.parse(raw); } catch { return null; } })();
    if (requestBody?.action === "process_queue") {
      if (!workerAuthorized(req)) return new Response("unauthorized", { status: 401 });
      const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
      const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
      if (!supabaseUrl || !serviceRole) return new Response("supabase_not_configured", { status: 503 });
      const admin = createClient(supabaseUrl, serviceRole);
      const result = await processQueue(admin);
      return new Response(JSON.stringify({ ok: result.failed === 0, ...result, version: VERSION }), { status: result.failed ? 500 : 200, headers: { "Content-Type": "application/json" } });
    }
    const secret = Deno.env.get("META_APP_SECRET") || "";
    if (!secret) return new Response("webhook_not_configured", { status: 503 });
    if (!(await validSignature(raw, req.headers.get("x-hub-signature-256") || "", secret))) {
      return new Response("invalid_signature", { status: 401 });
    }

    let payload: any;
    try { payload = JSON.parse(raw); }
    catch { return new Response("invalid_json", { status: 400 }); }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!supabaseUrl || !serviceRole) return new Response("supabase_not_configured", { status: 503 });
    const admin = createClient(supabaseUrl, serviceRole);
    const legacyWorkspace = Deno.env.get("LJI_WORKSPACE_ID") || "";

    let failed = false;
    let processed = 0;
    for (const entry of payload?.entry || []) {
      for (const change of entry?.changes || []) {
        let routing: { workspace: string; phone_number_id: string | null; method: string };
        try {
          routing = await resolveWorkspaceForChange(admin, change, legacyWorkspace);
        } catch (e) {
          console.error("webhook workspace resolution failed", e);
          return new Response(JSON.stringify({
            ok: false,
            retry: true,
            error: "workspace_resolution_failed",
            version: VERSION,
            phone_number_id_present: Boolean(String(change?.value?.metadata?.phone_number_id || "").trim()),
          }), { status: 500, headers: { "Content-Type": "application/json" } });
        }

        for (const m of change?.value?.messages || []) {
          let queueId: string | null = null;
          try {
            queueId = await enqueueMessage(admin, routing.workspace, change, m, routing.phone_number_id);
            const result = await processMessage(admin, routing.workspace, change, m, routing.phone_number_id, routing.method);
            if (queueId) await admin.rpc("lji_finish_whatsapp_webhook_queue", { p_id: queueId, p_ok: true });
            if (!result?.skipped) processed++;
          } catch (e) {
            failed = true;
            if (queueId) await admin.rpc("lji_finish_whatsapp_webhook_queue", { p_id: queueId, p_ok: false, p_error: String((e as Error)?.message || e) });
            const messageId = String(m?.id || "");
            const from = digits(m?.from);
            console.error(`webhook processing failed for ${messageId}`, e);
            try {
              await admin.from("lji_activity_log").insert({
                workspace_id: routing.workspace,
                user_id: null,
                event_type: "whatsapp_processing_failed",
                entity_type: "whatsapp",
                entity_id: from || "unknown",
                details: {
                  phone: from || null,
                  message_id: messageId || null,
                  phone_number_id: routing.phone_number_id,
                  workspace_resolution: routing.method,
                  error: String((e as Error)?.message || e).slice(0, 500),
                  version: VERSION,
                  retry_expected: true,
                },
              });
            } catch (logErr) {
              console.error("failed to persist webhook failure", logErr);
            }
          }
        }
      }
    }

    if (failed) return new Response(JSON.stringify({ ok: false, retry: true, processed, version: VERSION }), { status: 500, headers: { "Content-Type": "application/json" } });
    return new Response(JSON.stringify({ ok: true, processed, version: VERSION }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("webhook fatal error", e);
    return new Response(JSON.stringify({ ok: false, retry: true, error: "internal_error", version: VERSION }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

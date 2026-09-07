import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const VERSION = "1.1.0";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
const digits = (v: unknown) => String(v || "").replace(/\D/g, "");
const clean = (v: unknown) => String(v ?? "").trim();

async function resolveWorkspacePhoneId(admin: any, workspace: string) {
  const { data: accounts, error } = await admin
    .from("lji_whatsapp_accounts")
    .select("id,phone_number_id,display_phone_number,waba_id,is_active")
    .eq("workspace_id", workspace)
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(2);
  if (error) throw new Error(`whatsapp_account_lookup_failed:${error.message}`);
  if ((accounts?.length || 0) > 1) throw new Error("multiple_active_whatsapp_accounts_for_workspace");
  if (accounts?.[0]?.phone_number_id) {
    return {
      phoneId: clean(accounts[0].phone_number_id),
      accountId: clean(accounts[0].id),
      source: "workspace_registry",
    };
  }

  const { count, error: countError } = await admin
    .from("lji_whatsapp_accounts")
    .select("id", { count: "exact", head: true });
  if (countError) throw new Error(`whatsapp_registry_count_failed:${countError.message}`);
  if ((count || 0) > 0) {
    return { phoneId: "", accountId: null, source: "workspace_not_registered" };
  }

  const legacy = clean(Deno.env.get("META_WHATSAPP_PHONE_NUMBER_ID"));
  return {
    phoneId: legacy,
    accountId: null,
    source: legacy ? "legacy_empty_registry_fallback" : "not_configured",
  };
}

async function validateLinkedEntity(admin: any, workspace: string, entityType: string | null, entityId: string | null) {
  if (!entityType && !entityId) return { ok: true };
  if (!entityType || !entityId) return { ok: false, error: "linked_entity_incomplete" };

  const targets: Record<string, string> = {
    buyer: "lji_buyers",
    buyer_intent: "lji_buyer_intents",
    opportunity: "lji_opportunity_index",
  };
  const table = targets[entityType];
  if (!table) return { ok: false, error: "linked_entity_type_invalid" };

  const { data, error } = await admin
    .from(table)
    .select("id")
    .eq("id", entityId)
    .eq("workspace_id", workspace)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`linked_entity_lookup_failed:${error.message}`);
  return data?.id ? { ok: true } : { ok: false, error: "linked_entity_not_in_workspace" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed", version: VERSION }, 405);

  try {
    const auth = req.headers.get("Authorization") || "";
    if (!auth.startsWith("Bearer ")) return json({ ok: false, error: "unauthorized", version: VERSION }, 401);

    const url = Deno.env.get("SUPABASE_URL") || "";
    const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!url || !anon || !service) return json({ ok: false, error: "supabase_not_configured", version: VERSION }, 503);

    const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ ok: false, error: "invalid_session", version: VERSION }, 401);

    const body = await req.json().catch(() => ({}));
    const workspace = clean(body.workspace_id);
    const to = digits(body.to);
    const text = clean(body.text);
    const entityType = body.entity_type ? clean(body.entity_type) : null;
    const entityId = body.entity_id ? clean(body.entity_id) : null;
    if (!workspace || !to || !text) return json({ ok: false, error: "dados_incompletos", version: VERSION }, 400);
    if (to.length < 10 || to.length > 15) return json({ ok: false, error: "telefone_invalido", version: VERSION }, 400);
    if (text.length > 4096) return json({ ok: false, error: "mensagem_muito_longa", version: VERSION }, 400);

    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: member, error: memberError } = await admin
      .from("lji_workspace_members")
      .select("role,is_active")
      .eq("workspace_id", workspace)
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();
    if (memberError) return json({ ok: false, error: "workspace_lookup_failed", version: VERSION }, 500);
    if (!member) return json({ ok: false, error: "workspace_forbidden", version: VERSION }, 403);

    const linked = await validateLinkedEntity(admin, workspace, entityType, entityId);
    if (!linked.ok) return json({ ok: false, error: linked.error, version: VERSION }, 403);

    const token = clean(Deno.env.get("META_WHATSAPP_TOKEN"));
    const graph = clean(Deno.env.get("META_GRAPH_VERSION")) || "v23.0";
    const account = await resolveWorkspacePhoneId(admin, workspace);
    if (!token) return json({ ok: false, error: "whatsapp_token_not_configured", version: VERSION }, 503);
    if (!account.phoneId) {
      const error = account.source === "workspace_not_registered" ? "whatsapp_account_not_configured_for_workspace" : "whatsapp_not_configured";
      return json({ ok: false, error, workspace_resolution: account.source, version: VERSION }, 503);
    }

    const r = await fetch(`https://graph.facebook.com/${graph}/${encodeURIComponent(account.phoneId)}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: text, preview_url: false } }),
    });
    const out = await r.json().catch(() => ({}));
    const messageId = out?.messages?.[0]?.id || null;
    const accountAudit = {
      meta_phone_number_id: account.phoneId,
      whatsapp_account_id: account.accountId,
      workspace_resolution: account.source,
    };

    if (!r.ok) {
      await admin.from("lji_activity_log").insert({
        workspace_id: workspace,
        user_id: user.id,
        event_type: "whatsapp_message_failed",
        entity_type: "whatsapp",
        entity_id: to,
        details: { phone: to, text, error: out, linked_entity_type: entityType, linked_entity_id: entityId, ...accountAudit, version: VERSION },
      });
      return json({ ok: false, error: "meta_send_failed", version: VERSION }, 502);
    }

    await admin.from("lji_activity_log").insert({
      workspace_id: workspace,
      user_id: user.id,
      event_type: "whatsapp_message_sent",
      entity_type: "whatsapp",
      entity_id: to,
      details: { phone: to, text, message_id: messageId, linked_entity_type: entityType, linked_entity_id: entityId, ...accountAudit, version: VERSION },
    });

    if (entityType && entityId) {
      await admin.from("lji_activity_log").insert([
        {
          workspace_id: workspace,
          user_id: user.id,
          event_type: "whatsapp_lead_linked",
          entity_type: entityType,
          entity_id: entityId,
          details: { phone: to, link_method: "outbound_confirmed", message_id: messageId, ...accountAudit, version: VERSION },
        },
        {
          workspace_id: workspace,
          user_id: user.id,
          event_type: "sales_contact_logged",
          entity_type: entityType,
          entity_id: entityId,
          details: { phone: to, channel: "WhatsApp", direction: "outbound", note: text, message_id: messageId, source: "official_whatsapp", ...accountAudit, version: VERSION },
        },
      ]);
    }

    return json({ ok: true, message_id: messageId, workspace_resolution: account.source, version: VERSION });
  } catch (e) {
    console.error(e);
    const message = String((e as Error)?.message || e);
    if (message === "multiple_active_whatsapp_accounts_for_workspace") {
      return json({ ok: false, error: message, version: VERSION }, 500);
    }
    return json({ ok: false, error: "internal_error", version: VERSION }, 500);
  }
});

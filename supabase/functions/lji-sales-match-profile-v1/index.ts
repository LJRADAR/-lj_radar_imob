import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { extractProfileWithClaude, updateBuyerFromExplicit } from "../_shared/sales-match-profile.ts";

const VERSION = "1.1.0";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Content-Type": "application/json" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
const digits = (v: unknown) => String(v || "").replace(/\D/g, "");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed", version: VERSION }, 405);
  try {
    const auth = req.headers.get("Authorization") || "";
    if (!auth.startsWith("Bearer ")) return json({ ok: false, error: "unauthorized", version: VERSION }, 401);
    const url = Deno.env.get("SUPABASE_URL") || "", anon = Deno.env.get("SUPABASE_ANON_KEY") || "", service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!url || !anon || !service) return json({ ok: false, error: "supabase_not_configured", version: VERSION }, 503);
    const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ ok: false, error: "invalid_session", version: VERSION }, 401);
    const body = await req.json().catch(() => ({}));
    const workspace = String(body.workspace_id || "").trim();
    const lead = body.lead && typeof body.lead === "object" ? body.lead : {};
    const phone = digits(body.phone), entityType = String(lead.entity_type || "").trim(), entityId = String(lead.entity_id || "").trim();
    if (!workspace || !phone || !entityType || !entityId) return json({ ok: false, error: "dados_incompletos", version: VERSION }, 400);
    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: member, error: memberError } = await admin.from("lji_workspace_members").select("role,is_active,permissions").eq("workspace_id", workspace).eq("user_id", user.id).eq("is_active", true).maybeSingle();
    if (memberError) return json({ ok: false, error: "workspace_lookup_failed", version: VERSION }, 500);
    if (!member) return json({ ok: false, error: "workspace_forbidden", version: VERSION }, 403);
    const { data: events, error } = await admin.from("lji_activity_log").select("event_type,details,created_at").eq("workspace_id", workspace).eq("entity_type", "whatsapp").eq("entity_id", phone).in("event_type", ["whatsapp_message_received", "whatsapp_message_sent"]).order("created_at", { ascending: true }).limit(60);
    if (error) throw error;
    if (!events?.length) return json({ ok: false, error: "conversation_empty", version: VERSION }, 404);
    const { profile, engine } = await extractProfileWithClaude(events, lead);
    let buyerUpdate = { updated: false, fields: [] as string[] };
    if (entityType === "buyer" && profile.intent_role !== "seller") buyerUpdate = await updateBuyerFromExplicit(admin, workspace, entityId, profile);
    const { error: logError } = await admin.from("lji_activity_log").insert({ workspace_id: workspace, user_id: user.id, event_type: "sales_match_profile", entity_type: entityType, entity_id: entityId, details: { phone, profile, engine, updated_buyer: buyerUpdate.updated, updated_fields: buyerUpdate.fields, analyzed_messages: events.length, version: VERSION } });
    if (logError) throw logError;
    return json({ ok: true, profile, engine, updated_buyer: buyerUpdate.updated, updated_fields: buyerUpdate.fields, version: VERSION });
  } catch (e) {
    console.error("sales match profile failed", e);
    return json({ ok: false, error: "internal_error", version: VERSION }, 500);
  }
});

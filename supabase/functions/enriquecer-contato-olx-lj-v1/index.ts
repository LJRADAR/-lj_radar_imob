import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@^2";

const VERSION = "2.0.0";
const FUNCTION_NAME = "enriquecer-contato-olx-lj-v1";
const URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization,x-lji-cron-key,content-type,apikey,x-client-info",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};

const clean = (v: unknown) => typeof v === "string" ? v.trim() : "";
const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
});

async function authorize(req: Request, sb: any, body: Record<string, unknown>) {
  const cron = clean(req.headers.get("x-lji-cron-key"));
  if (cron) {
    const { data } = await sb.from("lji_internal_secrets").select("secret").eq("key", "intent_cron").maybeSingle();
    if (data?.secret && data.secret === cron) return { ok: true, mode: "cron", workspace: clean(body.workspace_id) };
  }

  const bearer = req.headers.get("Authorization") ?? "";
  if (!bearer || !ANON) return null;
  const uc = createClient(URL, ANON, { global: { headers: { Authorization: bearer } } });
  const { data: { user } } = await uc.auth.getUser();
  if (!user?.id) return null;
  const { data: member } = await sb.from("lji_workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  return member?.workspace_id ? { ok: true, mode: "user", workspace: member.workspace_id } : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  if (body.action === "health") {
    return json({
      ok: true,
      function: FUNCTION_NAME,
      version: VERSION,
      provider: "none",
      external_search_engine: false,
      status: "paused_until_direct_contact_source",
      collection_performed: false,
    });
  }

  if (!URL || !SERVICE) return json({ ok: false, error: "supabase_env_missing" }, 500);
  const sb = createClient(URL, SERVICE);
  const auth = await authorize(req, sb, body);
  if (!auth?.workspace) return json({ ok: false, error: "unauthorized" }, 401);

  return json({
    ok: true,
    function: FUNCTION_NAME,
    version: VERSION,
    provider: "none",
    external_search_engine: false,
    status: "paused_until_direct_contact_source",
    collection_performed: false,
    checked: 0,
    found: 0,
    message: "OLX contact enrichment is paused until a direct, approved public contact source is available.",
  });
});

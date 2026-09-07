import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const FUNCTION = "captador-contato-publico-lj-v1";
const VERSION = "2.0.0";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      },
    });
  }

  return new Response(JSON.stringify({
    ok: false,
    status: "deprecated",
    function: FUNCTION,
    version: VERSION,
    external_search_engine: false,
    provider: "none",
    replacement: "coletor-lj-v2 -> Source Router",
    message: "Endpoint legado aposentado. A coleta atual usa Source Router/Apify/integrações oficiais e permanece pausada até as credenciais das fontes estarem configuradas.",
  }), {
    status: 410,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    },
  });
});

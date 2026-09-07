import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const FUNCTION = "connor-engine-v0-1";
const VERSION = "0.2.0-retired";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    });
  }

  return new Response(JSON.stringify({
    ok: false,
    status: "retired",
    function: FUNCTION,
    version: VERSION,
    paid_ai_call_enabled: false,
    message: "Protótipo Connor/Sarah aposentado. Nenhuma chamada de IA ou escrita de negócio é executada por este endpoint.",
  }), {
    status: 410,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    },
  });
});

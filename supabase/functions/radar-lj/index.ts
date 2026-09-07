import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const FUNCTION = "radar-lj";
const VERSION = "2.0.0-retired";

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
    replacement: "radar-lj-v2",
    background_processing_enabled: false,
    service_role_processing_enabled: false,
    message: "Radar legado aposentado. O pipeline atual é radar-lj-v2 -> coletor-lj-v2 -> Source Router.",
  }), {
    status: 410,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    },
  });
});

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const VERSION = "1.0.0";
const FUNCTION_NAME = "lji-source-router-auth-v1";
const NAMED_SECRET_KEY = "radar_lj_v2_collector";
const MAX_SKEW_MS = 120_000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function namedSecret(): string {
  try {
    const parsed = JSON.parse(String(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}")) as Record<string, unknown>;
    const value = parsed[NAMED_SECRET_KEY];
    return typeof value === "string" ? value.trim() : "";
  } catch {
    return "";
  }
}

function fromBase64(value: string): Uint8Array | null {
  try {
    const raw = atob(value);
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

async function verifySignature(secret: string, timestamp: string, nonce: string, bodySha256: string, signatureB64: string) {
  const signature = fromBase64(signatureB64);
  if (!signature) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const message = `POST\n/collect\n${timestamp}\n${nonce}\n${bodySha256}`;
  return crypto.subtle.verify("HMAC", key, signature, new TextEncoder().encode(message));
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
      named_secret_available: Boolean(namedSecret()),
      auth_scheme: "hmac-sha256-v1",
      max_skew_ms: MAX_SKEW_MS,
    });
  }

  const secret = namedSecret();
  if (!secret) return json({ ok: false, error: "verifier_secret_unavailable" }, 503);

  const timestamp = String(body.timestamp ?? "").trim();
  const nonce = String(body.nonce ?? "").trim();
  const signature = String(body.signature ?? "").trim();
  const bodySha256 = String(body.body_sha256 ?? "").trim().toLowerCase();
  const ts = Number(timestamp);

  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > MAX_SKEW_MS) {
    return json({ ok: false, error: "signature_timestamp_invalid" }, 401);
  }
  if (nonce.length < 16 || nonce.length > 128) {
    return json({ ok: false, error: "signature_nonce_invalid" }, 401);
  }
  if (!/^[a-f0-9]{64}$/.test(bodySha256)) {
    return json({ ok: false, error: "body_hash_invalid" }, 400);
  }
  if (!signature) return json({ ok: false, error: "signature_missing" }, 401);

  const valid = await verifySignature(secret, timestamp, nonce, bodySha256, signature);
  if (!valid) return json({ ok: false, error: "signature_invalid" }, 401);

  return json({ ok: true, version: VERSION, auth_scheme: "hmac-sha256-v1" });
});

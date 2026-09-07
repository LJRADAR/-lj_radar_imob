import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const VERSION = "1.2.0";
const FUNCTION_NAME = "lji-source-router-auth-v1";
const NAMED_SECRET_KEY = "radar_lj_v2_collector";
const MAX_SKEW_MS = 120_000;
const ROUTER_URL = "https://lji-source-router.onrender.com";
const ALLOWED_PATHS = new Set(["/collect", "/verify-quinto"]);

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

function toBase64(value: ArrayBuffer): string {
  let raw = "";
  for (const b of new Uint8Array(value)) raw += String.fromCharCode(b);
  return btoa(raw);
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toBase64(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

async function verifySignature(secret: string, path: string, timestamp: string, nonce: string, bodySha256: string, signatureB64: string) {
  const signature = fromBase64(signatureB64);
  if (!signature) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const message = `POST\n${path}\n${timestamp}\n${nonce}\n${bodySha256}`;
  return crypto.subtle.verify("HMAC", key, signature, new TextEncoder().encode(message));
}

async function probeRouterAuth(secret: string) {
  const probeBody = JSON.stringify({
    source: "threads",
    state_code: "XX",
    city: "São Caetano do Sul",
    transaction_type: "sale",
    limit: 1,
  });
  const timestamp = String(Date.now());
  const nonce = crypto.randomUUID();
  const bodySha256 = await sha256(probeBody);
  const signature = await hmac(secret, `POST\n/collect\n${timestamp}\n${nonce}\n${bodySha256}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${ROUTER_URL}/collect`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-lji-auth-version": "hmac-sha256-v1",
        "x-lji-timestamp": timestamp,
        "x-lji-nonce": nonce,
        "x-lji-signature": signature,
      },
      body: probeBody,
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    const authVerified = response.status === 400 && data?.error === "state_not_supported";
    return {
      ok: authVerified,
      auth_verified: authVerified,
      router_http_status: response.status,
      router_error: data?.error ?? null,
      expected_after_auth: "state_not_supported",
      collection_performed: false,
    };
  } catch (error) {
    return {
      ok: false,
      auth_verified: false,
      router_http_status: null,
      router_error: error instanceof Error ? error.message : String(error),
      collection_performed: false,
    };
  } finally {
    clearTimeout(timer);
  }
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
      allowed_paths: [...ALLOWED_PATHS],
    });
  }

  if (body.action === "probe_router_auth") {
    const secret = namedSecret();
    if (!secret) return json({ ok: false, error: "verifier_secret_unavailable" }, 503);
    return json({
      function: FUNCTION_NAME,
      version: VERSION,
      auth_scheme: "hmac-sha256-v1",
      ...(await probeRouterAuth(secret)),
    });
  }

  const secret = namedSecret();
  if (!secret) return json({ ok: false, error: "verifier_secret_unavailable" }, 503);

  const path = String(body.path ?? "/collect").trim();
  if (!ALLOWED_PATHS.has(path)) return json({ ok: false, error: "signed_path_not_allowed" }, 400);

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

  const valid = await verifySignature(secret, path, timestamp, nonce, bodySha256, signature);
  if (!valid) return json({ ok: false, error: "signature_invalid" }, 401);

  return json({ ok: true, version: VERSION, auth_scheme: "hmac-sha256-v1", signed_path: path });
});

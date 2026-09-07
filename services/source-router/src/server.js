import http from 'node:http';
import { createHash } from 'node:crypto';
import { config } from './config.js';
import { routeCollection, validateRequest } from './router.js';

const VERSION = '1.4.0';
const MAX_BODY_BYTES = 128000;
const MAX_SKEW_MS = 120000;
const seenNonces = new Map();

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

async function readRawBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > MAX_BODY_BYTES) throw new Error('request_too_large');
  }
  return raw;
}

function pruneNonces(now) {
  for (const [nonce, expiresAt] of seenNonces.entries()) {
    if (expiresAt <= now) seenNonces.delete(nonce);
  }
}

function authHeaders(req) {
  return {
    version: String(req.headers['x-lji-auth-version'] || '').trim(),
    timestamp: String(req.headers['x-lji-timestamp'] || '').trim(),
    nonce: String(req.headers['x-lji-nonce'] || '').trim(),
    signature: String(req.headers['x-lji-signature'] || '').trim(),
  };
}

async function authorized(req, rawBody) {
  if (!config.authVerifierUrl) return { ok: false, error: 'auth_verifier_not_configured' };

  const headers = authHeaders(req);
  if (headers.version !== 'hmac-sha256-v1') return { ok: false, error: 'auth_version_invalid' };
  if (!headers.timestamp || !headers.nonce || !headers.signature) return { ok: false, error: 'auth_headers_missing' };

  const timestamp = Number(headers.timestamp);
  const now = Date.now();
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > MAX_SKEW_MS) {
    return { ok: false, error: 'auth_timestamp_invalid' };
  }
  if (headers.nonce.length < 16 || headers.nonce.length > 128) {
    return { ok: false, error: 'auth_nonce_invalid' };
  }

  pruneNonces(now);
  if (seenNonces.has(headers.nonce)) return { ok: false, error: 'auth_replay_detected' };

  const bodySha256 = createHash('sha256').update(rawBody).digest('hex');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(config.requestTimeoutMs, 10000));
  try {
    const response = await fetch(config.authVerifierUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timestamp: headers.timestamp,
        nonce: headers.nonce,
        signature: headers.signature,
        body_sha256: bodySha256,
      }),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok !== true) {
      return { ok: false, error: String(data?.error || `auth_verifier_${response.status}`) };
    }
    seenNonces.set(headers.nonce, now + MAX_SKEW_MS);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

function apifySourceStatus(source) {
  if (!config.apifyToken) return 'needs_apify_token';
  if (!config.apifyTasks?.[source]) return 'needs_apify_task';
  return 'ready_via_apify';
}

function healthPayload() {
  const sources = {
    threads: config.threadsToken ? 'ready_official_api' : 'needs_token',
    olx: apifySourceStatus('olx'),
    instagram: apifySourceStatus('instagram'),
    facebook: apifySourceStatus('facebook'),
    telegram: apifySourceStatus('telegram'),
    mercadolivre: 'disabled_pending_official_access',
  };
  const readySources = Object.entries(sources)
    .filter(([, status]) => status === 'ready_official_api' || status === 'ready_via_apify')
    .map(([source]) => source);

  return {
    ok: true,
    service: 'lji-source-router',
    version: VERSION,
    auth_scheme: 'hmac-sha256-v1',
    configured: {
      auth_verifier: Boolean(config.authVerifierUrl),
      threads_token: Boolean(config.threadsToken),
      apify_token: Boolean(config.apifyToken),
      apify_tasks: Object.fromEntries(Object.entries(config.apifyTasks || {}).map(([key, value]) => [key, Boolean(value)])),
    },
    apify_cost_guard: {
      max_total_charge_usd_per_run: config.apifyMaxChargeUsd,
      timeout_seconds: config.apifyTimeoutSecs,
    },
    collection_ready: Boolean(config.authVerifierUrl && readySources.length > 0),
    ready_sources: readySources,
    disabled_sources: ['mercadolivre'],
    sources,
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    console.log(`request ${req.method || 'UNKNOWN'} ${url.pathname}`);

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
      return send(res, 200, healthPayload());
    }

    if (req.method !== 'POST' || url.pathname !== '/collect') {
      return send(res, 404, { ok: false, error: 'not_found', version: VERSION });
    }

    const rawBody = await readRawBody(req);
    const auth = await authorized(req, rawBody);
    if (!auth.ok) return send(res, 401, { ok: false, error: auth.error || 'unauthorized', version: VERSION });

    let body;
    try {
      body = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      return send(res, 400, { ok: false, error: 'invalid_json', version: VERSION });
    }

    const validation = validateRequest(body);
    if (!validation.ok) return send(res, 400, { ok: false, error: validation.error, version: VERSION });

    const result = await routeCollection(validation.request, config);
    const status = result.ok ? 200 : result.status === 'not_configured' ? 503 : 502;
    return send(res, status, { ...result, router_version: VERSION });
  } catch (error) {
    return send(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error), version: VERSION });
  }
});

server.listen(config.port, '0.0.0.0', () => {
  console.log(`lji-source-router ${VERSION} listening on 0.0.0.0:${config.port}`);
});

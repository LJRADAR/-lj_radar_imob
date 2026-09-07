import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { config } from './config.js';
import { routeCollection, validateRequest } from './router.js';

const VERSION = '1.2.0';

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function authorized(req) {
  if (!config.routerToken) return false;
  const raw = String(req.headers.authorization || '');
  const token = raw.startsWith('Bearer ') ? raw.slice(7).trim() : '';
  if (!token) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(config.routerToken);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 128000) throw new Error('request_too_large');
  }
  return raw ? JSON.parse(raw) : {};
}

function healthPayload() {
  const sources = {
    threads: config.threadsToken ? 'ready' : 'needs_token',
    mercadolivre: 'disabled_pending_official_access',
  };
  return {
    ok: true,
    service: 'lji-source-router',
    version: VERSION,
    configured: {
      router_token: Boolean(config.routerToken),
      threads: Boolean(config.threadsToken),
      mercadolivre: false,
    },
    collection_ready: Boolean(config.routerToken && config.threadsToken),
    active_sources: ['threads'],
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
    if (!authorized(req)) return send(res, 401, { ok: false, error: 'unauthorized', version: VERSION });

    const body = await readJson(req);
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

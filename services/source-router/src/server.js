import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { config } from './config.js';
import { routeCollection, validateRequest } from './router.js';

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

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/health') {
      const sources = {
        mercadolivre: config.mercadoLivreToken ? 'ready' : 'needs_token',
        threads: config.threadsToken ? 'ready' : 'needs_token',
      };
      return send(res, 200, {
        ok: true,
        service: 'lji-source-router',
        version: '1.1.0',
        configured: {
          router_token: Boolean(config.routerToken),
          mercadolivre: Boolean(config.mercadoLivreToken),
          threads: Boolean(config.threadsToken),
        },
        collection_ready: Boolean(config.routerToken && (config.mercadoLivreToken || config.threadsToken)),
        sources,
      });
    }
    if (req.method !== 'POST' || url.pathname !== '/collect') return send(res, 404, { ok: false, error: 'not_found' });
    if (!authorized(req)) return send(res, 401, { ok: false, error: 'unauthorized' });

    const body = await readJson(req);
    const validation = validateRequest(body);
    if (!validation.ok) return send(res, 400, { ok: false, error: validation.error });

    const result = await routeCollection(validation.request, config);
    const status = result.ok ? 200 : result.status === 'not_configured' ? 503 : 502;
    return send(res, status, result);
  } catch (error) {
    return send(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(config.port, '0.0.0.0', () => {
  console.log(`lji-source-router listening on 0.0.0.0:${config.port}`);
});

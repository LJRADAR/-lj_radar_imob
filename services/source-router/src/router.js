import { collectMercadoLivre } from './adapters/mercadolivre.js';

const CORE_TARGETS = new Set([
  'Santo André', 'São Bernardo do Campo', 'São Caetano do Sul', 'Diadema',
  'São Paulo Centro Expandido', 'São Paulo Zona Sul', 'São Paulo Zona Leste', 'São Paulo Zona Oeste', 'São Paulo Zona Norte',
]);

export function validateRequest(body) {
  const request = {
    source: String(body?.source || 'mercadolivre').trim().toLowerCase(),
    state_code: String(body?.state_code || '').trim().toUpperCase(),
    city: String(body?.city || '').trim(),
    transaction_type: body?.transaction_type === 'rent' ? 'rent' : body?.transaction_type === 'sale' ? 'sale' : null,
    property_type_code: body?.property_type_code ? String(body.property_type_code).trim() : null,
    limit: Number(body?.limit || 30),
  };
  if (request.state_code !== 'SP') return { ok: false, error: 'state_not_supported' };
  if (!CORE_TARGETS.has(request.city)) return { ok: false, error: 'city_not_in_core_operation' };
  if (!request.transaction_type) return { ok: false, error: 'invalid_transaction_type' };
  if (request.source !== 'mercadolivre') return { ok: false, error: 'source_not_supported' };
  return { ok: true, request };
}

export async function routeCollection(request, config) {
  if (request.source === 'mercadolivre') {
    return collectMercadoLivre(request, { token: config.mercadoLivreToken, timeoutMs: config.requestTimeoutMs });
  }
  return { ok: false, status: 'unsupported', results: [], error: 'source_not_supported' };
}

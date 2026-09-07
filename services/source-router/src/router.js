import { collectMercadoLivre } from './adapters/mercadolivre.js';
import { collectThreads } from './adapters/threads.js';

const CORE_TARGETS = new Set([
  'Santo André', 'São Bernardo do Campo', 'São Caetano do Sul', 'Diadema',
  'São Paulo Centro Expandido', 'São Paulo Zona Sul', 'São Paulo Zona Leste', 'São Paulo Zona Oeste', 'São Paulo Zona Norte',
]);
const SOURCES = new Set(['all', 'mercadolivre', 'threads']);

export function validateRequest(body) {
  const request = {
    source: String(body?.source || 'all').trim().toLowerCase(),
    state_code: String(body?.state_code || '').trim().toUpperCase(),
    city: String(body?.city || '').trim(),
    transaction_type: body?.transaction_type === 'rent' ? 'rent' : body?.transaction_type === 'sale' ? 'sale' : null,
    property_type_code: body?.property_type_code ? String(body.property_type_code).trim() : null,
    limit: Math.max(1, Math.min(80, Number(body?.limit || 30))),
  };
  if (request.state_code !== 'SP') return { ok: false, error: 'state_not_supported' };
  if (!CORE_TARGETS.has(request.city)) return { ok: false, error: 'city_not_in_core_operation' };
  if (!request.transaction_type) return { ok: false, error: 'invalid_transaction_type' };
  if (!SOURCES.has(request.source)) return { ok: false, error: 'source_not_supported' };
  return { ok: true, request };
}

async function runAdapter(source, request, config) {
  if (source === 'mercadolivre') {
    return collectMercadoLivre(request, { token: config.mercadoLivreToken, timeoutMs: config.requestTimeoutMs });
  }
  if (source === 'threads') {
    return collectThreads(request, { token: config.threadsToken, timeoutMs: config.requestTimeoutMs });
  }
  return { ok: false, status: 'unsupported', source, results: [], error: 'source_not_supported' };
}

export async function routeCollection(request, config) {
  const requestedSources = request.source === 'all' ? ['mercadolivre', 'threads'] : [request.source];
  const settled = await Promise.all(requestedSources.map(async (source) => {
    try {
      return await runAdapter(source, request, config);
    } catch (error) {
      return { ok: false, status: 'failed', source, results: [], error: error instanceof Error ? error.message : String(error) };
    }
  }));

  const results = [];
  const sourceReport = [];
  let rawCount = 0;
  let qualifiedCount = 0;
  let readySources = 0;
  let successfulSources = 0;

  for (const result of settled) {
    const rows = Array.isArray(result?.results) ? result.results : [];
    if (result?.status !== 'not_configured') readySources += 1;
    if (result?.ok === true) successfulSources += 1;
    rawCount += Number(result?.raw_count || 0);
    qualifiedCount += Number(result?.qualified_count || rows.length);
    results.push(...rows);
    sourceReport.push({
      source: result?.source || 'unknown',
      ok: result?.ok === true,
      status: result?.status || 'unknown',
      raw_count: Number(result?.raw_count || 0),
      qualified_count: Number(result?.qualified_count || rows.length),
      error: result?.error || null,
    });
  }

  const dedup = new Map();
  for (const item of results) {
    const key = String(item?.source_url || `${item?.source_name || 'source'}:${item?.source_item_id || ''}`).trim();
    if (key && !dedup.has(key)) dedup.set(key, item);
  }
  const uniqueResults = [...dedup.values()].slice(0, request.limit);

  if (readySources === 0) {
    return {
      ok: false,
      status: 'not_configured',
      source: request.source,
      raw_count: 0,
      qualified_count: 0,
      results: [],
      source_report: sourceReport,
      error: 'no_source_configured',
    };
  }

  return {
    ok: successfulSources > 0,
    status: successfulSources === readySources ? 'completed' : successfulSources > 0 ? 'partial' : 'failed',
    source: request.source,
    raw_count: rawCount,
    qualified_count: uniqueResults.length,
    results: uniqueResults,
    source_report: sourceReport,
  };
}

import { collectThreads } from './adapters/threads.js';
import { collectApifyTask } from './adapters/apify.js';
import { canonicalSourceKey, filterQualifiedRows } from './quality.js';

const CORE_TARGETS = new Set([
  'Santo André', 'São Bernardo do Campo', 'São Caetano do Sul', 'Diadema',
  'São Paulo Centro Expandido', 'São Paulo Zona Sul', 'São Paulo Zona Leste', 'São Paulo Zona Oeste', 'São Paulo Zona Norte',
]);
const APIFY_SOURCES = new Set(['olx', 'instagram', 'facebook', 'telegram']);
const SOURCES = new Set(['all', 'threads', ...APIFY_SOURCES]);
const DISABLED_SOURCES = new Set(['mercadolivre']);

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
  if (DISABLED_SOURCES.has(request.source)) {
    return { ok: false, error: 'source_temporarily_disabled_pending_official_access' };
  }
  if (!SOURCES.has(request.source)) return { ok: false, error: 'source_not_supported' };
  return { ok: true, request };
}

function apifyTaskIdFor(source, request, config) {
  if (source === 'olx') {
    return config.apifyOlxTasks?.[request.city]
      || config.apifyTasks?.olx
      || '';
  }
  return config.apifyTasks?.[source] || '';
}

async function runAdapter(source, request, config) {
  if (source === 'threads') {
    return collectThreads(request, { token: config.threadsToken, timeoutMs: config.requestTimeoutMs });
  }
  if (APIFY_SOURCES.has(source)) {
    return collectApifyTask(request, {
      token: config.apifyToken,
      taskId: apifyTaskIdFor(source, request, config),
      source,
      timeoutMs: config.requestTimeoutMs,
      timeoutSecs: config.apifyTimeoutSecs,
      maxChargeUsd: config.apifyMaxChargeUsd,
      facebookGroupUrls: config.apifyFacebookGroupUrls,
    });
  }
  return { ok: false, status: 'unsupported', source, results: [], error: 'source_not_supported' };
}

function sourceConfigured(source, request, config) {
  if (source === 'threads') return Boolean(config.threadsToken);
  if (!APIFY_SOURCES.has(source) || !config.apifyToken) return false;
  return Boolean(apifyTaskIdFor(source, request, config));
}

function allSources(request, config) {
  const sources = [];
  if (config.threadsToken) sources.push('threads');
  for (const source of APIFY_SOURCES) {
    if (sourceConfigured(source, request, config)) sources.push(source);
  }
  return sources;
}

export async function routeCollection(request, config) {
  const requestedSources = request.source === 'all' ? allSources(request, config) : [request.source];
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
  let readySources = 0;
  let successfulSources = 0;

  for (const result of settled) {
    const rows = Array.isArray(result?.results) ? result.results : [];
    const quality = filterQualifiedRows(rows, result?.source || 'unknown');
    if (result?.status !== 'not_configured') readySources += 1;
    if (result?.ok === true) successfulSources += 1;
    rawCount += Number(result?.raw_count || 0);
    results.push(...quality.accepted);
    sourceReport.push({
      source: result?.source || 'unknown',
      provider: result?.provider || (result?.source === 'threads' ? 'threads_api' : null),
      ok: result?.ok === true,
      status: result?.status || 'unknown',
      raw_count: Number(result?.raw_count || 0),
      qualified_count: quality.accepted.length,
      quality_rejected_count: quality.rejected_count,
      quality_rejection_reasons: quality.rejection_reasons,
      error: result?.error || null,
      cost_guard: result?.cost_guard || null,
    });
  }

  const dedup = new Map();
  for (const item of results) {
    const sourceUrl = String(item?.source_url || '').trim();
    const key = sourceUrl
      ? canonicalSourceKey(sourceUrl)
      : String(`${item?.source_name || 'source'}:${item?.source_item_id || ''}`).trim();
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

  const failedErrors = sourceReport
    .filter((item) => item.ok !== true && item.error)
    .map((item) => `${item.source}:${item.error}`);

  return {
    ok: successfulSources > 0,
    status: successfulSources === readySources ? 'completed' : successfulSources > 0 ? 'partial' : 'failed',
    source: request.source,
    raw_count: rawCount,
    qualified_count: uniqueResults.length,
    results: uniqueResults,
    source_report: sourceReport,
    error: successfulSources > 0 ? null : (failedErrors.join('; ') || 'collection_failed'),
  };
}

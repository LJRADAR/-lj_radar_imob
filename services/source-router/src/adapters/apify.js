const API = 'https://api.apify.com/v2';

const SOURCE_LABELS = {
  olx: 'OLX Imóveis',
  instagram: 'Instagram público',
  facebook: 'Facebook público',
  telegram: 'Telegram público',
};

function text(value) {
  const v = String(value ?? '').trim();
  return v || null;
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function first(item, keys) {
  for (const key of keys) {
    const value = item?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return null;
}

function normalizeItem(item, request, source) {
  const url = text(first(item, ['source_url', 'url', 'link', 'permalink', 'postUrl', 'listingUrl']));
  if (!url || !/^https?:\/\//i.test(url)) return null;

  const title = text(first(item, ['title', 'name', 'caption', 'text', 'description']));
  const description = text(first(item, ['description', 'text', 'caption', 'content']));
  const city = text(first(item, ['city', 'locationCity', 'municipality'])) || request.city;
  const neighborhood = text(first(item, ['neighborhood', 'bairro', 'district']));
  const publishedAt = text(first(item, ['published_at', 'publishedAt', 'timestamp', 'date', 'createdAt']));
  const seller = text(first(item, ['seller', 'sellerName', 'username', 'ownerName', 'author']));
  const sourceItemId = text(first(item, ['source_item_id', 'id', 'postId', 'listingId', 'shortcode'])) || url;

  return {
    source_name: SOURCE_LABELS[source] || `Apify ${source}`,
    source_url: url,
    source_item_id: sourceItemId,
    title: title || description?.slice(0, 180) || null,
    description,
    price: numberOrNull(first(item, ['price', 'amount', 'value'])),
    currency: text(first(item, ['currency', 'currency_id'])) || 'BRL',
    state_code: 'SP',
    city,
    neighborhood,
    transaction_type: request.transaction_type,
    property_type: request.property_type_code || text(first(item, ['property_type', 'propertyType', 'type'])),
    published_at: publishedAt,
    seller_id: seller,
    seller_nickname: seller,
    attributes: {
      phone: text(first(item, ['phone', 'telephone', 'contactPhone'])),
      whatsapp: text(first(item, ['whatsapp', 'whatsappUrl'])),
    },
    raw_quality: {
      apify: true,
      official_api: false,
      exact_city_or_zone: false,
      task_normalized: true,
    },
    raw_apify: item,
  };
}

export async function collectApifyTask(request, {
  token,
  taskId,
  source,
  timeoutMs,
  timeoutSecs,
  maxChargeUsd,
}) {
  if (!token) {
    return { ok: false, status: 'not_configured', source, results: [], error: 'APIFY_TOKEN_missing' };
  }
  if (!taskId) {
    return { ok: false, status: 'not_configured', source, results: [], error: `APIFY_TASK_${source.toUpperCase()}_missing` };
  }

  const maxItems = Math.max(1, Math.min(80, Number(request.limit || 30)));
  const url = new URL(`${API}/actor-tasks/${encodeURIComponent(taskId)}/run-sync-get-dataset-items`);
  url.searchParams.set('clean', '1');
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', String(maxItems));
  url.searchParams.set('maxItems', String(maxItems));
  url.searchParams.set('timeout', String(timeoutSecs));
  url.searchParams.set('maxTotalChargeUsd', String(maxChargeUsd));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        lj_request: {
          state_code: request.state_code,
          city: request.city,
          transaction_type: request.transaction_type,
          property_type_code: request.property_type_code,
          limit: maxItems,
        },
        maxItems,
      }),
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      return {
        ok: false,
        status: 'failed',
        source,
        results: [],
        error: `apify_http_${response.status}`,
      };
    }

    const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.items) ? payload.items : [];
    const normalized = [];
    const seen = new Set();
    for (const item of rows) {
      const row = normalizeItem(item, request, source);
      if (!row?.source_url || seen.has(row.source_url)) continue;
      seen.add(row.source_url);
      normalized.push(row);
      if (normalized.length >= maxItems) break;
    }

    return {
      ok: true,
      status: 'completed',
      source,
      provider: 'apify',
      raw_count: rows.length,
      qualified_count: normalized.length,
      results: normalized,
      cost_guard: {
        max_total_charge_usd: maxChargeUsd,
        max_paid_dataset_items: maxItems,
      },
    };
  } catch (error) {
    return {
      ok: false,
      status: 'failed',
      source,
      results: [],
      error: error instanceof Error && error.name === 'AbortError' ? 'apify_timeout' : (error instanceof Error ? error.message : String(error)),
    };
  } finally {
    clearTimeout(timer);
  }
}

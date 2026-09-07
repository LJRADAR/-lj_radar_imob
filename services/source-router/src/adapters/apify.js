const API = 'https://api.apify.com/v2';

const SOURCE_LABELS = {
  olx: 'OLX Imóveis',
  instagram: 'Instagram público',
  facebook: 'Facebook público',
  telegram: 'Telegram público',
};

const OLX_CITY_SLUGS = {
  'sao caetano do sul': 'sao-caetano-do-sul',
  'santo andre': 'santo-andre',
  'sao bernardo do campo': 'sao-bernardo-do-campo',
  diadema: 'diadema',
};

function text(value) {
  const v = String(value ?? '').trim();
  return v || null;
}

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
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

function nested(item, paths) {
  for (const path of paths) {
    let value = item;
    for (const part of path.split('.')) value = value?.[part];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return null;
}

function cityMatches(expected, actual) {
  const a = normalizeText(expected);
  const b = normalizeText(actual);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a === 'sao bernardo do campo') return b === 'sao bernardo' || b === 'sbc';
  if (a === 'sao caetano do sul') return b === 'sao caetano';
  return false;
}

function olxSearchUrl(request) {
  const citySlug = OLX_CITY_SLUGS[normalizeText(request.city)];
  if (!citySlug) return null;
  const operation = request.transaction_type === 'rent' ? 'aluguel' : 'venda';
  const property = normalizeText(request.property_type_code);
  let segment = '';
  if (['apartamento', 'apto', 'apartment'].includes(property)) segment = '/apartamentos';
  else if (['casa', 'sobrado', 'house', 'home'].includes(property)) segment = '/casas';
  return `https://www.olx.com.br/imoveis/${operation}${segment}/estado-sp/sao-paulo-e-regiao/${citySlug}`;
}

function buildTaskInput(request, source, maxItems) {
  if (source === 'olx') {
    const searchUrl = olxSearchUrl(request);
    if (!searchUrl) return null;
    return {
      searchUrls: [searchUrl],
      maxResults: maxItems,
      sortBy: 'Newest First',
      enrichDetails: true,
      includeBusinessOnly: false,
    };
  }

  // Social Tasks are intentionally configured in Apify Console with curated
  // public search/channel defaults. lj_request is supplied for traceability;
  // Router-side qualification remains mandatory before promotion.
  return {
    lj_request: {
      state_code: request.state_code,
      city: request.city,
      transaction_type: request.transaction_type,
      property_type_code: request.property_type_code,
      limit: maxItems,
    },
    maxItems,
  };
}

function normalizeItem(item, request, source) {
  const url = text(first(item, ['source_url', 'url', 'link', 'permalink', 'postUrl', 'listingUrl']));
  if (!url || !/^https?:\/\//i.test(url)) return null;

  const title = text(first(item, ['title', 'name', 'caption', 'text', 'description']));
  const description = text(first(item, ['description', 'text', 'caption', 'content']));
  const actualCity = text(first(item, ['city', 'locationCity', 'municipality']));
  if (source === 'olx' && (!actualCity || !cityMatches(request.city, actualCity))) return null;
  const city = actualCity || request.city;
  const neighborhood = text(first(item, ['neighborhood', 'bairro', 'district']));
  const publishedAt = text(first(item, ['published_at', 'publishedAt', 'postedAt', 'timestamp', 'date', 'createdAt', 'takenAtIso']));
  const seller = text(nested(item, ['seller.name', 'seller.username', 'owner.username', 'owner.fullName']))
    || text(first(item, ['sellerName', 'username', 'ownerName', 'author', 'ownerUsername']));
  const sellerType = text(nested(item, ['seller.type'])) || text(first(item, ['sellerType', 'accountType']));
  const sourceItemId = text(first(item, ['source_item_id', 'id', 'postId', 'listingId', 'shortcode', 'shortCode'])) || url;

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
    property_type: request.property_type_code || text(first(item, ['property_type', 'propertyType', 'type', 'categoryName'])),
    published_at: publishedAt,
    seller_id: text(nested(item, ['seller.id', 'owner.id'])) || seller,
    seller_nickname: seller,
    attributes: {
      phone: text(first(item, ['phone', 'telephone', 'contactPhone'])),
      whatsapp: text(first(item, ['whatsapp', 'whatsappUrl'])),
      seller_type: sellerType,
      phone_available: first(item, ['phoneAvailable', 'hasPhone']) ?? null,
      postal_code: text(first(item, ['zipcode', 'postalCode', 'cep'])),
      category_name: text(first(item, ['categoryName', 'category'])),
      properties: Array.isArray(item?.properties) ? item.properties : [],
    },
    raw_quality: {
      apify: true,
      official_api: false,
      exact_city_or_zone: source === 'olx',
      task_normalized: true,
      source_profile: source === 'olx' ? 'solidcode/olx-brazil-scraper' : 'curated_task',
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
  const taskInput = buildTaskInput(request, source, maxItems);
  if (!taskInput) {
    return { ok: false, status: 'unsupported_target', source, results: [], error: `${source}_target_not_supported_by_pilot` };
  }

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
      body: JSON.stringify(taskInput),
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

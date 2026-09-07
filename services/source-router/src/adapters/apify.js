import { locationMatchesTarget } from '../normalize.js';

const API = 'https://api.apify.com/v2';

const SOURCE_LABELS = {
  olx: 'OLX Imóveis',
  instagram: 'Instagram público',
  facebook: 'Facebook público',
  telegram: 'Telegram público',
};

const OLX_SEARCH_TARGETS = {
  'São Caetano do Sul': 'São Caetano do Sul SP',
  'Santo André': 'Santo André SP',
  'São Bernardo do Campo': 'São Bernardo do Campo SP',
  'Diadema': 'Diadema SP',
  'São Paulo Centro Expandido': 'Centro São Paulo SP',
  'São Paulo Zona Sul': 'Zona Sul São Paulo SP',
  'São Paulo Zona Leste': 'Zona Leste São Paulo SP',
  'São Paulo Zona Oeste': 'Zona Oeste São Paulo SP',
  'São Paulo Zona Norte': 'Zona Norte São Paulo SP',
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
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const raw = String(value).trim().replace(/[^0-9,.-]/g, '');
  if (!raw) return null;
  let normalized = raw;
  const comma = normalized.lastIndexOf(',');
  const dot = normalized.lastIndexOf('.');
  if (comma > dot) normalized = normalized.replace(/\./g, '').replace(',', '.');
  else if (dot > comma) normalized = normalized.replace(/,/g, '');
  else normalized = normalized.replace(/,/g, '.');
  const n = Number(normalized);
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

function normalizePropertyType(value) {
  const n = normalizeText(value);
  if (!n) return null;
  if (/\b(apartamento|apartamentos|apto|apartment)\b/.test(n)) return 'Apartamento';
  if (/\b(casa|casas|sobrado|sobrados|house|home)\b/.test(n)) return 'Casa';
  if (/\b(cobertura|coberturas|penthouse)\b/.test(n)) return 'Cobertura';
  if (/\b(studio|studios|kitnet|kitnets|flat)\b/.test(n)) return 'Studio';
  return text(value);
}

function propertyMetric(properties, labels) {
  if (!Array.isArray(properties)) return null;
  const wanted = labels.map(normalizeText);
  for (const entry of properties) {
    const name = normalizeText(entry?.name ?? entry?.label ?? entry?.key);
    if (!name || !wanted.some((label) => name === label || name.includes(label))) continue;
    const value = numberOrNull(entry?.value ?? entry?.values?.[0]);
    if (value !== null) return value;
  }
  return null;
}

function olxSearchQuery(request) {
  const target = OLX_SEARCH_TARGETS[request.city];
  if (!target) return null;
  const operation = request.transaction_type === 'rent' ? 'aluguel' : 'venda';
  const property = normalizePropertyType(request.property_type_code) || 'Imóvel';
  return `${property} ${operation} ${target}`;
}

export function buildTaskInput(request, source, maxItems) {
  if (source === 'olx') {
    const searchQuery = olxSearchQuery(request);
    if (!searchQuery) return null;
    return {
      searchQueries: [searchQuery],
      maxResults: maxItems,
      sortBy: 'relevance',
      state: 'SP',
      enrichDetails: false,
      includeBusinessOnly: false,
    };
  }

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
  const neighborhood = text(first(item, ['neighborhood', 'neighbourhood', 'bairro', 'district']));
  if (source === 'olx' && (!actualCity || !locationMatchesTarget(request.city, actualCity, neighborhood || ''))) return null;
  const city = actualCity || request.city;
  const publishedAt = text(first(item, ['published_at', 'publishedAt', 'postedAt', 'timestamp', 'date', 'createdAt', 'takenAtIso']));
  const seller = text(nested(item, ['seller.name', 'seller.username', 'owner.username', 'owner.fullName']))
    || text(first(item, ['sellerName', 'username', 'ownerName', 'author', 'ownerUsername']));
  const sellerType = text(nested(item, ['seller.type'])) || text(first(item, ['sellerType', 'accountType']));
  const sourceItemId = text(first(item, ['source_item_id', 'id', 'postId', 'listingId', 'shortcode', 'shortCode'])) || url;
  const properties = Array.isArray(item?.properties) ? item.properties : [];
  const images = Array.isArray(item?.photos) ? item.photos : Array.isArray(item?.images) ? item.images : [];
  const category = text(first(item, ['property_type', 'propertyType', 'type', 'categoryName', 'category']));

  const areaM2 = numberOrNull(first(item, ['area_m2', 'areaM2', 'area', 'floorSize']))
    ?? propertyMetric(properties, ['Área útil', 'Area util', 'Área', 'Area', 'Metragem']);
  const bedrooms = numberOrNull(first(item, ['bedrooms', 'bedroomCount', 'rooms']))
    ?? propertyMetric(properties, ['Quartos', 'Dormitórios', 'Dormitorios']);
  const bathrooms = numberOrNull(first(item, ['bathrooms', 'bathroomCount']))
    ?? propertyMetric(properties, ['Banheiros', 'Banheiro']);
  const parkingSpaces = numberOrNull(first(item, ['parking_spaces', 'parkingSpaces', 'parking']))
    ?? propertyMetric(properties, ['Vagas na garagem', 'Vagas de garagem', 'Vagas', 'Garagem']);

  return {
    source_name: SOURCE_LABELS[source] || `Apify ${source}`,
    source_url: url,
    source_item_id: sourceItemId,
    title: title || description?.slice(0, 180) || null,
    description,
    price: numberOrNull(first(item, ['price', 'amount', 'value'])),
    currency: text(first(item, ['currency', 'currency_id'])) || 'BRL',
    state_code: text(first(item, ['state', 'state_code', 'stateCode'])) || 'SP',
    city,
    neighborhood,
    transaction_type: request.transaction_type,
    property_type: normalizePropertyType(request.property_type_code) || normalizePropertyType(category),
    published_at: publishedAt,
    seller_id: text(nested(item, ['seller.id', 'owner.id'])) || seller,
    seller_nickname: seller,
    seller_type: sellerType,
    area_m2: areaM2,
    bedrooms: bedrooms !== null ? Math.max(0, Math.trunc(bedrooms)) : null,
    bathrooms: bathrooms !== null ? Math.max(0, Math.trunc(bathrooms)) : null,
    parking_spaces: parkingSpaces !== null ? Math.max(0, Math.trunc(parkingSpaces)) : null,
    postal_code: text(first(item, ['zipcode', 'postalCode', 'cep'])),
    main_image_url: text(first(item, ['thumbnailUrl', 'imageUrl', 'mainImageUrl'])) || text(images[0]),
    attributes: {
      phone: text(first(item, ['phone', 'telephone', 'contactPhone'])),
      whatsapp: text(first(item, ['whatsapp', 'whatsappUrl'])),
      seller_type: sellerType,
      phone_available: nested(item, ['seller.phoneAvailable']) ?? first(item, ['phoneAvailable', 'hasPhone']) ?? null,
      postal_code: text(first(item, ['zipcode', 'postalCode', 'cep'])),
      category_name: text(first(item, ['categoryName', 'category'])),
      properties,
      requested_target: request.city,
      requested_transaction_type: request.transaction_type,
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

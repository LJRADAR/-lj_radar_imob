import { locationMatchStatus } from '../normalize.js';

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

const FACEBOOK_GROUP_URLS = [
  'https://www.facebook.com/groups/alugarzonaleste',
];

function text(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
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

export function parseMoney(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (/\d\s*(?:a|até|ate|[-–])\s*\d/i.test(String(value))) return null;
  let raw = String(value).trim().replace(/[^0-9,.-]/g, '');
  if (!raw) return null;

  const negative = raw.startsWith('-');
  raw = raw.replace(/-/g, '');
  const commaCount = (raw.match(/,/g) || []).length;
  const dotCount = (raw.match(/\./g) || []).length;
  const comma = raw.lastIndexOf(',');
  const dot = raw.lastIndexOf('.');
  let normalized = raw;

  if (commaCount && dotCount) {
    const decimalIndex = Math.max(comma, dot);
    const decimalDigits = raw.length - decimalIndex - 1;
    if (decimalDigits === 1 || decimalDigits === 2) {
      const integerPart = raw.slice(0, decimalIndex).replace(/[.,]/g, '');
      const decimalPart = raw.slice(decimalIndex + 1).replace(/[.,]/g, '');
      normalized = `${integerPart}.${decimalPart}`;
    } else {
      normalized = raw.replace(/[.,]/g, '');
    }
  } else if (commaCount || dotCount) {
    const sep = commaCount ? ',' : '.';
    const parts = raw.split(sep);
    const tail = parts.at(-1) || '';
    if (parts.length > 2) {
      if (tail.length === 1 || tail.length === 2) {
        normalized = `${parts.slice(0, -1).join('')}.${tail}`;
      } else {
        normalized = parts.join('');
      }
    } else if (tail.length === 3) {
      normalized = parts.join('');
    } else if (tail.length === 1 || tail.length === 2) {
      normalized = `${parts[0]}.${tail}`;
    } else {
      normalized = parts.join('');
    }
  }

  const n = Number(`${negative ? '-' : ''}${normalized}`);
  return Number.isFinite(n) ? n : null;
}

export function parseCount(value) {
  if (value === null || value === undefined || value === '') return null;
  const raw = String(value).trim();
  if (!/^\d{1,3}(?:\s*(?:quartos?|dormit[oó]rios?|banheiros?|vagas?|beds?|baths?))?$/i.test(raw)) return null;
  const count = Number(raw.match(/^\d+/)[0]);
  return count <= 100 ? count : null;
}

const STATE_NAMES = ['Acre','Alagoas','Amapá','Amazonas','Bahia','Ceará','Distrito Federal','Espírito Santo','Goiás','Maranhão','Mato Grosso','Mato Grosso do Sul','Minas Gerais','Pará','Paraíba','Paraná','Pernambuco','Piauí','Rio de Janeiro','Rio Grande do Norte','Rio Grande do Sul','Rondônia','Roraima','Santa Catarina','São Paulo','Sergipe','Tocantins'];
const STATE_CODES = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
export function normalizeStateCode(value) {
  const raw = text(value);
  if (!raw) return null;
  if (STATE_CODES.includes(raw.toUpperCase())) return raw.toUpperCase();
  const index = STATE_NAMES.findIndex(name => normalizeText(name) === normalizeText(raw));
  return index < 0 ? null : STATE_CODES[index];
}

function safeImage(value) {
  const raw = text(value) || text(value?.url) || text(value?.uri) || text(value?.src);
  try { const u = new URL(raw); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password ? u.href : null; }
  catch { return null; }
}

function validPhone(value, allowLocal = false) {
  const raw = text(value);
  if (!raw || !/^[+\d\s().-]+$/.test(raw)) return null;
  let digits = raw.replace(/\D/g, '');
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) digits = digits.slice(2);
  if (/^(\d)\1+$/.test(digits)) return null;
  if (digits.length === 10 || digits.length === 11) {
    if (!/^[1-9][1-9]/.test(digits)) return null;
    return (digits.length === 11 ? /^9\d{8}$/ : /^[2-5]\d{7}$/).test(digits.slice(2)) ? raw : null;
  }
  return allowLocal && /^(?:9\d{8}|[2-5]\d{7})$/.test(digits) ? raw : null;
}

function textBlob(title, description) {
  return normalizeText(`${title || ''} ${description || ''}`);
}

export function inferTransactionType(title, description, fallback = null) {
  const n = textBlob(title, description);
  const rent = /\b(alugo|aluga|alugue|aluguel|alugar|locacao|locar|arrendo|arrendamento|for rent)\b/.test(n);
  const sale = /\b(vendo|vende|venda|a venda|para venda|for sale)\b/.test(n);
  if (rent && !sale) return 'rent';
  if (sale && !rent) return 'sale';
  if (/\b(permuta|permutar|troco|troca por imovel|aceita troca)\b/.test(n) && !rent) return 'sale';
  return fallback === 'rent' || fallback === 'sale' ? fallback : null;
}

export function parseFacebookLocation(value) {
  const raw = text(value);
  if (!raw) return { city: null, state_code: null };
  const parts = raw.split(',').map((part) => part.trim()).filter(Boolean);
  let state = null;
  if (parts.length > 1) {
    const candidate = parts.at(-1).replace(/[^A-Za-z]/g, '').toUpperCase();
    if (/^[A-Z]{2}$/.test(candidate)) state = candidate;
  }
  return { city: parts[0] || null, state_code: state };
}

function inferCoreCityFromText(title, description) {
  const n = textBlob(title, description);
  const cities = [
    ['São Caetano do Sul', /\bsao caetano(?: do sul)?\b/],
    ['São Bernardo do Campo', /\bsao bernardo(?: do campo)?\b/],
    ['Santo André', /\bsanto andre\b/],
    ['Diadema', /\bdiadema\b/],
    ['São Paulo', /\bsao paulo\b/],
  ];
  for (const [city, pattern] of cities) if (pattern.test(n)) return city;
  return null;
}

function inferPropertyTypeFromText(title, description) {
  const n = textBlob(title, description);
  if (/\b(apartamento|apartamentos|apto|aptos|apartment|apartments)\b/.test(n)) return 'Apartamento';
  if (/\b(casa|casas|sobrado|sobrados|house|houses|home|homes)\b/.test(n)) return 'Casa';
  if (/\b(cobertura|coberturas|penthouse)\b/.test(n)) return 'Cobertura';
  if (/\b(studio|studios|kitnet|kitnets|flat|flats)\b/.test(n)) return 'Studio';
  if (/\b(terreno|terrenos|lote|lotes)\b/.test(n)) return 'Terreno';
  return null;
}

function metricFromText(title, description, patterns) {
  const n = `${title || ''} ${description || ''}`;
  for (const pattern of patterns) {
    const match = n.match(pattern);
    if (match?.[1]) {
      const value = Number(match[1]);
      if (Number.isFinite(value)) return value;
    }
  }
  return null;
}

function scaledPrice(value, scale) {
  const base = parseMoney(value);
  if (base === null) return null;
  const n = normalizeText(scale);
  if (n.startsWith('milhao') || n.startsWith('milhoes')) return base * 1000000;
  if (n === 'mil') return base * 1000;
  return base;
}

function priceFromText(title, description, transactionType) {
  const raw = `${title || ''} ${description || ''}`;
  const labels = transactionType === 'rent'
    ? /(?:aluguel|loca(?:c|ç)[aã]o|alugo|aluga[- ]?se|pre[cç]o|valor)\s*(?:de|por)?\s*[:=,.-]?\s*(?:R\$\s*)?([0-9][0-9.,]*)\s*(milh(?:a|ã)o(?:es)?|mil)?/i
    : /(?:pre[cç]o|valor|vendo|venda)\s*(?:de|por)?\s*[:=,.-]?\s*(?:R\$\s*)?([0-9][0-9.,]*)\s*(milh(?:a|ã)o(?:es)?|mil)?/i;
  const specific = raw.match(labels);
  if (specific?.[1]) return scaledPrice(specific[1], specific[2]);
  const currency = raw.match(/R\$\s*([0-9][0-9.,]*)\s*(milh(?:a|ã)o(?:es)?|mil)?/i);
  if (currency?.[1]) return scaledPrice(currency[1], currency[2]);
  const reais = raw.match(/([0-9][0-9.,]*)\s*(milh(?:a|ã)o(?:es)?|mil)?\s*(?:reais|real)\b/i);
  return reais?.[1] ? scaledPrice(reais[1], reais[2]) : null;
}

function contactPhoneFromText(title, description) {
  const raw = `${title || ''} ${description || ''}`;
  const candidates = raw.matchAll(/(?<!\d)(?:\+?55[\s.-]*)?(?:\(?\d{2}\)?[\s.-]*)?(?:9\d{4}[-\s]?\d{2}[-\s]?\d{2}|[2-5]\d{3}[-\s]?\d{4})(?!\d)/g);
  for (const match of candidates) {
    const before = raw.slice(Math.max(0, match.index - 45), match.index);
    if (/(?:R\$|valor|pre[cç]o|CEP|c[oó]digo)\s*[:=.-]?\s*$/i.test(before)) continue;
    const labeled = /(?:whats(?:app)?|zap|wpp|telefone|fone|contato|informa[cç][oõ]es|interessados)\D{0,28}$/i.test(before);
    const phone = validPhone(match[0], labeled);
    if (phone) return phone;
  }
  return null;
}

function whatsappFromText(title, description) {
  const raw = `${title || ''} ${description || ''}`;
  const match = raw.match(/https?:\/\/(?:wa\.me|api\.whatsapp\.com)\/[^\s]+/i);
  return match ? match[0] : null;
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

function safeApifyError(payload) {
  const error = payload && typeof payload === 'object' ? payload.error : null;
  if (!error || typeof error !== 'object') return null;
  const detail = {
    type: text(error.type),
    message: text(error.message)?.slice(0, 500) || null,
    approval_url: text(error.data?.approvalUrl),
  };
  return Object.values(detail).some(Boolean) ? detail : null;
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

function propertyMetric(properties, labels, parser = parseMoney) {
  if (!Array.isArray(properties)) return null;
  const wanted = labels.map(normalizeText);
  for (const entry of properties) {
    const name = normalizeText(entry?.name ?? entry?.label ?? entry?.key);
    if (!name || !wanted.some((label) => name === label || name.includes(label))) continue;
    const value = parser(entry?.value ?? entry?.values?.[0]);
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

export function buildTaskInput(request, source, maxItems, facebookGroupUrls = FACEBOOK_GROUP_URLS) {
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

  if (source === 'facebook') {
    const groups = Array.isArray(facebookGroupUrls) && facebookGroupUrls.length
      ? facebookGroupUrls
      : FACEBOOK_GROUP_URLS;
    return {
      resultsLimit: maxItems,
      startUrls: groups.map((url) => ({ url })),
      viewOption: 'CHRONOLOGICAL',
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

export function normalizeApifyItem(item, request, source) {
  const url = text(first(item, ['source_url', 'url', 'link', 'permalink', 'postUrl', 'listingUrl']));
  if (!url || !/^https?:\/\//i.test(url)) return null;

  const title = text(first(item, ['title', 'name', 'caption', 'text', 'description']));
  const description = text(first(item, ['description', 'text', 'caption', 'content']));
  const rawLocation = text(first(item, ['location', 'locationName', 'placeName']));
  const facebookLocation = source === 'facebook' ? parseFacebookLocation(rawLocation) : { city: null, state_code: null };
  const directCity = text(first(item, ['city', 'locationCity', 'municipality']));
  const actualCity = text(directCity || facebookLocation.city || (source === 'facebook' ? inferCoreCityFromText(title, description) : null))?.normalize('NFC') || null;
  const neighborhood = text(first(item, ['neighborhood', 'neighbourhood', 'bairro', 'district']));
  const geoStatus = locationMatchStatus(request.city, actualCity, neighborhood || '');
  if (source === 'olx' && (!actualCity || geoStatus === 'outside')) return null;
  const city = actualCity || (source === 'olx' ? request.city : null);
  const publishedAt = text(first(item, ['published_at', 'publishedAt', 'postedAt', 'timestamp', 'time', 'date', 'createdAt', 'takenAtIso']));
  const seller = text(nested(item, ['seller.name', 'seller.username', 'owner.username', 'owner.fullName', 'user.name']))
    || text(first(item, ['sellerName', 'username', 'ownerName', 'author', 'ownerUsername']));
  const sellerType = text(nested(item, ['seller.type'])) || text(first(item, ['sellerType', 'accountType']));
  const sourceItemId = text(first(item, ['source_item_id', 'id', 'postId', 'listingId', 'shortcode', 'shortCode'])) || url;
  const properties = Array.isArray(item?.properties) ? item.properties : [];
  const images = Array.isArray(item?.photos) ? item.photos : Array.isArray(item?.images) ? item.images : [];
  const attachments = Array.isArray(item?.attachments) ? item.attachments : [];
  const attachmentOcrText = attachments
    .map((entry) => text(entry?.ocrText))
    .filter(Boolean)
    .join('\n');
  const inferenceDescription = [description, attachmentOcrText].filter(Boolean).join('\n');
  const category = text(first(item, ['property_type', 'propertyType', 'type', 'categoryName', 'category']));
  const transactionType = source === 'facebook'
    ? inferTransactionType(title, inferenceDescription, request.transaction_type)
    : request.transaction_type;
  const propertyType = source === 'facebook'
    ? normalizePropertyType(category) || inferPropertyTypeFromText(title, inferenceDescription) || normalizePropertyType(request.property_type_code)
    : normalizePropertyType(request.property_type_code) || normalizePropertyType(category) || inferPropertyTypeFromText(title, inferenceDescription);

  const areaM2 = parseMoney(first(item, ['area_m2', 'areaM2', 'area', 'floorSize']))
    ?? propertyMetric(properties, ['Área útil', 'Area util', 'Área', 'Area', 'Metragem']);
  const bedrooms = parseCount(first(item, ['bedrooms', 'bedroomCount', 'rooms']))
    ?? propertyMetric(properties, ['Quartos', 'Dormitórios', 'Dormitorios'], parseCount)
    ?? metricFromText(title, inferenceDescription, [/(\d+)\s*(?:dorm(?:it[oó]rios?)?|quartos?|beds?)\b/i]);
  const bathrooms = parseCount(first(item, ['bathrooms', 'bathroomCount']))
    ?? propertyMetric(properties, ['Banheiros', 'Banheiro'], parseCount)
    ?? metricFromText(title, inferenceDescription, [/(\d+)\s*(?:banheiros?|baths?)\b/i]);
  const parkingSpaces = parseCount(first(item, ['parking_spaces', 'parkingSpaces', 'parking']))
    ?? propertyMetric(properties, ['Vagas na garagem', 'Vagas de garagem', 'Vagas', 'Garagem'], parseCount)
    ?? metricFromText(title, inferenceDescription, [/(\d+)\s*(?:vagas?|garagens?)\b/i]);
  const providerPrice = parseMoney(first(item, ['price', 'amount', 'value']));
  const price = providerPrice === null || providerPrice <= 0
    ? priceFromText(title, inferenceDescription, transactionType)
    : providerPrice ?? priceFromText(title, inferenceDescription, transactionType);
  const phone = validPhone(first(item, ['phone', 'telephone', 'contactPhone']), true) || contactPhoneFromText(title, inferenceDescription);
  const whatsapp = text(first(item, ['whatsapp', 'whatsappUrl'])) || whatsappFromText(title, inferenceDescription);
  const attachmentImage = attachments
    .map((entry) => text(entry?.thumbnail) || text(entry?.photo_image?.uri) || text(entry?.image?.uri))
    .find(Boolean) || null;
  const tradeSignal = /\b(permuta|permutar|troco|troca por imovel|aceita troca)\b/.test(textBlob(title, inferenceDescription));

  return {
    source_name: SOURCE_LABELS[source] || `Apify ${source}`,
    source_url: url,
    source_item_id: sourceItemId,
    title: title || description?.slice(0, 180) || null,
    description,
    price,
    currency: text(first(item, ['currency', 'currency_id'])) || 'BRL',
    state_code: normalizeStateCode(first(item, ['state_code', 'stateCode', 'state'])) || facebookLocation.state_code || null,
    city,
    neighborhood,
    transaction_type: transactionType,
    property_type: propertyType,
    published_at: publishedAt,
    seller_id: text(nested(item, ['seller.id', 'owner.id', 'user.id'])) || seller,
    seller_nickname: seller,
    seller_type: sellerType,
    area_m2: areaM2,
    bedrooms: bedrooms !== null ? Math.max(0, Math.trunc(bedrooms)) : null,
    bathrooms: bathrooms !== null ? Math.max(0, Math.trunc(bathrooms)) : null,
    parking_spaces: parkingSpaces !== null ? Math.max(0, Math.trunc(parkingSpaces)) : null,
    postal_code: text(first(item, ['zipcode', 'postalCode', 'cep'])),
    main_image_url: safeImage(first(item, ['thumbnailUrl', 'imageUrl', 'mainImageUrl'])) || images.map(safeImage).find(Boolean) || safeImage(attachmentImage),
    attributes: {
      phone,
      whatsapp,
      seller_type: sellerType,
      phone_available: nested(item, ['seller.phoneAvailable']) ?? first(item, ['phoneAvailable', 'hasPhone']) ?? Boolean(phone),
      postal_code: text(first(item, ['zipcode', 'postalCode', 'cep'])),
      category_name: text(first(item, ['categoryName', 'category'])),
      facebook_group_url: text(first(item, ['facebookUrl', 'inputUrl'])),
      facebook_group_title: text(first(item, ['groupTitle'])),
      raw_location: rawLocation,
      attachment_ocr_text: attachmentOcrText || null,
      transaction_inferred: transactionType !== request.transaction_type,
      trade_signal: tradeSignal,
      properties,
      requested_target: request.city,
      requested_transaction_type: request.transaction_type,
    },
    raw_quality: {
      apify: true,
      official_api: false,
      exact_city_or_zone: source === 'olx' && geoStatus === 'exact',
      zone_verification: source === 'olx' ? geoStatus : 'not_applicable',
      task_normalized: true,
      source_profile: source === 'olx'
        ? 'solidcode/olx-brazil-scraper'
        : source === 'facebook'
          ? 'apify/facebook-groups-scraper'
          : 'curated_task',
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
  facebookGroupUrls,
}) {
  if (!token) {
    return { ok: false, status: 'not_configured', source, results: [], error: 'APIFY_TOKEN_missing' };
  }
  if (!taskId) {
    return { ok: false, status: 'not_configured', source, results: [], error: `APIFY_TASK_${source.toUpperCase()}_missing` };
  }

  const maxItems = Math.max(1, Math.min(200, Number(request.limit || 30)));
  const taskInput = buildTaskInput(request, source, maxItems, facebookGroupUrls);
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
      const apify_error = safeApifyError(payload);
      console.error('Apify request failed', JSON.stringify({
        status: response.status,
        source,
        task_id: taskId,
        apify_error,
      }));
      return {
        ok: false,
        status: 'failed',
        source,
        results: [],
        error: `apify_http_${response.status}`,
        apify_error,
      };
    }

    const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.items) ? payload.items : [];
    const normalized = [];
    const seen = new Set();
    for (const item of rows) {
      const row = normalizeApifyItem(item, request, source);
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

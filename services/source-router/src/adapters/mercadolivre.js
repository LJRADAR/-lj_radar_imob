import { fetchJson } from '../http.js';
import { canonicalCity, locationMatchesTarget, normalizeText } from '../normalize.js';

const API = 'https://api.mercadolibre.com';
const SITE = 'MLB';
const cache = new Map();

function categoryMatch(name, target) {
  const n = normalizeText(name);
  return target.some((term) => n === term || n.includes(term));
}

function propertyTerms(code) {
  const n = normalizeText(code).replace(/[_-]+/g, ' ');
  if (!n || ['apartamento','apto','apartment'].includes(n)) return ['apartamento','apartamentos'];
  if (['casa','sobrado','house','home'].includes(n)) return ['casa','casas','sobrado','sobrados'];
  if (['studio','kitnet','flat'].includes(n)) return ['studio','studios','kitnet','kitnets','flat','flats'];
  if (['cobertura','penthouse'].includes(n)) return ['cobertura','coberturas'];
  return [n];
}

function operationTerms(tx) {
  return tx === 'rent' ? ['aluguel','alugar','locacao'] : ['venda','vender'];
}

async function category(id, token, timeoutMs) {
  const key = `category:${id}`;
  if (cache.has(key)) return cache.get(key);
  const value = await fetchJson(`${API}/categories/${encodeURIComponent(id)}`, { token, timeoutMs });
  cache.set(key, value);
  return value;
}

async function realEstateRoot(token, timeoutMs) {
  const key = 'root:MLB';
  if (cache.has(key)) return cache.get(key);
  const categories = await fetchJson(`${API}/sites/${SITE}/categories`, { token, timeoutMs });
  const root = Array.isArray(categories) ? categories.find((c) => normalizeText(c?.name) === 'imoveis') : null;
  if (!root?.id) throw new Error('mercadolivre_real_estate_category_not_found');
  cache.set(key, root.id);
  return root.id;
}

async function leafCategory(token, timeoutMs, propertyType, transactionType) {
  const cacheKey = `leaf:${normalizeText(propertyType)}:${transactionType}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const rootId = await realEstateRoot(token, timeoutMs);
  const root = await category(rootId, token, timeoutMs);
  const propertyChild = (root?.children_categories || []).find((c) => categoryMatch(c?.name, propertyTerms(propertyType)));
  if (!propertyChild?.id) throw new Error('mercadolivre_property_category_not_found');

  const property = await category(propertyChild.id, token, timeoutMs);
  const operationChild = (property?.children_categories || []).find((c) => categoryMatch(c?.name, operationTerms(transactionType)));
  if (!operationChild?.id) throw new Error('mercadolivre_operation_category_not_found');

  cache.set(cacheKey, operationChild.id);
  return operationChild.id;
}

function attributeMap(attributes) {
  const out = {};
  for (const attr of Array.isArray(attributes) ? attributes : []) {
    const key = normalizeText(attr?.id || attr?.name).replace(/\s+/g, '_');
    const value = attr?.value_name ?? attr?.value_struct?.number ?? null;
    if (key && value !== null && value !== undefined) out[key] = value;
  }
  return out;
}

function normalizedItem(item, request) {
  const attrs = attributeMap(item?.attributes);
  const address = item?.address || {};
  const seller = item?.seller || {};
  const city = address?.city_name || address?.city?.name || '';
  const neighborhood = address?.neighborhood?.name || address?.neighborhood_name || '';
  if (!locationMatchesTarget(request.city, city, neighborhood)) return null;

  return {
    source_name: 'Mercado Livre Imóveis',
    source_url: String(item?.permalink || '').trim(),
    source_item_id: String(item?.id || '').trim(),
    title: String(item?.title || '').trim(),
    description: null,
    price: Number.isFinite(Number(item?.price)) ? Number(item.price) : null,
    currency: String(item?.currency_id || 'BRL'),
    state_code: 'SP',
    city: canonicalCity(request.city),
    neighborhood: neighborhood || null,
    transaction_type: request.transaction_type,
    property_type: request.property_type_code || null,
    published_at: item?.date_created || null,
    seller_id: seller?.id ? String(seller.id) : null,
    seller_nickname: seller?.nickname || null,
    attributes: attrs,
    raw_quality: {
      exact_city_or_zone: true,
      official_api: true,
    },
  };
}

export async function collectMercadoLivre(request, { token, timeoutMs }) {
  if (!token) {
    return { ok: false, status: 'not_configured', source: 'mercadolivre', results: [], error: 'MERCADOLIVRE_ACCESS_TOKEN_missing' };
  }
  const categoryId = await leafCategory(token, timeoutMs, request.property_type_code, request.transaction_type);
  const q = canonicalCity(request.city);
  const limit = Math.max(1, Math.min(50, Number(request.limit || 30)));
  const url = new URL(`${API}/sites/${SITE}/search`);
  url.searchParams.set('category', categoryId);
  url.searchParams.set('q', q);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('include_filters', 'false');

  const payload = await fetchJson(url.toString(), { token, timeoutMs });
  const results = (Array.isArray(payload?.results) ? payload.results : [])
    .map((item) => normalizedItem(item, request))
    .filter(Boolean);

  return {
    ok: true,
    status: 'completed',
    source: 'mercadolivre',
    category_id: categoryId,
    raw_count: Array.isArray(payload?.results) ? payload.results.length : 0,
    qualified_count: results.length,
    results,
  };
}

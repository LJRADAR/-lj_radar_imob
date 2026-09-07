import { fetchJson } from '../http.js';
import { canonicalCity, normalizeText } from '../normalize.js';

const API = 'https://graph.threads.net';
const FIELDS = 'id,media_product_type,media_type,permalink,username,text,timestamp,shortcode,is_quote_post,has_replies';

function professional(text) {
  return /\b(imobiliaria|corretor(?:a)?|creci|consultor(?:a)?\s+imobiliari|incorporadora|construtora|empreendimentos|lancamento imobiliario)\b/.test(normalizeText(text));
}

function ownerSignal(text, tx) {
  const n = normalizeText(text);
  if (tx === 'rent') return /\b(alugo meu|alugo minha|alugo direto|direto com proprietario|sou proprietario|sou proprietaria|meu apartamento para alugar|minha casa para alugar)\b/.test(n);
  return /\b(vendo meu|vendo minha|vendo direto|direto com proprietario|sou proprietario|sou proprietaria|meu apartamento a venda|minha casa a venda)\b/.test(n);
}

function propertyContext(text) {
  return /\b(apartamento|apto|casa|sobrado|studio|kitnet|cobertura|imovel|condominio|quartos?|dormitorios?|suites?|vagas?|garagem|m2|m²|iptu)\b/.test(normalizeText(text));
}

function locationContext(text, requestedCity) {
  const n = normalizeText(text);
  const target = normalizeText(requestedCity);
  if (target === 'sao caetano do sul') return n.includes('sao caetano') || n.includes('sao caetano do sul');
  if (target === 'santo andre') return n.includes('santo andre');
  if (target === 'sao bernardo do campo') return n.includes('sao bernardo') || n.includes('sbc');
  if (target === 'diadema') return n.includes('diadema');
  if (target === 'sao paulo centro expandido') return n.includes('centro') || n.includes('centro expandido');
  if (target === 'sao paulo zona sul') return n.includes('zona sul');
  if (target === 'sao paulo zona leste') return n.includes('zona leste');
  if (target === 'sao paulo zona oeste') return n.includes('zona oeste');
  if (target === 'sao paulo zona norte') return n.includes('zona norte');
  return false;
}

function propertyWords(code) {
  const n = normalizeText(code).replace(/[_-]+/g, ' ');
  if (!n) return ['apartamento', 'casa', 'cobertura', 'studio'];
  if (['apartamento','apto','apartment'].includes(n)) return ['apartamento'];
  if (['casa','sobrado','house','home'].includes(n)) return ['casa'];
  if (['studio','kitnet','flat'].includes(n)) return ['studio'];
  if (['cobertura','penthouse'].includes(n)) return ['cobertura'];
  return [n];
}

function locationQuery(requestedCity) {
  const n = normalizeText(requestedCity);
  if (n === 'sao bernardo do campo') return 'São Bernardo';
  if (n === 'sao paulo centro expandido') return 'centro São Paulo';
  if (n.startsWith('sao paulo zona ')) return requestedCity.replace('São Paulo ', '');
  return canonicalCity(requestedCity);
}

function queries(request) {
  const place = locationQuery(request.city);
  const props = propertyWords(request.property_type_code).slice(0, 4);
  const verbs = request.transaction_type === 'rent'
    ? ['alugo meu', 'alugo minha']
    : ['vendo meu', 'vendo minha'];
  const out = [];
  for (const prop of props) {
    for (const verb of verbs) out.push(`${verb} ${prop} ${place}`);
  }
  return out.slice(0, 6);
}

function normalizePost(post, request, query) {
  const text = String(post?.text || '').trim();
  const permalink = String(post?.permalink || '').trim();
  if (!text || !permalink) return null;
  if (professional(text) || !ownerSignal(text, request.transaction_type) || !propertyContext(text) || !locationContext(text, request.city)) return null;

  return {
    source_name: 'Threads público',
    source_url: permalink,
    source_item_id: String(post?.id || post?.shortcode || '').trim(),
    title: text.slice(0, 180),
    description: text,
    price: null,
    currency: 'BRL',
    state_code: 'SP',
    city: canonicalCity(request.city),
    neighborhood: null,
    transaction_type: request.transaction_type,
    property_type: request.property_type_code || null,
    published_at: post?.timestamp || null,
    seller_id: String(post?.username || '').trim() || null,
    seller_nickname: String(post?.username || '').trim() || null,
    attributes: {},
    raw_quality: {
      official_api: true,
      exact_city_or_zone: true,
      owner_signal: true,
      professional_rejected: false,
      query,
    },
  };
}

export async function collectThreads(request, { token, timeoutMs }) {
  if (!token) return { ok: false, status: 'not_configured', source: 'threads', results: [], error: 'THREADS_ACCESS_TOKEN_missing' };

  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const all = [];
  const perQuery = [];
  for (const query of queries(request)) {
    const url = new URL(`${API}/keyword_search`);
    url.searchParams.set('q', query);
    url.searchParams.set('search_type', 'RECENT');
    url.searchParams.set('fields', FIELDS);
    url.searchParams.set('search_mode', 'KEYWORD');
    url.searchParams.set('limit', '50');
    url.searchParams.set('since', since);
    try {
      const payload = await fetchJson(url.toString(), { token, timeoutMs });
      const posts = Array.isArray(payload?.data) ? payload.data : [];
      perQuery.push({ query, raw_count: posts.length, ok: true });
      for (const post of posts) {
        const normalized = normalizePost(post, request, query);
        if (normalized) all.push(normalized);
      }
    } catch (error) {
      perQuery.push({ query, raw_count: 0, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  const dedup = new Map();
  for (const item of all) if (item.source_url && !dedup.has(item.source_url)) dedup.set(item.source_url, item);
  const results = [...dedup.values()];
  const rawCount = perQuery.reduce((sum, row) => sum + Number(row.raw_count || 0), 0);
  const successfulQueries = perQuery.filter((row) => row.ok).length;

  return {
    ok: successfulQueries > 0,
    status: successfulQueries === perQuery.length ? 'completed' : successfulQueries > 0 ? 'partial' : 'failed',
    source: 'threads',
    raw_count: rawCount,
    qualified_count: results.length,
    results,
    query_report: perQuery,
  };
}

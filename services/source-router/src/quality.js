const SOURCE_HOSTS = {
  olx: ['olx.com.br'],
  instagram: ['instagram.com'],
  facebook: ['facebook.com', 'fb.com'],
  telegram: ['t.me', 'telegram.me'],
  threads: ['threads.net', 'threads.com'],
};

function norm(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function hostnameMatches(hostname, suffix) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  const wanted = String(suffix || '').toLowerCase();
  return host === wanted || host.endsWith(`.${wanted}`);
}

export function sourceUrlAllowed(value, source) {
  const allowed = SOURCE_HOSTS[source];
  if (!allowed) return false;
  try {
    const url = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    return allowed.some((suffix) => hostnameMatches(url.hostname, suffix));
  } catch {
    return false;
  }
}

const PRIMARY_PROPERTY_EVIDENCE = /\b(imovel|imoveis|apartamento|apartamentos|apto|aptos|casa|casas|sobrado|sobrados|kitnet|kitnets|studio|studios|flat|flats|cobertura|coberturas|terreno|terrenos|lote|lotes|house|houses|home|homes|apartment|apartments)\b/;
const SECONDARY_PROPERTY_EVIDENCE = /\b(condominio|dormitorio|dormitorios|quarto|quartos|garagem|garagens|suite|suites|bed|beds|bath|baths)\b/g;
const UNAVAILABLE_CONTENT = /\b(this content isn t available right now|this content isnt available right now|conteudo nao esta disponivel|publicacao nao esta disponivel)\b/;
const DEMAND_LANGUAGE = /\b(procuro|busco|quero comprar|quero alugar|preciso de|alguem tem|alguma casa para alugar|algum apartamento para alugar)\b/;
const SUPPLY_LANGUAGE = /\b(vendo|vende|venda|alugo|aluga|alugue|aluguel|locacao|locar|permuta|troco)\b/;
const CORE_FACEBOOK_CITIES = new Set(['santo andre','sao bernardo do campo','sao caetano do sul','diadema','sao paulo']);

// Used only when the platform did not provide a structured city. It prevents a
// post from inheriting the requested run target merely because it was published
// inside a São Paulo group. Keep this list to explicit, high-confidence signals.
const OUTSIDE_CORE_TEXT = /\b(apopka|orlando|miami|fort lauderdale|tampa|florida|united states|estados unidos|eua|rio de janeiro|niteroi|curitiba|porto alegre|pelotas|belo horizonte|salvador|recife|fortaleza|brasilia|goiania|balneario camboriu|sao carlos|campinas|sorocaba|ribeirao preto|santos)\b/;
// Match explicit UF abbreviations in the original text, never accent-stripped
// prose: "pé direito" and "a pé" are not evidence of Pernambuco.
const OUTSIDE_STATE_TOKEN = /(?:^|[\s,/-])(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SE|TO)(?=$|[\s,.;:/-])/;

export function isUnavailableContent(row) {
  return UNAVAILABLE_CONTENT.test(norm(`${row?.title || ''} ${row?.description || ''}`));
}

export function isPropertyRelevant(row) {
  const propertyType = norm(row?.property_type);
  const haystack = norm(`${row?.title || ''} ${row?.description || ''}`);
  if (propertyType && PRIMARY_PROPERTY_EVIDENCE.test(propertyType)) return true;
  if (PRIMARY_PROPERTY_EVIDENCE.test(haystack)) return true;
  const secondary = haystack.match(SECONDARY_PROPERTY_EVIDENCE) || [];
  return new Set(secondary).size >= 2;
}

export function isDemandOnlyPost(row) {
  const haystack = norm(`${row?.title || ''} ${row?.description || ''}`);
  return DEMAND_LANGUAGE.test(haystack) && !SUPPLY_LANGUAGE.test(haystack);
}

export function isCoreOperationalLocation(row) {
  const city = norm(row?.city);
  if (city) {
    if (city.startsWith('sao paulo')) return true;
    return CORE_FACEBOOK_CITIES.has(city);
  }

  const raw = `${row?.title || ''} ${row?.description || ''} ${row?.attributes?.raw_location || ''}`.normalize('NFC');
  if (OUTSIDE_CORE_TEXT.test(norm(raw)) || OUTSIDE_STATE_TOKEN.test(raw)) return false;
  return true;
}

const PROFESSIONAL_TYPE = /\b(business|professional|dealer|agency|company|store|loja|empresa|imobiliaria|corretor|corretora|construtora|incorporadora|real estate|realtor|broker)\b/;
const PROFESSIONAL_NAME = /\b(imobiliaria|imoveis|creci|corretor|corretora|empreendimentos|incorporadora|construtora|real estate|properties|realtor|broker)\b/;
const PROFESSIONAL_EVIDENCE = /\b(creci|corretor|corretora|imobiliaria|construtora|incorporadora|consultor imobiliario|consultoria imobiliaria|assessoria imobiliaria|real estate|realtor|broker|corretagem)\b/;

export function professionalDescription(value) {
  return norm(value).replace(/\b(?:sem\s+(?:a\s+)?(?:intermediacao\s+(?:de\s+)?(?:uma\s+)?)?|nao\s+(?:aceito|aceita|aceitamos|quero|queremos|trabalho|trabalhamos)\s+(?:com\s+)?(?:uma\s+)?)(?:imobiliarias?|corretor(?:es)?|corretoras?|corretagem)(?:\s+ou\s+(?:imobiliarias?|corretor(?:es)?|corretoras?|corretagem))?\b/g, ' ');
}

export function professionalAdvertiserReason(row) {
  const type = norm(row?.seller_type ?? row?.attributes?.seller_type);
  const seller = norm(row?.seller_nickname ?? row?.seller_name);
  const evidence = professionalDescription(row?.description);
  if (type && PROFESSIONAL_TYPE.test(type)) return 'seller_type';
  if (seller && PROFESSIONAL_NAME.test(seller)) return 'seller_name';
  if (evidence && PROFESSIONAL_EVIDENCE.test(evidence)) return 'description';
  return null;
}

export function isObviousProfessionalAdvertiser(row) {
  return Boolean(professionalAdvertiserReason(row));
}

export function canonicalSourceKey(value) {
  try {
    const url = new URL(String(value || ''));
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$)/i.test(key)) url.searchParams.delete(key);
    }
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString();
  } catch {
    return String(value || '').trim();
  }
}

export function filterQualifiedRows(rows, source) {
  const accepted = [];
  const rejectedSamples = [];
  const sample = (row, reason) => {
    if (rejectedSamples.length < 10) rejectedSamples.push({ source_url: row?.source_url || null, reason });
  };
  const rejected = {
    wrong_domain: 0,
    unavailable_content: 0,
    non_property: 0,
    outside_core_area: 0,
    demand_post: 0,
    professional_advertiser: 0,
    professional_seller_type: 0,
    professional_seller_name: 0,
    professional_description: 0,
  };

  for (const row of Array.isArray(rows) ? rows : []) {
    if (!sourceUrlAllowed(row?.source_url, source)) {
      rejected.wrong_domain += 1;
      sample(row, 'wrong_domain');
      continue;
    }

    if (source === 'facebook' && isUnavailableContent(row)) {
      rejected.unavailable_content += 1;
      sample(row, 'unavailable_content');
      continue;
    }

    if (source === 'facebook' && !isPropertyRelevant(row)) {
      rejected.non_property += 1;
      sample(row, 'non_property');
      continue;
    }

    if (source === 'facebook' && !isCoreOperationalLocation(row)) {
      rejected.outside_core_area += 1;
      sample(row, 'outside_core_area');
      continue;
    }

    if (source === 'facebook' && isDemandOnlyPost(row)) {
      rejected.demand_post += 1;
      sample(row, 'demand_post');
      continue;
    }

    const professionalReason = professionalAdvertiserReason(row);
    if (professionalReason) {
      rejected.professional_advertiser += 1;
      sample(row, `professional_${professionalReason}`);
      if (professionalReason === 'seller_type') rejected.professional_seller_type += 1;
      if (professionalReason === 'seller_name') rejected.professional_seller_name += 1;
      if (professionalReason === 'description') rejected.professional_description += 1;
      continue;
    }

    accepted.push(row);
  }

  return {
    accepted,
    rejected_count: rejected.wrong_domain
      + rejected.unavailable_content
      + rejected.non_property
      + rejected.outside_core_area
      + rejected.demand_post
      + rejected.professional_advertiser,
    rejection_reasons: rejected,
    rejected_samples: rejectedSamples,
  };
}

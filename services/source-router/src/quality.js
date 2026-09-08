const SOURCE_HOSTS = {
  olx: ['olx.com.br'],
  instagram: ['instagram.com'],
  facebook: ['facebook.com', 'fb.com'],
  telegram: ['t.me', 'telegram.me'],
  threads: ['threads.net'],
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

const PROFESSIONAL_TYPE = /\b(business|professional|dealer|agency|company|store|loja|empresa|imobiliaria|corretor|corretora|construtora|incorporadora|real estate)\b/;
const PROFESSIONAL_NAME = /\b(imobiliaria|imoveis|creci|corretor|corretora|empreendimentos|incorporadora|construtora|real estate|properties)\b/;
const PROFESSIONAL_EVIDENCE = /\b(creci|corretor|corretora|imobiliaria|construtora|incorporadora|consultor imobiliario|consultoria imobiliaria|assessoria imobiliaria)\b/;

export function professionalAdvertiserReason(row) {
  const type = norm(row?.seller_type ?? row?.attributes?.seller_type);
  const seller = norm(row?.seller_nickname ?? row?.seller_name);
  const evidence = norm(`${row?.description || ''}`);
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
  const rejected = {
    wrong_domain: 0,
    professional_advertiser: 0,
    professional_seller_type: 0,
    professional_seller_name: 0,
    professional_description: 0,
  };

  for (const row of Array.isArray(rows) ? rows : []) {
    if (!sourceUrlAllowed(row?.source_url, source)) {
      rejected.wrong_domain += 1;
      continue;
    }

    const professionalReason = professionalAdvertiserReason(row);
    if (professionalReason) {
      rejected.professional_advertiser += 1;
      if (professionalReason === 'seller_type') rejected.professional_seller_type += 1;
      if (professionalReason === 'seller_name') rejected.professional_seller_name += 1;
      if (professionalReason === 'description') rejected.professional_description += 1;
      continue;
    }

    accepted.push(row);
  }

  return {
    accepted,
    rejected_count: rejected.wrong_domain + rejected.professional_advertiser,
    rejection_reasons: rejected,
  };
}

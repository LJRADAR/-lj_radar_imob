export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function slug(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function canonicalCity(requestedCity) {
  const n = normalizeText(requestedCity);
  if (n.startsWith('sao paulo')) return 'São Paulo';
  return String(requestedCity ?? '').trim();
}

const SP_ZONE_NEIGHBORHOODS = {
  'sao paulo centro expandido': [
    'centro','se','republica','bela vista','consolacao','liberdade','cambuci','santa cecilia','bom retiro','bras','pari','aclimacao','higienopolis','cerqueira cesar','paraiso'
  ],
  'sao paulo zona sul': [
    'moema','vila mariana','saude','jabaquara','campo belo','santo amaro','brooklin','interlagos','ipiranga','sacoma','morumbi','chacara santo antonio','vila clementino'
  ],
  'sao paulo zona leste': [
    'tatuape','mooca','vila prudente','penha','carrao','itaquera','vila formosa','sao mateus','vila matilde','analia franco','belem'
  ],
  'sao paulo zona oeste': [
    'pinheiros','perdizes','lapa','pompeia','vila madalena','alto de pinheiros','butanta','vila romana','barra funda','jardins','sumare'
  ],
  'sao paulo zona norte': [
    'santana','tucuruvi','vila guilherme','casa verde','mandaqui','parada inglesa','jardim sao paulo','jacana','tremembe','limao','imirim','vila maria'
  ],
};

export function locationMatchesTarget(targetCity, resultCity, neighborhood = '') {
  const target = normalizeText(targetCity);
  const city = normalizeText(resultCity);
  const hood = normalizeText(neighborhood);

  if (target.startsWith('sao paulo ')) {
    if (city !== 'sao paulo') return false;
    const terms = SP_ZONE_NEIGHBORHOODS[target];
    if (!terms) return false;
    return terms.some((term) => hood.includes(term));
  }
  return target === city;
}

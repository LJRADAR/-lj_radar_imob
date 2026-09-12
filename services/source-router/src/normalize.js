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
  return String(requestedCity ?? '').normalize('NFC').trim();
}

const SP_ZONE_NEIGHBORHOODS = {
  'sao paulo centro expandido': [
    'centro','se','republica','bela vista','consolacao','liberdade','cambuci','santa cecilia','bom retiro','bras','pari','aclimacao','higienopolis','cerqueira cesar','paraiso'
  ],
  'sao paulo zona sul': [
    'moema','vila mariana','saude','jabaquara','campo belo','santo amaro','brooklin','interlagos','ipiranga','sacoma','morumbi','chacara santo antonio','vila clementino',
    'vila andrade','grajau','campo limpo','cidade dutra','socorro','capao redondo','jardim angela','jardim sao luis','pedreira','cidade ademar','parelheiros','marsilac'
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

export function locationMatchStatus(targetCity, resultCity, neighborhood = '') {
  const target = normalizeText(targetCity);
  const city = normalizeText(resultCity);
  const hood = normalizeText(neighborhood);

  if (target.startsWith('sao paulo ')) {
    if (city !== 'sao paulo') return 'outside';
    const terms = SP_ZONE_NEIGHBORHOODS[target];
    if (!terms) return 'outside';
    const matches = term => (` ${hood} `).includes(` ${term} `);
    if (terms.some(matches)) return 'exact';
    if (Object.values(SP_ZONE_NEIGHBORHOODS).some(zone => zone.some(matches))) return 'outside';
    // An incomplete neighborhood catalog is not evidence that a São Paulo
    // listing is outside the requested zone. Keep it for geographical review.
    return 'zone_pending';
  }
  return target === city ? 'exact' : 'outside';
}

export function locationMatchesTarget(targetCity, resultCity, neighborhood = '') {
  return locationMatchStatus(targetCity, resultCity, neighborhood) === 'exact';
}

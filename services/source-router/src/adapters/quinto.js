const API = 'https://api.apify.com/v2';

function text(value) {
  const v = String(value ?? '').replace(/\s+/g, ' ').trim();
  return v || null;
}

function norm(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function ratioClose(a, b, tolerance) {
  const x = numberOrNull(a);
  const y = numberOrNull(b);
  if (x === null || y === null || x <= 0 || y <= 0) return false;
  return Math.abs(x - y) / Math.max(x, y) <= tolerance;
}

function intEqual(a, b) {
  const x = numberOrNull(a);
  const y = numberOrNull(b);
  return x !== null && y !== null && Math.trunc(x) === Math.trunc(y);
}

function propertyType(value) {
  const n = norm(value);
  if (/\b(apartamento|apto|apartment)\b/.test(n)) return 'apartment';
  if (/\b(casa de condominio|condo house)\b/.test(n)) return 'condo_house';
  if (/\b(casa|sobrado|house|home)\b/.test(n)) return 'house';
  if (/\b(studio|kitnet|flat)\b/.test(n)) return 'studio';
  return 'any';
}

function rowPropertyType(value) {
  return propertyType(value);
}

function bedroomFilter(value) {
  const n = numberOrNull(value);
  if (n === null || n < 1) return [];
  if (n >= 4) return ['4+'];
  return [String(Math.trunc(n))];
}

function buildInput(candidate, maxResults) {
  const city = text(candidate?.city);
  const transaction = candidate?.transaction_type === 'rent' ? 'rent' : candidate?.transaction_type === 'sale' ? 'sale' : null;
  if (!city || !transaction) return null;

  const price = numberOrNull(candidate?.price);
  const area = numberOrNull(candidate?.area_m2 ?? candidate?.area);
  const operation = transaction === 'rent' ? 'rent' : 'buy';
  const input = {
    operation,
    location: `${city}, SP`,
    propertyType: propertyType(candidate?.property_type ?? candidate?.detected_type),
    bedrooms: bedroomFilter(candidate?.bedrooms),
    includePhotos: false,
    maxResults,
  };

  if (price !== null && price > 0) {
    const tolerance = transaction === 'rent' ? 0.40 : 0.20;
    input.priceMin = Math.max(0, Math.floor(price * (1 - tolerance)));
    input.priceMax = Math.ceil(price * (1 + tolerance));
  }
  if (area !== null && area > 0) {
    input.areaMin = Math.max(0, Math.floor(area * 0.80));
    input.areaMax = Math.ceil(area * 1.20);
  }
  return input;
}

function addressSignals(candidate, row) {
  const candidateAddress = norm(candidate?.address);
  const candidateNeighborhood = norm(candidate?.neighborhood);
  const rowStreet = norm(row?.address?.street ?? row?.street);
  const rowNeighborhood = norm(row?.address?.neighborhood ?? row?.neighborhood);

  const street = Boolean(candidateAddress && rowStreet && (candidateAddress.includes(rowStreet) || rowStreet.includes(candidateAddress)));
  const neighborhood = Boolean(candidateNeighborhood && rowNeighborhood && candidateNeighborhood === rowNeighborhood);
  return { street, neighborhood, rowStreet, rowNeighborhood };
}

export function scoreQuintoMatch(candidate, row) {
  const candidateCity = norm(candidate?.city);
  const rowCity = norm(row?.address?.city ?? row?.city);
  const expectedOperation = candidate?.transaction_type === 'rent' ? 'rent' : 'buy';
  const actualOperation = norm(row?.operation);
  const city = Boolean(candidateCity && rowCity && candidateCity === rowCity);
  const operation = actualOperation === expectedOperation;
  if (!city || !operation) return { score: 0, strong: false, evidence: [] };

  let score = 30;
  const evidence = ['city', 'operation'];
  const expectedType = propertyType(candidate?.property_type ?? candidate?.detected_type);
  const actualType = rowPropertyType(row?.type);
  if (expectedType !== 'any' && actualType === expectedType) {
    score += 15;
    evidence.push('property_type');
  }

  const address = addressSignals(candidate, row);
  if (address.street) {
    score += 30;
    evidence.push('street');
  }
  if (address.neighborhood) {
    score += 20;
    evidence.push('neighborhood');
  }

  const area = ratioClose(candidate?.area_m2 ?? candidate?.area, row?.area, 0.12);
  if (area) {
    score += 20;
    evidence.push('area');
  }
  const bedrooms = intEqual(candidate?.bedrooms, row?.bedrooms);
  if (bedrooms) {
    score += 15;
    evidence.push('bedrooms');
  }
  const parking = intEqual(candidate?.parking_spaces ?? candidate?.parking, row?.parkingSpaces);
  if (parking) {
    score += 10;
    evidence.push('parking');
  }

  const candidatePrice = candidate?.price;
  const rowPrice = candidate?.transaction_type === 'rent' ? row?.totalCost : row?.salePrice;
  const price = ratioClose(candidatePrice, rowPrice, candidate?.transaction_type === 'rent' ? 0.35 : 0.15);
  if (price) {
    score += 15;
    evidence.push('price');
  }

  const strong = Boolean(
    (address.street && (area || bedrooms)) ||
    (address.neighborhood && area && bedrooms && score >= 75) ||
    score >= 100
  );

  return { score: Math.min(100, score), strong, evidence };
}

export async function verifyQuinto(candidate, {
  token,
  taskId,
  timeoutMs,
  timeoutSecs,
  maxChargeUsd,
}) {
  if (!token || !taskId) {
    return {
      ok: true,
      status: 'inconclusive',
      confidence: 0,
      approved_for_pipeline: false,
      provider: 'apify',
      reason: !token ? 'APIFY_TOKEN_missing' : 'APIFY_TASK_QUINTO_missing',
      results_checked: 0,
    };
  }

  const maxResults = 25;
  const input = buildInput(candidate, maxResults);
  if (!input) {
    return { ok: true, status: 'inconclusive', confidence: 0, approved_for_pipeline: false, provider: 'apify', reason: 'candidate_missing_city_or_transaction', results_checked: 0 };
  }

  const url = new URL(`${API}/actor-tasks/${encodeURIComponent(taskId)}/run-sync-get-dataset-items`);
  url.searchParams.set('clean', '1');
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', String(maxResults));
  url.searchParams.set('maxItems', String(maxResults));
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
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      return { ok: true, status: 'inconclusive', confidence: 0, approved_for_pipeline: false, provider: 'apify', reason: `apify_http_${response.status}`, results_checked: 0 };
    }

    const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.items) ? payload.items : [];
    let best = null;
    for (const row of rows) {
      const match = scoreQuintoMatch(candidate, row);
      if (!best || match.score > best.match.score) best = { row, match };
    }

    if (best?.match?.strong === true) {
      return {
        ok: true,
        status: 'found_on_quintoandar',
        confidence: best.match.score,
        approved_for_pipeline: false,
        provider: 'apify',
        reason: 'strong_positive_match',
        results_checked: rows.length,
        match_url: text(best.row?.url),
        match_id: text(best.row?.id),
        evidence: best.match.evidence,
        cost_guard: { max_total_charge_usd: maxChargeUsd, max_paid_dataset_items: maxResults },
      };
    }

    return {
      ok: true,
      status: 'inconclusive',
      confidence: Math.min(69, best?.match?.score ?? 0),
      approved_for_pipeline: false,
      provider: 'apify',
      reason: rows.length === 0 ? 'no_result_is_not_proof_of_absence' : 'no_strong_positive_match',
      results_checked: rows.length,
      cost_guard: { max_total_charge_usd: maxChargeUsd, max_paid_dataset_items: maxResults },
    };
  } catch (error) {
    return {
      ok: true,
      status: 'inconclusive',
      confidence: 0,
      approved_for_pipeline: false,
      provider: 'apify',
      reason: error instanceof Error && error.name === 'AbortError' ? 'apify_timeout' : 'apify_verifier_failed',
      results_checked: 0,
    };
  } finally {
    clearTimeout(timer);
  }
}

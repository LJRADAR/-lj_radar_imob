import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreQuintoMatch, verifyQuinto } from '../src/adapters/quinto.js';

const candidate = {
  city: 'São Caetano do Sul',
  transaction_type: 'sale',
  property_type: 'Apartamento',
  neighborhood: 'Santa Paula',
  address: 'Rua Maranhão, 500, Santa Paula, São Caetano do Sul',
  price: 850000,
  area_m2: 92,
  bedrooms: 3,
  parking_spaces: 2,
};

test('strong Quinto match requires independent property signals', () => {
  const result = scoreQuintoMatch(candidate, {
    operation: 'buy',
    type: 'Apartamento',
    salePrice: 830000,
    area: 94,
    bedrooms: 3,
    parkingSpaces: 2,
    address: { city: 'São Caetano do Sul', neighborhood: 'Santa Paula', street: 'Rua Maranhão' },
  });
  assert.equal(result.strong, true);
  assert.ok(result.score >= 90);
  assert.ok(result.evidence.includes('street'));
  assert.ok(result.evidence.includes('area'));
});

test('same city and type alone never proves Quinto match', () => {
  const result = scoreQuintoMatch(candidate, {
    operation: 'buy',
    type: 'Apartamento',
    salePrice: 300000,
    area: 45,
    bedrooms: 1,
    parkingSpaces: 0,
    address: { city: 'São Caetano do Sul', neighborhood: 'Centro', street: 'Rua Amazonas' },
  });
  assert.equal(result.strong, false);
  assert.ok(result.score < 100);
});

test('missing values do not count as equal evidence', () => {
  const result = scoreQuintoMatch(
    { city: 'São Caetano do Sul', transaction_type: 'rent', property_type: 'Apartamento' },
    { operation: 'rent', type: 'Apartamento', address: { city: 'São Caetano do Sul' } },
  );
  assert.equal(result.strong, false);
  assert.deepEqual(result.evidence.sort(), ['city', 'operation', 'property_type'].sort());
});

test('unconfigured Apify verifier fails closed as inconclusive', async () => {
  const result = await verifyQuinto(candidate, {
    token: '',
    taskId: '',
    timeoutMs: 3000,
    timeoutSecs: 20,
    maxChargeUsd: 0.25,
  });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'inconclusive');
  assert.equal(result.approved_for_pipeline, false);
});

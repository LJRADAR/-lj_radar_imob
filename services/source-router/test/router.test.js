import test from 'node:test';
import assert from 'node:assert/strict';
import { routeCollection, validateRequest } from '../src/router.js';
import { locationMatchesTarget } from '../src/normalize.js';

test('accepts São Caetano core target', () => {
  const result = validateRequest({ state_code: 'SP', city: 'São Caetano do Sul', transaction_type: 'sale' });
  assert.equal(result.ok, true);
  assert.equal(result.request.source, 'all');
});

test('accepts explicit Threads source', () => {
  const result = validateRequest({ source: 'threads', state_code: 'SP', city: 'Santo André', transaction_type: 'sale' });
  assert.equal(result.ok, true);
  assert.equal(result.request.source, 'threads');
});

test('accepts Apify-backed source names', () => {
  for (const source of ['olx', 'instagram', 'facebook', 'telegram']) {
    const result = validateRequest({ source, state_code: 'SP', city: 'São Caetano do Sul', transaction_type: 'sale' });
    assert.equal(result.ok, true);
    assert.equal(result.request.source, source);
  }
});

test('keeps Mercado Livre disabled until official access is proven', () => {
  const result = validateRequest({ source: 'mercadolivre', state_code: 'SP', city: 'São Caetano do Sul', transaction_type: 'sale' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'source_temporarily_disabled_pending_official_access');
});

test('all mode does not call unconfigured sources', async () => {
  const validation = validateRequest({ source: 'all', state_code: 'SP', city: 'São Caetano do Sul', transaction_type: 'sale' });
  assert.equal(validation.ok, true);
  const result = await routeCollection(validation.request, {
    threadsToken: '',
    apifyToken: '',
    apifyTasks: {},
    requestTimeoutMs: 3000,
    apifyTimeoutSecs: 20,
    apifyMaxChargeUsd: 0.25,
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'not_configured');
  assert.equal(result.error, 'no_source_configured');
  assert.deepEqual(result.source_report, []);
});

test('rejects unsupported source', () => {
  const result = validateRequest({ source: 'unknown', state_code: 'SP', city: 'São Caetano do Sul', transaction_type: 'sale' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'source_not_supported');
});

test('rejects out-of-scope city', () => {
  const result = validateRequest({ state_code: 'SP', city: 'Campinas', transaction_type: 'sale' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'city_not_in_core_operation');
});

test('SP zone requires known neighborhood evidence', () => {
  assert.equal(locationMatchesTarget('São Paulo Zona Sul', 'São Paulo', 'Moema'), true);
  assert.equal(locationMatchesTarget('São Paulo Zona Sul', 'São Paulo', 'Tatuapé'), false);
  assert.equal(locationMatchesTarget('São Paulo Zona Sul', 'Osasco', 'Moema'), false);
});

test('null property type remains broad instead of forcing apartment', () => {
  const result = validateRequest({ state_code: 'SP', city: 'São Caetano do Sul', transaction_type: 'rent', property_type_code: null });
  assert.equal(result.ok, true);
  assert.equal(result.request.property_type_code, null);
});

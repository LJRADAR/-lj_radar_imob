import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRequest } from '../src/router.js';
import { locationMatchesTarget } from '../src/normalize.js';

test('accepts São Caetano core target', () => {
  const result = validateRequest({ state_code: 'SP', city: 'São Caetano do Sul', transaction_type: 'sale' });
  assert.equal(result.ok, true);
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

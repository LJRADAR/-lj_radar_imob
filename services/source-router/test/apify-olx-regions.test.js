import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTaskInput } from '../src/adapters/apify.js';

const base = {
  state_code: 'SP',
  property_type_code: 'apartamento',
  limit: 50,
};

test('builds OLX sale override for ABC task', () => {
  const input = buildTaskInput({ ...base, city: 'São Caetano do Sul', transaction_type: 'sale' }, 'olx', 50);
  assert.deepEqual(input.searchQueries, ['Apartamento venda São Caetano do Sul SP']);
  assert.equal(input.maxResults, 50);
  assert.equal(input.state, 'SP');
  assert.equal(input.sortBy, 'relevance');
});

test('builds OLX rent override without requiring a second task', () => {
  const input = buildTaskInput({ ...base, city: 'Santo André', transaction_type: 'rent' }, 'olx', 50);
  assert.deepEqual(input.searchQueries, ['Apartamento aluguel Santo André SP']);
});

test('builds OLX São Paulo zone override', () => {
  const input = buildTaskInput({ ...base, city: 'São Paulo Zona Sul', transaction_type: 'rent' }, 'olx', 50);
  assert.deepEqual(input.searchQueries, ['Apartamento aluguel Zona Sul São Paulo SP']);
});

test('returns null for target outside OLX pilot map', () => {
  const input = buildTaskInput({ ...base, city: 'Campinas', transaction_type: 'sale' }, 'olx', 50);
  assert.equal(input, null);
});

test('builds Facebook Groups input with the validated public owner group', () => {
  const input = buildTaskInput({ ...base, city: 'Santo André', transaction_type: 'sale' }, 'facebook', 10);
  assert.equal(input.resultsLimit, 10);
  assert.deepEqual(input.startUrls, [
    { url: 'https://www.facebook.com/groups/alugarzonaleste' },
  ]);
  assert.equal(input.viewOption, 'CHRONOLOGICAL');
});

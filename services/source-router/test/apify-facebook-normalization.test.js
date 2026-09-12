import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inferTransactionType,
  normalizeApifyItem,
  parseFacebookLocation,
  parseCount,
  normalizeStateCode,
  parseMoney,
} from '../src/adapters/apify.js';

test('ambiguous numeric ranges are never persisted as a single metric', () => {
  assert.equal(parseMoney('2 a 3 quartos'), null);
  assert.equal(parseCount('2 a 3 quartos'), null);
  assert.equal(parseCount('101'), null);
  assert.equal(parseCount('3 quartos'), 3);
});

test('state normalization accepts official names but fails closed on unknown values', () => {
  assert.equal(normalizeStateCode('São Paulo'), 'SP');
  assert.equal(normalizeStateCode('sp'), 'SP');
  assert.equal(normalizeStateCode('Florida'), null);
});

test('parseMoney handles Brazilian and marketplace thousands correctly', () => {
  assert.equal(parseMoney('R$420,000'), 420000);
  assert.equal(parseMoney('R$2,800'), 2800);
  assert.equal(parseMoney('R$1.800,00'), 1800);
  assert.equal(parseMoney('R$1,800.00'), 1800);
  assert.equal(parseMoney('R$680'), 680);
  assert.equal(parseMoney(245000), 245000);
  const scaled = normalizeApifyItem({ url: 'https://www.facebook.com/groups/x/permalink/9/', title: 'Apartamento à venda R$ 350 mil', text: 'Vendo apartamento em Santo André', location: 'Santo André, SP' }, { city: 'Santo André', transaction_type: 'sale', property_type_code: null }, 'facebook');
  assert.equal(scaled.price, 350000);
});

test('facebook zero price falls back to price stated in post text', () => {
  const row = normalizeApifyItem({
    url: 'https://www.facebook.com/groups/x/permalink/10/',
    title: 'Alugo apartamento no jd arco íris valor 1200 reais incluso condomínio',
    text: 'Alugo apartamento no jd arco íris valor 1200 reais incluso condomínio, interessados 11911236688',
    price: 0,
  }, {
    city: 'Santo André',
    transaction_type: 'rent',
    property_type_code: null,
  }, 'facebook');

  assert.equal(row.transaction_type, 'rent');
  assert.equal(row.price, 1200);
  assert.equal(row.property_type, 'Apartamento');
});

test('facebook transaction is inferred from the post instead of the requested run', () => {
  assert.equal(inferTransactionType('Apartamento', 'Aluguel 1.800,00 direto com proprietária', 'sale'), 'rent');
  assert.equal(inferTransactionType('Casa à venda', 'Vendo minha casa', 'rent'), 'sale');
  assert.equal(inferTransactionType('Casa', 'Aceita permuta por apartamento', 'rent'), 'sale');
});

test('facebook location is parsed from actor location text', () => {
  assert.deepEqual(parseFacebookLocation('Diadema, SP'), { city: 'Diadema', state_code: 'SP' });
  assert.deepEqual(parseFacebookLocation('Itanhaém, SP'), { city: 'Itanhaém', state_code: 'SP' });
  assert.deepEqual(parseFacebookLocation(null), { city: null, state_code: null });
});

test('facebook actor item normalizes rent, price, city, property metrics and direct contact', () => {
  const row = normalizeApifyItem({
    url: 'https://www.facebook.com/groups/x/permalink/1/',
    time: '2026-09-11T16:25:06.000Z',
    title: '3 beds · 2 bath · House',
    text: 'Aluga se Casa de 5 cômodos em Diadema/SP. 03 dormitórios, 02 banheiros, 02 vagas. R$ 2.800,00. Contato (11)93914-1991',
    price: 'R$2,800',
    location: 'Diadema, SP',
    user: { id: 'u1', name: 'Larissa Souza' },
    facebookUrl: 'https://www.facebook.com/groups/x',
  }, {
    city: 'Santo André',
    transaction_type: 'sale',
    property_type_code: null,
  }, 'facebook');

  assert.equal(row.transaction_type, 'rent');
  assert.equal(row.price, 2800);
  assert.equal(row.city, 'Diadema');
  assert.equal(row.state_code, 'SP');
  assert.equal(row.property_type, 'Casa');
  assert.equal(row.bedrooms, 3);
  assert.equal(row.bathrooms, 2);
  assert.equal(row.parking_spaces, 2);
  assert.equal(row.published_at, '2026-09-11T16:25:06.000Z');
  assert.match(row.attributes.phone, /93914-1991/);
  assert.equal(row.attributes.transaction_inferred, true);
});

test('facebook OCR from image can correct transaction and recover contact hints', () => {
  const row = normalizeApifyItem({
    url: 'https://www.facebook.com/groups/x/permalink/2/',
    time: '2026-09-11T18:58:49.000Z',
    title: '1 bed · 1 bath · House',
    text: '1 quarto 1 banheiro – Casa\nRua Aldebarã, Inamar, Diadema - SP',
    price: 'R$680',
    location: 'Diadema, SP',
    user: { id: 'u2', name: 'Rodrigo' },
    attachments: [{ ocrText: 'ALUGO 2 CÔMODOS Jd.Inamar Diadema Valor R$680,00 Informações WhatsApp 99858-80-98' }],
  }, {
    city: 'Santo André',
    transaction_type: 'sale',
    property_type_code: null,
  }, 'facebook');

  assert.equal(row.transaction_type, 'rent');
  assert.equal(row.price, 680);
  assert.equal(row.city, 'Diadema');
  assert.match(row.attributes.attachment_ocr_text, /ALUGO/);
  assert.ok(row.attributes.phone);
});

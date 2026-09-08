import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalSourceKey,
  filterQualifiedRows,
  isObviousProfessionalAdvertiser,
  professionalAdvertiserReason,
  sourceUrlAllowed,
} from '../src/quality.js';

test('sourceUrlAllowed enforces the expected platform domain', () => {
  assert.equal(sourceUrlAllowed('https://www.olx.com.br/imovel/abc', 'olx'), true);
  assert.equal(sourceUrlAllowed('https://sp.olx.com.br/imovel/abc', 'olx'), true);
  assert.equal(sourceUrlAllowed('https://evil.example/redirect?to=olx.com.br', 'olx'), false);
  assert.equal(sourceUrlAllowed('file:///etc/passwd', 'olx'), false);
  assert.equal(sourceUrlAllowed('https://www.instagram.com/p/ABC/', 'instagram'), true);
  assert.equal(sourceUrlAllowed('https://www.facebook.com/groups/1/posts/2', 'facebook'), true);
  assert.equal(sourceUrlAllowed('https://t.me/example/123', 'telegram'), true);
  assert.equal(sourceUrlAllowed('https://www.threads.net/@user/post/ABC', 'threads'), true);
});

test('professional seller types and names are rejected', () => {
  assert.equal(isObviousProfessionalAdvertiser({ seller_type: 'business' }), true);
  assert.equal(isObviousProfessionalAdvertiser({ seller_nickname: 'ABC Imóveis' }), true);
  assert.equal(isObviousProfessionalAdvertiser({ seller_nickname: 'João', description: 'CRECI 12345-F' }), true);
  assert.equal(isObviousProfessionalAdvertiser({ seller_nickname: 'Maria', description: 'Vendo meu apartamento direto.' }), false);
});

test('professional advertiser diagnostics identify the first decisive signal', () => {
  assert.equal(professionalAdvertiserReason({ seller_type: 'business', seller_nickname: 'Maria' }), 'seller_type');
  assert.equal(professionalAdvertiserReason({ seller_nickname: 'ABC Imóveis' }), 'seller_name');
  assert.equal(professionalAdvertiserReason({ seller_nickname: 'João', description: 'CRECI 12345-F' }), 'description');
  assert.equal(professionalAdvertiserReason({ seller_nickname: 'Maria', description: 'Vendo meu apartamento direto.' }), null);
});

test('group-like title does not by itself classify the advertiser as professional', () => {
  assert.equal(isObviousProfessionalAdvertiser({
    seller_nickname: null,
    seller_type: null,
    title: 'Imóveis para venda em Santo André | apartamento direto com proprietário',
    description: 'Apartamento direto com proprietário, 2 dormitórios.',
  }), false);
});

test('filterQualifiedRows rejects wrong domains and explains professional evidence', () => {
  const rows = [
    { source_url: 'https://www.olx.com.br/imovel/1', seller_nickname: 'Maria' },
    { source_url: 'https://www.olx.com.br/imovel/2', seller_type: 'professional' },
    { source_url: 'https://www.olx.com.br/imovel/3', seller_nickname: 'ABC Imóveis' },
    { source_url: 'https://www.olx.com.br/imovel/4', seller_nickname: 'João', description: 'CRECI 12345-F' },
    { source_url: 'https://example.com/imovel/5', seller_nickname: 'João' },
  ];
  const result = filterQualifiedRows(rows, 'olx');
  assert.equal(result.accepted.length, 1);
  assert.equal(result.rejected_count, 4);
  assert.deepEqual(result.rejection_reasons, {
    wrong_domain: 1,
    professional_advertiser: 3,
    professional_seller_type: 1,
    professional_seller_name: 1,
    professional_description: 1,
  });
});

test('canonicalSourceKey removes tracking noise but preserves identifying query params', () => {
  assert.equal(
    canonicalSourceKey('https://www.facebook.com/groups/1/posts/2/?utm_source=x&story_fbid=9#fragment'),
    'https://www.facebook.com/groups/1/posts/2?story_fbid=9',
  );
});
